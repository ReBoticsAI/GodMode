import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";

export interface OperationRunRow {
  id: string;
  tenant_id: string | null;
  actor_id: string;
  object_type: string;
  record_id: string | null;
  action_name: string;
  input_json: string;
  context_json: string;
  idempotency_key: string | null;
  idempotency_ttl_seconds: number | null;
  status: string;
  attempt: number;
  max_attempts: number;
  timeout_ms: number | null;
  cancellable: number;
  recovery_safe: number;
  lease_owner: string | null;
}

function addColumn(
  db: AppDatabase,
  table: string,
  name: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${definition}`);
  }
}

export function ensureOperationRunTables(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kernel_action_idempotency (
      tenant_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action_name TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (key, actor_id, object_type, record_id, action_name)
    );
    CREATE TABLE IF NOT EXISTS kernel_operation_runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      actor_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      record_id TEXT,
      action_name TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      context_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT,
      idempotency_ttl_seconds INTEGER,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      timeout_ms INTEGER,
      cancellable INTEGER NOT NULL DEFAULT 0,
      recovery_safe INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      progress REAL,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS kernel_operation_runs_claim
      ON kernel_operation_runs(status, next_attempt_at, lease_expires_at, created_at);
  `);
  addColumn(db, "kernel_action_idempotency", "tenant_id", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "kernel_action_idempotency", "error_json", "TEXT");
  addColumn(db, "kernel_operation_runs", "input_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, "kernel_operation_runs", "context_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, "kernel_operation_runs", "idempotency_key", "TEXT");
  addColumn(db, "kernel_operation_runs", "idempotency_ttl_seconds", "INTEGER");
  addColumn(db, "kernel_operation_runs", "attempt", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "kernel_operation_runs", "max_attempts", "INTEGER NOT NULL DEFAULT 1");
  addColumn(db, "kernel_operation_runs", "timeout_ms", "INTEGER");
  addColumn(db, "kernel_operation_runs", "cancellable", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "kernel_operation_runs", "recovery_safe", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "kernel_operation_runs", "next_attempt_at", "TEXT");
  addColumn(db, "kernel_operation_runs", "lease_owner", "TEXT");
  addColumn(db, "kernel_operation_runs", "lease_expires_at", "TEXT");
  addColumn(db, "kernel_operation_runs", "error_json", "TEXT");
}

export function recoverLeasedOperationRuns(
  db: AppDatabase,
  forceAllRunning = false
): { requeued: number; failed: number } {
  ensureOperationRunTables(db);
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT id, tenant_id, actor_id, object_type, record_id, action_name,
                idempotency_key, idempotency_ttl_seconds, recovery_safe
         FROM kernel_operation_runs
         WHERE status='running'
           AND (? = 1 OR (lease_expires_at IS NOT NULL
                         AND lease_expires_at <= datetime('now')))`
      )
      .all(forceAllRunning ? 1 : 0) as Array<{
      id: string;
      tenant_id: string | null;
      actor_id: string;
      object_type: string;
      record_id: string | null;
      action_name: string;
      idempotency_key: string | null;
      idempotency_ttl_seconds: number | null;
      recovery_safe: number;
    }>;
    let requeued = 0;
    let failed = 0;
    const unsafeError = JSON.stringify({
      code: "KERNEL_REPLAY_UNSAFE",
      message:
        "Interrupted action was not replayed without a declared retry or idempotency guarantee",
      retryable: false,
    });
    for (const row of rows) {
      if (row.recovery_safe) {
        requeued += db
          .prepare(
            `UPDATE kernel_operation_runs
             SET status='retrying', lease_owner=NULL, lease_expires_at=NULL,
                 next_attempt_at=NULL, updated_at=datetime('now'),
                 finished_at=NULL
             WHERE id=? AND status='running'`
          )
          .run(row.id).changes;
        continue;
      }
      const changed = db
        .prepare(
          `UPDATE kernel_operation_runs
           SET status='failed', error_code='KERNEL_REPLAY_UNSAFE',
               error_message='Interrupted action cannot be replayed safely',
               error_json=?, lease_owner=NULL, lease_expires_at=NULL,
               updated_at=datetime('now'), finished_at=datetime('now')
           WHERE id=? AND status='running'`
        )
        .run(unsafeError, row.id).changes;
      if (changed !== 1) continue;
      failed += 1;
      if (row.idempotency_key) {
        db.prepare(
          `UPDATE kernel_action_idempotency
           SET status='failed', result_json=NULL, error_json=?,
               expires_at=datetime('now', ?), updated_at=datetime('now')
           WHERE tenant_id=? AND key=? AND actor_id=? AND object_type=?
             AND record_id=? AND action_name=? AND status='pending'`
        ).run(
          unsafeError,
          `+${row.idempotency_ttl_seconds ?? 86400} seconds`,
          row.tenant_id ?? "",
          row.idempotency_key,
          row.actor_id,
          row.object_type,
          row.record_id ?? "",
          row.action_name
        );
      }
    }
    return { requeued, failed };
  })();
}

export function claimOperationRun(
  db: AppDatabase,
  leaseOwner: string,
  leaseSeconds = 60
): OperationRunRow | null {
  ensureOperationRunTables(db);
  recoverLeasedOperationRuns(db);
  return db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT id FROM kernel_operation_runs
         WHERE status IN ('pending', 'retrying')
           AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
           AND (lease_expires_at IS NULL OR lease_expires_at <= datetime('now'))
         ORDER BY created_at ASC LIMIT 1`
      )
      .get() as { id: string } | undefined;
    if (!candidate) return null;
    const claimed = db
      .prepare(
        `UPDATE kernel_operation_runs
         SET status='running', attempt=attempt+1, lease_owner=?,
             lease_expires_at=datetime('now', ?), updated_at=datetime('now')
         WHERE id=? AND status IN ('pending', 'retrying')
           AND (lease_expires_at IS NULL OR lease_expires_at <= datetime('now'))`
      )
      .run(leaseOwner, `+${leaseSeconds} seconds`, candidate.id);
    if (claimed.changes !== 1) return null;
    return db
      .prepare(`SELECT * FROM kernel_operation_runs WHERE id=?`)
      .get(candidate.id) as OperationRunRow;
  })();
}

export type TenantDatabaseProvider = () => Array<{
  tenantId: string;
  db: AppDatabase;
}>;

export class OperationRunWorker {
  private readonly workerId = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly databases: TenantDatabaseProvider,
    private readonly execute: (
      db: AppDatabase,
      run: OperationRunRow,
      leaseOwner: string
    ) => Promise<void>,
    private readonly intervalMs = 250
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(): Promise<number> {
    let processed = 0;
    for (const database of this.databases()) {
      try {
        const db = database.db;
        const run = claimOperationRun(db, this.workerId);
        if (!run) continue;
        await this.execute(db, run, this.workerId);
        processed += 1;
      } catch (error) {
        console.warn(
          `[kernel-worker] tenant ${database.tenantId} failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }
    return processed;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (error) {
      console.warn(
        "[kernel-worker] tick failed:",
        error instanceof Error ? error.message : error
      );
    } finally {
      this.running = false;
    }
  }
}
