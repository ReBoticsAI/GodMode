import type { EventEmitter } from "node:events";
import cron, { type ScheduledTask } from "node-cron";
import type { AppDatabase } from "../db.js";
import { getCoreDb, listAllTenantIds } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import type { LlmManager } from "./llm-manager.js";
import type { AiQueueWorker } from "./ai-queue-worker.js";
import {
  getReflectionConfig,
  listAgentsWithReflectionEnabled,
  type ReflectionTrigger,
} from "./reflection-config.js";

/**
 * Schedules per-agent reflection passes (cron + idle + manual enqueue) across
 * every tenant workspace. Reflection reads/writes the agent's own tenant DB, so
 * cron tasks, idle timers, and manual runs all carry a tenantId that the queue
 * worker uses to open the right DB. Execution is serialized through
 * AiQueueWorker on the main LLM.
 */
export class ReflectionService {
  private cronTasks = new Map<string, ScheduledTask>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  /** Last chat activity per work tenant (drives idle reflection per workspace). */
  private lastActivityAt = new Map<string, number>();
  /** Idle reflection already fired this idle window, keyed `tenantId:agentId`. */
  private idleTriggered = new Set<string>();
  private started = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly bus: EventEmitter,
    private readonly llm: LlmManager,
    private readonly queue: AiQueueWorker
  ) {
    this.bus.on("chat_completed", (payload: unknown) => {
      const tenantId =
        (payload as { workTenantId?: string } | undefined)?.workTenantId ?? "";
      this.lastActivityAt.set(tenantId, Date.now());
      for (const key of [...this.idleTriggered]) {
        if (key.startsWith(`${tenantId}:`)) this.idleTriggered.delete(key);
      }
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.reload();
    this.idleTimer = setInterval(() => void this.tickIdle(), 60_000);
  }

  stop(): void {
    this.started = false;
    for (const task of this.cronTasks.values()) task.stop();
    this.cronTasks.clear();
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  reload(): void {
    if (!this.started) return;
    for (const task of this.cronTasks.values()) task.stop();
    this.cronTasks.clear();

    for (const { tenantId, db } of this.tenantDbs()) {
      for (const agentId of listAgentsWithReflectionEnabled(db)) {
        const cfg = getReflectionConfig(db, agentId);
        if (!cfg.schedule.enabled) continue;
        if (!cron.validate(cfg.schedule.cron)) {
          console.warn(`[reflection] invalid cron for ${agentId}: ${cfg.schedule.cron}`);
          continue;
        }
        const task = cron.schedule(
          cfg.schedule.cron,
          () => this.enqueueReflection(agentId, "scheduled", tenantId || undefined),
          { timezone: cfg.schedule.timezone }
        );
        this.cronTasks.set(`${tenantId}:${agentId}`, task);
      }
    }
  }

  enqueueReflection(
    agentId: string,
    trigger: ReflectionTrigger,
    tenantId?: string
  ): string {
    return this.queue.enqueue({
      context: { reflectionAgentId: agentId, reflectionTrigger: trigger },
      priority: 0,
      tenantId,
    });
  }

  /** All tenant DBs (operator first). Reflection config is per-tenant. */
  private tenantDbs(): Array<{ tenantId: string; db: AppDatabase }> {
    const out: Array<{ tenantId: string; db: AppDatabase }> = [];
    try {
      for (const id of listAllTenantIds(getCoreDb())) {
        try {
          out.push({ tenantId: id, db: getTenantDb(id) });
        } catch {
          /* skip */
        }
      }
    } catch {
      /* core unavailable */
    }
    if (out.length === 0) out.push({ tenantId: "", db: this.db });
    return out;
  }

  private tickIdle(): void {
    try {
      if (!this.llm.isReady()) return;
      if (this.queue.hasPendingOrRunning()) return;

      const now = Date.now();
      for (const { tenantId, db } of this.tenantDbs()) {
        const lastActivity = this.lastActivityAt.get(tenantId) ?? this.lastActivityAt.get("") ?? now;
        const idleMs = now - lastActivity;
        for (const agentId of listAgentsWithReflectionEnabled(db)) {
          const cfg = getReflectionConfig(db, agentId);
          if (!cfg.idle.enabled) continue;
          const thresholdMs = Math.max(cfg.idle.afterMinutes, 5) * 60_000;
          if (idleMs < thresholdMs) continue;
          const key = `${tenantId}:${agentId}`;
          if (this.idleTriggered.has(key)) continue;
          this.idleTriggered.add(key);
          this.enqueueReflection(agentId, "idle", tenantId || undefined);
        }
      }
    } catch (err) {
      console.warn("[reflection] idle tick skipped:", err instanceof Error ? err.message : err);
    }
  }
}
