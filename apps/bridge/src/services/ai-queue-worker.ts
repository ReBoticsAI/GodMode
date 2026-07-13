import type { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import type { LlmManager } from "./llm-manager.js";
import { getCoreDb, getOperatorTenantId, listAllTenantIds } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import {
  executeWorkflow,
  resumeWorkflowRun,
  type ResumeDecision,
} from "./ai-workflows.js";
import { runReflection } from "./reflection-runner.js";
import { runAutonomousTick } from "./autonomous-executor.js";
import { runEpisodicDistill } from "./episodic-distill.js";
import { runWikiSynthesize } from "./wiki-synthesize.js";
import type { EmbeddingManager } from "./embeddings/embedding-manager.js";

/** Workflow id of the durable autonomous executor (routed to the tick engine). */
export const AUTONOMOUS_RUNNER_ID = "autonomous-task-runner";
/** Hard cap on self-re-enqueued autonomous ticks per chain — guarantees the
 * loop always terminates even if Task selection misbehaves. Per-Task tick caps
 * (in the executor) are the real limit; this is just the ultimate backstop. */
const MAX_AUTONOMOUS_CHAIN = 80;

export interface QueueJobRow {
  id: string;
  status: string;
  priority: number;
  workflow_id: string | null;
  adapter_ids_json: string | null;
  prompt: string | null;
  context_json: string | null;
  result_json: string | null;
  error: string | null;
  tenant_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface EnqueueInput {
  prompt?: string;
  workflowId?: string;
  adapterIds?: string[];
  context?: Record<string, unknown>;
  priority?: number;
  /** Tenant whose workspace DB this job runs against (defaults to operator). */
  tenantId?: string;
}

/**
 * Processes ai_prompt_queue rows one at a time. A job either runs a workflow
 * (when workflow_id is set) or a standalone prompt against the LLM. The worker
 * polls across ALL tenant workspace DBs so newly enqueued jobs (from the
 * scheduler, the UI, or tools) are picked up without an explicit kick, and each
 * job runs against its own tenant's DB. Execution stays globally serialized so
 * the single LLM server is never contended.
 */
export class AiQueueWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly llm: LlmManager,
    private readonly opts: {
      bridgePort?: number;
      pollMs?: number;
      bus?: EventEmitter;
      embeddings?: EmbeddingManager;
    } = {}
  ) {}

  start(): void {
    if (this.timer) return;
    const pollMs = this.opts.pollMs ?? 2000;
    this.timer = setInterval(() => void this.tick(), pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(input: EnqueueInput): string {
    const id = uuidv4();
    const tenantId = input.tenantId ?? null;
    const db = tenantId ? getTenantDb(tenantId) : this.db;
    db.prepare(
      `INSERT INTO ai_prompt_queue
           (id, status, priority, workflow_id, adapter_ids_json, prompt, context_json, tenant_id)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      Number.isFinite(input.priority) ? Number(input.priority) : 0,
      input.workflowId ?? null,
      input.adapterIds ? JSON.stringify(input.adapterIds) : null,
      input.prompt ?? null,
      input.context ? JSON.stringify(input.context) : null,
      tenantId
    );
    return id;
  }

  /** Open every tenant workspace DB (operator first) for cross-tenant polling. */
  private listTenantDbs(): Array<{ tenantId: string; db: AppDatabase }> {
    const out: Array<{ tenantId: string; db: AppDatabase }> = [];
    try {
      for (const id of listAllTenantIds(getCoreDb())) {
        try {
          out.push({ tenantId: id, db: getTenantDb(id) });
        } catch {
          /* skip a tenant whose DB cannot be opened */
        }
      }
    } catch {
      /* core unavailable — fall back to the default db below */
    }
    if (out.length === 0) {
      out.push({ tenantId: getOperatorTenantId(getCoreDb()) ?? "", db: this.db });
    }
    return out;
  }

  listJobs(limit = 100): QueueJobRow[] {
    return this.db
      .prepare(
        `SELECT * FROM ai_prompt_queue ORDER BY
           CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
           priority DESC, created_at ASC
         LIMIT ?`
      )
      .all(limit) as QueueJobRow[];
  }

  hasPendingOrRunning(): boolean {
    for (const { db } of this.listTenantDbs()) {
      try {
        const row = db
          .prepare(
            `SELECT id FROM ai_prompt_queue WHERE status IN ('pending', 'running') LIMIT 1`
          )
          .get();
        if (row) return true;
      } catch {
        /* skip */
      }
    }
    return false;
  }

  /** True if a job for this workflow is already queued or executing (any tenant).
   * Used by the scheduler to avoid piling up overlapping autonomous runs. */
  hasPendingOrRunningWorkflow(workflowId: string): boolean {
    for (const { db } of this.listTenantDbs()) {
      try {
        const row = db
          .prepare(
            `SELECT id FROM ai_prompt_queue WHERE workflow_id = ? AND status IN ('pending', 'running') LIMIT 1`
          )
          .get(workflowId);
        if (row) return true;
      } catch {
        /* skip */
      }
    }
    return false;
  }

  /** Highest-priority pending job across all tenants (priority, then FIFO). */
  private nextPending(): { tenantId: string; db: AppDatabase; job: QueueJobRow } | null {
    let best: { tenantId: string; db: AppDatabase; job: QueueJobRow } | null = null;
    for (const { tenantId, db } of this.listTenantDbs()) {
      let job: QueueJobRow | undefined;
      try {
        job = db
          .prepare(
            `SELECT * FROM ai_prompt_queue WHERE status = 'pending'
             ORDER BY priority DESC, created_at ASC LIMIT 1`
          )
          .get() as QueueJobRow | undefined;
      } catch {
        continue;
      }
      if (!job) continue;
      if (
        !best ||
        job.priority > best.job.priority ||
        (job.priority === best.job.priority && job.created_at < best.job.created_at)
      ) {
        best = { tenantId, db, job };
      }
    }
    return best;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    let next: { tenantId: string; db: AppDatabase; job: QueueJobRow } | null;
    try {
      next = this.nextPending();
    } catch (err) {
      console.warn("[ai-queue] tick skipped:", err instanceof Error ? err.message : err);
      return;
    }
    if (!next) return;
    const { tenantId, db, job } = next;
    this.running = true;
    try {
      db.prepare(
        `UPDATE ai_prompt_queue SET status = 'running', started_at = datetime('now') WHERE id = ?`
      ).run(job.id);
    } catch (err) {
      this.running = false;
      console.warn("[ai-queue] failed to mark job running:", err instanceof Error ? err.message : err);
      return;
    }
    try {
      const result = await this.runJob(job, db);
      db.prepare(
        `UPDATE ai_prompt_queue SET status = 'done', result_json = ?, finished_at = datetime('now') WHERE id = ?`
      ).run(JSON.stringify(result), job.id);
    } catch (err) {
      db.prepare(
        `UPDATE ai_prompt_queue SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?`
      ).run(err instanceof Error ? err.message : String(err), job.id);
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: QueueJobRow, db: AppDatabase): Promise<unknown> {
    const ctx = job.context_json
      ? (JSON.parse(job.context_json) as Record<string, unknown>)
      : {};
    const deps = {
      db,
      llm: this.llm,
      bridgePort: this.opts.bridgePort,
      bus: this.opts.bus,
      embedder: this.opts.embeddings?.isEmbedderReady()
        ? this.opts.embeddings.getEmbeddingClient()
        : null,
    };

    // Resume a parked workflow run (does not block; the run either finishes or
    // re-parks on the next pause and returns early).
    if (ctx.resumeRunId) {
      return resumeWorkflowRun(
        deps,
        String(ctx.resumeRunId),
        (ctx.resumeDecision as ResumeDecision) ?? { decision: "approve" }
      );
    }

    if (ctx.reflectionAgentId) {
      return runReflection(
        deps,
        String(ctx.reflectionAgentId),
        (ctx.reflectionTrigger as "manual" | "scheduled" | "idle" | "queued") ?? "queued"
      );
    }

    if (ctx.episodicDistillChatId) {
      return runEpisodicDistill({
        db,
        llm: this.llm,
        chatId: String(ctx.episodicDistillChatId),
        agentId: String(ctx.episodicDistillAgentId ?? "intelligence"),
        embedder: deps.embedder,
        force: Boolean(ctx.episodicDistillForce),
      });
    }

    if (ctx.wikiSynthesize === true) {
      const tenantId =
        job.tenant_id || getOperatorTenantId(getCoreDb()) || "";
      return runWikiSynthesize({
        db,
        llm: this.llm,
        tenantId,
        agentId: String(ctx.wikiSynthesizeAgentId ?? "intelligence"),
      });
    }

    // Durable autonomous executor: one bounded tick, then self-re-enqueue the
    // loop until the board has no actionable Task (idle) or the chain budget is
    // spent. Loop control lives here in deterministic code, not in the model.
    if (ctx.autonomousTick === true || job.workflow_id === AUTONOMOUS_RUNNER_ID) {
      const chainTick = Number(ctx.autoChainTick ?? 0);
      const result = await runAutonomousTick({
        db,
        llm: this.llm,
        bridgePort: this.opts.bridgePort,
        tenantId: job.tenant_id ?? null,
      });
      const shouldContinue =
        result.status !== "idle" &&
        result.status !== "error" &&
        chainTick + 1 < MAX_AUTONOMOUS_CHAIN;
      if (shouldContinue) {
        this.enqueue({
          workflowId: AUTONOMOUS_RUNNER_ID,
          context: { autonomousTick: true, autoChainTick: chainTick + 1 },
          priority: 1,
          tenantId: job.tenant_id ?? undefined,
        });
      }
      return { ...result, chainTick };
    }

    if (job.workflow_id) {
      const triggerInput = job.prompt ?? String(ctx.input ?? "");
      return executeWorkflow(deps, job.workflow_id, triggerInput, {
        cardId: ctx.cardId ? String(ctx.cardId) : undefined,
      });
    }

    if (!this.llm.isReady()) throw new Error("LLM server not running");
    const sampling = this.llm.getSamplingParams(db);
    const adapterIds = job.adapter_ids_json
      ? (JSON.parse(job.adapter_ids_json) as string[])
      : [];
    const lora = this.resolveLoraScales(db, adapterIds);
    const body: Record<string, unknown> = {
      model: "default",
      messages: [{ role: "user", content: job.prompt ?? "" }],
      stream: false,
      temperature: sampling.temperature,
      top_p: sampling.topP,
      top_k: sampling.topK,
      min_p: sampling.minP,
      repeat_penalty: sampling.repeatPenalty,
      max_tokens: sampling.maxTokens > 0 ? sampling.maxTokens : undefined,
    };
    if (lora.length) body.lora = lora;
    const res = await fetch(`${this.llm.getServerBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    return {
      content: json.choices?.[0]?.message?.content ?? "",
      usage: json.usage,
    };
  }

  /**
   * Maps requested adapter ids to their runtime --lora index + default scale.
   * Adapters not enabled at launch have no runtime index and are skipped.
   */
  private resolveLoraScales(
    db: AppDatabase,
    adapterIds: string[]
  ): Array<{ id: number; scale: number }> {
    if (!adapterIds.length) return [];
    const enabled = this.llm.getEnabledAdapterPaths();
    const indexByPath = new Map(enabled.map((p, i) => [p, i]));
    const out: Array<{ id: number; scale: number }> = [];
    for (const adapterId of adapterIds) {
      const row = db
        .prepare(`SELECT path, default_scale FROM ai_adapters WHERE id = ?`)
        .get(adapterId) as { path: string; default_scale: number } | undefined;
      if (!row) continue;
      const idx = indexByPath.get(row.path);
      if (idx == null) continue;
      out.push({ id: idx, scale: row.default_scale });
    }
    return out;
  }
}
