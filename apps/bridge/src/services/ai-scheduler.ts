import type { EventEmitter } from "node:events";
import cron, { type ScheduledTask } from "node-cron";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { getCoreDb, listAllTenantIds } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import type { AiQueueWorker } from "./ai-queue-worker.js";
import { AUTONOMOUS_RUNNER_ID } from "./ai-queue-worker.js";
import { listWorkflows } from "./ai-workflows.js";

export interface AiSchedule {
  id: string;
  workflow_id: string;
  cron_expr: string;
  timezone: string;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listSchedules(db: AppDatabase): AiSchedule[] {
  return db
    .prepare(
      `SELECT id, workflow_id, cron_expr, timezone, enabled, last_run_at, created_at, updated_at
       FROM ai_schedules ORDER BY created_at ASC`
    )
    .all() as AiSchedule[];
}

export function getSchedule(db: AppDatabase, id: string): AiSchedule | null {
  return (
    (db
      .prepare(
        `SELECT id, workflow_id, cron_expr, timezone, enabled, last_run_at, created_at, updated_at
         FROM ai_schedules WHERE id = ?`
      )
      .get(id) as AiSchedule | undefined) ?? null
  );
}

export function createSchedule(
  db: AppDatabase,
  input: { workflowId: string; cronExpr: string; timezone?: string; enabled?: boolean }
): AiSchedule {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_schedules (id, workflow_id, cron_expr, timezone, enabled)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.workflowId,
    input.cronExpr,
    input.timezone ?? "America/Denver",
    input.enabled === false ? 0 : 1
  );
  return getSchedule(db, id)!;
}

export function updateSchedule(
  db: AppDatabase,
  id: string,
  patch: { cronExpr?: string; timezone?: string; enabled?: boolean }
): AiSchedule | null {
  if (!getSchedule(db, id)) return null;
  if (patch.cronExpr != null)
    db.prepare(
      `UPDATE ai_schedules SET cron_expr = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(String(patch.cronExpr), id);
  if (patch.timezone != null)
    db.prepare(
      `UPDATE ai_schedules SET timezone = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(String(patch.timezone), id);
  if (patch.enabled != null)
    db.prepare(
      `UPDATE ai_schedules SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.enabled ? 1 : 0, id);
  return getSchedule(db, id);
}

export function deleteSchedule(db: AppDatabase, id: string): boolean {
  return db.prepare(`DELETE FROM ai_schedules WHERE id = ?`).run(id).changes > 0;
}

/**
 * Drives workflows on two kinds of triggers:
 *   1. Cron schedules from the ai_schedules table (node-cron)
 *   2. Platform EventEmitter events declared in a workflow's triggerEvents
 * Both paths enqueue the workflow onto the AiQueueWorker rather than running it
 * inline, so execution stays serialized and observable.
 */
let registeredScheduler: AiScheduler | null = null;

/** Called once at Bridge boot so tool/API mutations can refresh cron listeners. */
export function registerAiScheduler(scheduler: AiScheduler): void {
  registeredScheduler = scheduler;
}

export function reloadAiSchedules(): void {
  registeredScheduler?.reload();
}

export class AiScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private busHandlers: Array<{ event: string; handler: (payload: unknown) => void }> = [];
  private started = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly bus: EventEmitter,
    private readonly queue: AiQueueWorker
  ) {}

  start(): void {
    this.started = true;
    this.reload();
  }

  stop(): void {
    this.clearTasks();
    this.clearBusHandlers();
    this.started = false;
  }

  /** Re-reads schedules + workflow event triggers and rebuilds all listeners. */
  reload(): void {
    if (!this.started) return;
    this.clearTasks();
    this.clearBusHandlers();
    this.registerCronSchedules();
    this.registerEventTriggers();
  }

  private clearTasks(): void {
    for (const task of this.tasks.values()) task.stop();
    this.tasks.clear();
  }

  private clearBusHandlers(): void {
    for (const { event, handler } of this.busHandlers) this.bus.off(event, handler);
    this.busHandlers = [];
  }

  /** All tenant DBs (operator first). Schedules + workflows are per-tenant. */
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

  private registerCronSchedules(): void {
    for (const { tenantId, db } of this.tenantDbs()) {
      for (const sched of listSchedules(db)) {
        if (sched.enabled !== 1) continue;
        if (!cron.validate(sched.cron_expr)) {
          console.warn(`[ai-scheduler] invalid cron expr for ${sched.id}: ${sched.cron_expr}`);
          continue;
        }
        const task = cron.schedule(
          sched.cron_expr,
          () => {
            db.prepare(`UPDATE ai_schedules SET last_run_at = datetime('now') WHERE id = ?`)
              .run(sched.id);
            // The autonomous runner self-re-enqueues until idle, so the cron is
            // only a wake-if-idle kick. Skip if a tick is already queued/running
            // — this is the fix for the old running->awaiting_input pile-up.
            if (sched.workflow_id === AUTONOMOUS_RUNNER_ID) {
              if (this.queue.hasPendingOrRunningWorkflow(AUTONOMOUS_RUNNER_ID)) return;
              this.queue.enqueue({
                workflowId: AUTONOMOUS_RUNNER_ID,
                context: { autonomousTick: true, autoChainTick: 0 },
                priority: 1,
                tenantId: tenantId || undefined,
              });
              return;
            }
            this.queue.enqueue({
              workflowId: sched.workflow_id,
              priority: 1,
              tenantId: tenantId || undefined,
            });
          },
          { timezone: sched.timezone }
        );
        this.tasks.set(`${tenantId}:${sched.id}`, task);
      }
    }
  }

  private registerEventTriggers(): void {
    for (const { tenantId, db } of this.tenantDbs()) {
      for (const wf of listWorkflows(db)) {
        if (wf.enabled !== 1) continue;
        const events = wf.config.triggerEvents ?? [];
        for (const event of events) {
          const handler = (payload: unknown) => {
            this.queue.enqueue({
              workflowId: wf.id,
              context: { event, payload },
              priority: 2,
              tenantId: tenantId || undefined,
            });
          };
          this.bus.on(event, handler);
          this.busHandlers.push({ event, handler });
        }
      }
    }
  }
}
