/**
 * Cloud.sqlite discovery index for ai_prompt_queue jobs (#737).
 * Workspace DBs hold full payloads; this table is pointers only so the worker
 * never poll-opens every tenant to find pending work.
 */
import { getCloudDb, type CoreDatabase } from "../core-db.js";
import { config } from "../config.js";

export const AI_QUEUE_WAKE_EVENT = "ai_queue_wake";

export const AI_QUEUE_INDEX_BACKFILL_META_KEY = "ai_queue_index_backfill_v1";

export type AiQueueIndexStatus = "pending" | "running" | "done" | "error";

export interface AiQueueIndexRow {
  job_id: string;
  tenant_id: string;
  status: AiQueueIndexStatus;
  priority: number;
  workflow_id: string | null;
  run_after: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface UpsertAiQueueIndexInput {
  jobId: string;
  /** Empty string = operator / worker fallback DB. */
  tenantId: string;
  status: AiQueueIndexStatus;
  priority?: number;
  workflowId?: string | null;
  runAfter?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

function cloud(db?: CoreDatabase): CoreDatabase {
  return db ?? getCloudDb();
}

/** Normalize nullish tenant ids to the index sentinel for the operator fallback DB. */
export function indexTenantId(tenantId: string | null | undefined): string {
  return tenantId?.trim() ? tenantId.trim() : "";
}

export function upsertAiQueueIndex(
  input: UpsertAiQueueIndexInput,
  db?: CoreDatabase
): void {
  const c = cloud(db);
  c.prepare(
    `INSERT INTO ai_queue_index (
       job_id, tenant_id, status, priority, workflow_id, run_after,
       created_at, started_at, finished_at
     ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       status = excluded.status,
       priority = excluded.priority,
       workflow_id = excluded.workflow_id,
       run_after = excluded.run_after,
       started_at = COALESCE(excluded.started_at, ai_queue_index.started_at),
       finished_at = COALESCE(excluded.finished_at, ai_queue_index.finished_at)`
  ).run(
    input.jobId,
    indexTenantId(input.tenantId),
    input.status,
    Number.isFinite(input.priority) ? Number(input.priority) : 0,
    input.workflowId ?? null,
    input.runAfter ?? null,
    input.createdAt ?? null,
    input.startedAt ?? null,
    input.finishedAt ?? null
  );
}

export function markAiQueueIndexRunning(
  jobId: string,
  db?: CoreDatabase
): void {
  cloud(db)
    .prepare(
      `UPDATE ai_queue_index
         SET status = 'running', started_at = datetime('now')
       WHERE job_id = ?`
    )
    .run(jobId);
}

export function markAiQueueIndexDone(jobId: string, db?: CoreDatabase): void {
  cloud(db)
    .prepare(
      `UPDATE ai_queue_index
         SET status = 'done', finished_at = datetime('now')
       WHERE job_id = ?`
    )
    .run(jobId);
}

export function markAiQueueIndexError(jobId: string, db?: CoreDatabase): void {
  cloud(db)
    .prepare(
      `UPDATE ai_queue_index
         SET status = 'error', finished_at = datetime('now')
       WHERE job_id = ?`
    )
    .run(jobId);
}

export function markAiQueueIndexStaleError(
  jobId: string,
  db?: CoreDatabase
): void {
  cloud(db)
    .prepare(
      `UPDATE ai_queue_index
         SET status = 'error', finished_at = datetime('now')
       WHERE job_id = ? AND status = 'running'`
    )
    .run(jobId);
}

export function nextPendingIndexRow(
  db?: CoreDatabase
): AiQueueIndexRow | null {
  const row = cloud(db)
    .prepare(
      `SELECT job_id, tenant_id, status, priority, workflow_id, run_after,
              created_at, started_at, finished_at
         FROM ai_queue_index
        WHERE status = 'pending'
          AND (run_after IS NULL OR run_after <= datetime('now'))
        ORDER BY priority DESC, created_at ASC
        LIMIT 1`
    )
    .get() as AiQueueIndexRow | undefined;
  return row ?? null;
}

export function hasPendingOrRunningIndex(db?: CoreDatabase): boolean {
  const row = cloud(db)
    .prepare(
      `SELECT job_id FROM ai_queue_index
        WHERE status IN ('pending', 'running')
        LIMIT 1`
    )
    .get();
  return Boolean(row);
}

export function hasPendingOrRunningWorkflowIndex(
  workflowId: string,
  db?: CoreDatabase
): boolean {
  const row = cloud(db)
    .prepare(
      `SELECT job_id FROM ai_queue_index
        WHERE workflow_id = ?
          AND status IN ('pending', 'running')
        LIMIT 1`
    )
    .get(workflowId);
  return Boolean(row);
}

/** Index rows that look abandoned as running (workspace recovery still needed). */
export function listStaleRunningIndexRows(
  staleMinutes: number = config.ai.queueStaleRunningMinutes,
  db?: CoreDatabase
): AiQueueIndexRow[] {
  const minutes = Math.max(1, Math.floor(staleMinutes));
  return cloud(db)
    .prepare(
      `SELECT job_id, tenant_id, status, priority, workflow_id, run_after,
              created_at, started_at, finished_at
         FROM ai_queue_index
        WHERE status = 'running'
          AND started_at IS NOT NULL
          AND started_at < datetime('now', ?)`
    )
    .all(`-${minutes} minutes`) as AiQueueIndexRow[];
}

export type TenantQueueAccessor = {
  tenantId: string;
  db: {
    prepare: (sql: string) => {
      all: (...params: unknown[]) => unknown[];
    };
  };
};

/**
 * One-shot: copy pending/running workspace queue rows into Cloud index.
 * Callers supply tenant accessors (boot walk). Idempotent UPSERT.
 */
export function backfillAiQueueIndexFromTenants(
  accessors: TenantQueueAccessor[],
  db?: CoreDatabase
): { upserted: number } {
  let upserted = 0;
  for (const { tenantId, db: tenantDb } of accessors) {
    let rows: Array<{
      id: string;
      status: string;
      priority: number;
      workflow_id: string | null;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
    }>;
    try {
      rows = tenantDb
        .prepare(
          `SELECT id, status, priority, workflow_id, created_at, started_at, finished_at
             FROM ai_prompt_queue
            WHERE status IN ('pending', 'running')`
        )
        .all() as typeof rows;
    } catch {
      continue;
    }
    for (const row of rows) {
      if (row.status !== "pending" && row.status !== "running") continue;
      upsertAiQueueIndex(
        {
          jobId: row.id,
          tenantId,
          status: row.status,
          priority: row.priority,
          workflowId: row.workflow_id,
          createdAt: row.created_at,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
        },
        db
      );
      upserted += 1;
    }
  }
  return { upserted };
}
