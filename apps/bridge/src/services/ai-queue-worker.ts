import type { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import type { LlmManager } from "./llm-manager.js";
import {
  getCloudDb,
  getOperatorTenantId,
  getPlatformMeta,
  setPlatformMeta,
} from "../core-db.js";
import { getTenantDb, listTenantDbAccessors } from "../tenant-registry.js";
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
import { config } from "../config.js";
import { assertSpendAllowed } from "./authority/spend-authority.js";
import {
  AI_QUEUE_INDEX_BACKFILL_META_KEY,
  AI_QUEUE_WAKE_EVENT,
  backfillAiQueueIndexFromTenants,
  hasPendingOrRunningIndex,
  hasPendingOrRunningWorkflowIndex,
  indexTenantId,
  listStaleRunningIndexRows,
  markAiQueueIndexDone,
  markAiQueueIndexError,
  markAiQueueIndexRunning,
  markAiQueueIndexStaleError,
  nextPendingIndexRow,
  upsertAiQueueIndex,
} from "./ai-queue-index.js";

/** Workflow id of the durable autonomous executor (routed to the tick engine). */
export const AUTONOMOUS_RUNNER_ID = "autonomous-task-runner";
/** Hard cap on self-re-enqueued autonomous ticks per chain — guarantees the
 * loop always terminates even if Task selection misbehaves. Per-Task tick caps
 * (in the executor) are the real limit; this is just the ultimate backstop. */
const MAX_AUTONOMOUS_CHAIN = 80;

/**
 * Mark abandoned `running` queue rows as error so they cannot block forever
 * after a Bridge crash. Fail, do not requeue (jobs are not safely idempotent).
 * Returns number of rows updated.
 */
export function recoverStaleQueueJobs(
  db: AppDatabase,
  staleMinutes: number = config.ai.queueStaleRunningMinutes
): number {
  const minutes = Math.max(1, Math.floor(staleMinutes));
  const result = db
    .prepare(
      `UPDATE ai_prompt_queue
         SET status = 'error',
             error = 'stale running job recovered after worker loss',
             finished_at = datetime('now')
       WHERE status = 'running'
         AND started_at IS NOT NULL
         AND started_at < datetime('now', ?)`
    )
    .run(`-${minutes} minutes`);
  return result.changes;
}

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
 * Processes ai_prompt_queue rows one at a time. Discovery uses Cloud.sqlite
 * `ai_queue_index` (#737) so empty tenants are never opened on the hot path.
 * Enqueue dual-writes the workspace row + Cloud index and emits `ai_queue_wake`.
 * Execution stays globally serialized so the single LLM server is never contended.
 */
export class AiQueueWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private wakeHandler: (() => void) | null = null;
  private backfilled = false;

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
    this.ensureIndexBackfill();
    const bus = this.opts.bus;
    if (bus && !this.wakeHandler) {
      this.wakeHandler = () => {
        void this.tick();
      };
      bus.on(AI_QUEUE_WAKE_EVENT, this.wakeHandler);
    }
    const pollMs = this.opts.pollMs ?? 2000;
    this.timer = setInterval(() => void this.tick(), pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.wakeHandler && this.opts.bus) {
      this.opts.bus.off(AI_QUEUE_WAKE_EVENT, this.wakeHandler);
      this.wakeHandler = null;
    }
  }

  /** One-shot Cloud index seed from existing pending/running workspace rows. */
  ensureIndexBackfill(): void {
    if (this.backfilled) return;
    this.backfilled = true;
    try {
      const core = getCloudDb();
      if (getPlatformMeta(core, AI_QUEUE_INDEX_BACKFILL_META_KEY) === "1") {
        return;
      }
      const accessors = listTenantDbAccessors(this.db).map(({ tenantId, db }) => ({
        tenantId,
        db,
      }));
      const { upserted } = backfillAiQueueIndexFromTenants(accessors, core);
      setPlatformMeta(core, AI_QUEUE_INDEX_BACKFILL_META_KEY, "1");
      if (upserted > 0) {
        console.info(`[ai-queue] backfilled ${upserted} job(s) into Cloud index`);
      }
    } catch (err) {
      this.backfilled = false;
      console.warn(
        "[ai-queue] Cloud index backfill failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  enqueue(input: EnqueueInput): string {
    const id = uuidv4();
    const tenantId = input.tenantId ?? null;
    const priority = Number.isFinite(input.priority) ? Number(input.priority) : 0;
    const workflowId = input.workflowId ?? null;
    const db = tenantId ? getTenantDb(tenantId) : this.db;
    db.prepare(
      `INSERT INTO ai_prompt_queue
           (id, status, priority, workflow_id, adapter_ids_json, prompt, context_json, tenant_id)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      priority,
      workflowId,
      input.adapterIds ? JSON.stringify(input.adapterIds) : null,
      input.prompt ?? null,
      input.context ? JSON.stringify(input.context) : null,
      tenantId
    );
    try {
      upsertAiQueueIndex({
        jobId: id,
        tenantId: indexTenantId(tenantId),
        status: "pending",
        priority,
        workflowId,
      });
    } catch (err) {
      console.error(
        "[ai-queue] Cloud index write failed after workspace enqueue; job will surface after boot backfill:",
        err instanceof Error ? err.message : err
      );
    }
    try {
      this.opts.bus?.emit(AI_QUEUE_WAKE_EVENT);
    } catch {
      /* ignore */
    }
    return id;
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
    return hasPendingOrRunningIndex();
  }

  /** True if a job for this workflow is already queued or executing (any tenant).
   * Used by the scheduler to avoid piling up overlapping autonomous runs. */
  hasPendingOrRunningWorkflow(workflowId: string): boolean {
    return hasPendingOrRunningWorkflowIndex(workflowId);
  }

  /** Highest-priority pending job from Cloud index, then open that tenant only. */
  private nextPending(): { tenantId: string; db: AppDatabase; job: QueueJobRow } | null {
    const indexRow = nextPendingIndexRow();
    if (!indexRow) return null;
    const tenantId = indexRow.tenant_id;
    const db = tenantId ? getTenantDb(tenantId) : this.db;
    let job: QueueJobRow | undefined;
    try {
      job = db
        .prepare(`SELECT * FROM ai_prompt_queue WHERE id = ?`)
        .get(indexRow.job_id) as QueueJobRow | undefined;
    } catch (err) {
      console.warn(
        "[ai-queue] failed to load job from tenant after index hit:",
        err instanceof Error ? err.message : err
      );
      return null;
    }
    if (!job) {
      // Workspace row missing: drop index pointer so we do not loop.
      try {
        markAiQueueIndexError(indexRow.job_id);
      } catch {
        /* ignore */
      }
      return null;
    }
    if (job.status !== "pending") {
      // Index drifted; sync terminal statuses and skip.
      if (job.status === "done") markAiQueueIndexDone(job.id);
      else if (job.status === "error") markAiQueueIndexError(job.id);
      else if (job.status === "running") markAiQueueIndexRunning(job.id);
      return null;
    }
    return { tenantId, db, job };
  }

  private recoverStaleFromIndex(): void {
    const stale = listStaleRunningIndexRows();
    const seenTenants = new Set<string>();
    for (const row of stale) {
      const key = row.tenant_id;
      if (!seenTenants.has(key)) {
        seenTenants.add(key);
        try {
          const db = key ? getTenantDb(key) : this.db;
          const n = recoverStaleQueueJobs(db);
          if (n > 0) {
            console.warn(`[ai-queue] recovered ${n} stale running job(s)`);
          }
        } catch (err) {
          console.warn(
            "[ai-queue] stale recovery skipped:",
            err instanceof Error ? err.message : err
          );
        }
      }
      try {
        const db = key ? getTenantDb(key) : this.db;
        const job = db
          .prepare(`SELECT status FROM ai_prompt_queue WHERE id = ?`)
          .get(row.job_id) as { status: string } | undefined;
        if (!job || job.status === "error" || job.status === "done") {
          markAiQueueIndexStaleError(row.job_id);
        }
      } catch {
        /* ignore */
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    try {
      this.recoverStaleFromIndex();
    } catch (err) {
      console.warn(
        "[ai-queue] stale index recovery skipped:",
        err instanceof Error ? err.message : err
      );
    }
    let next: { tenantId: string; db: AppDatabase; job: QueueJobRow } | null;
    try {
      next = this.nextPending();
    } catch (err) {
      console.warn("[ai-queue] tick skipped:", err instanceof Error ? err.message : err);
      return;
    }
    if (!next) return;
    const { tenantId, job } = next;
    const db = tenantId ? getTenantDb(tenantId) : this.db;
    this.running = true;
    try {
      db.prepare(
        `UPDATE ai_prompt_queue SET status = 'running', started_at = datetime('now') WHERE id = ?`
      ).run(job.id);
      markAiQueueIndexRunning(job.id);
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
      markAiQueueIndexDone(job.id);
    } catch (err) {
      db.prepare(
        `UPDATE ai_prompt_queue SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?`
      ).run(err instanceof Error ? err.message : String(err), job.id);
      markAiQueueIndexError(job.id);
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: QueueJobRow, db: AppDatabase): Promise<unknown> {
    assertSpendAllowed({
      tenantId: job.tenant_id,
      action: "ai_queue",
    });
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
      tenantId: job.tenant_id,
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
        tenantId: job.tenant_id,
        embedder: deps.embedder,
        force: Boolean(ctx.episodicDistillForce),
      });
    }

    if (ctx.wikiSynthesize === true) {
      const tenantId =
        job.tenant_id || getOperatorTenantId(getCloudDb()) || "";
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
