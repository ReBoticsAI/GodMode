import type Database from "better-sqlite3";
import type { CoreDatabase } from "../core-db.js";
import { tableExists } from "./db-migrations.js";

export const HOOKS_MOVED_META_KEY = "hooks_moved_to_workspace_v1";

type SqliteDb = Database.Database;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function columnNames(db: SqliteDb, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function tenantMetaGet(db: SqliteDb, key: string): string | null {
  if (!tableExists(db, "hooks_plane_meta")) return null;
  const row = db
    .prepare("SELECT value FROM hooks_plane_meta WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function tenantMetaSet(db: SqliteDb, key: string, value: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hooks_plane_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO hooks_plane_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(key, value);
}

/** Create hooks SoR tables on a Workspace DB (idempotent). Includes gate action. */
export function ensureHooksWorkspaceSchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'agent')),
      owner_id TEXT NOT NULL,
      owner_tenant_id TEXT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('event', 'schedule')),
      event_type TEXT,
      schedule_cron TEXT,
      condition_json TEXT,
      action_kind TEXT NOT NULL CHECK (action_kind IN ('notify', 'run_agent', 'run_workflow', 'send_message', 'webhook', 'gate')),
      action_config_json TEXT,
      rate_limit_per_hour INTEGER,
      require_approval INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fired_at TEXT
    );
    CREATE INDEX IF NOT EXISTS hooks_owner_idx ON hooks(owner_kind, owner_id);
    CREATE INDEX IF NOT EXISTS hooks_event_idx
      ON hooks(trigger_kind, enabled, event_type);
    CREATE INDEX IF NOT EXISTS hooks_tenant_idx ON hooks(owner_tenant_id);

    CREATE TABLE IF NOT EXISTS hook_runs (
      id TEXT PRIMARY KEY,
      hook_id TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
      event_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped', 'pending_approval')),
      detail TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS hook_runs_hook_idx
      ON hook_runs(hook_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS hooks_plane_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function copyRows(
  cloud: CoreDatabase,
  tenantDb: SqliteDb,
  table: string,
  whereSql: string,
  whereParams: unknown[]
): void {
  if (!tableExists(cloud, table) || !tableExists(tenantDb, table)) return;
  const cols = columnNames(cloud, table);
  const destCols = new Set(columnNames(tenantDb, table));
  const shared = cols.filter((c) => destCols.has(c));
  if (shared.length === 0) return;
  const colList = shared.map(quoteIdent).join(", ");
  const placeholders = shared.map(() => "?").join(", ");
  const insert = tenantDb.prepare(
    `INSERT OR IGNORE INTO ${quoteIdent(table)} (${colList})
     VALUES (${placeholders})`
  );
  const rows = cloud
    .prepare(`SELECT ${colList} FROM ${quoteIdent(table)} WHERE ${whereSql}`)
    .all(...whereParams) as Array<Record<string, unknown>>;
  for (const row of rows) {
    insert.run(...shared.map((c) => row[c]));
  }
}

/**
 * Copy this tenant's hooks (+ runs) from Cloud into the Workspace DB once.
 * Deletes those Cloud rows afterward; keeps Cloud table DDL.
 * Orphan hooks (owner_tenant_id IS NULL) are left on Cloud.
 */
export function migrateHooksFromCloud(
  tenantId: string,
  tenantDb: SqliteDb,
  cloud: CoreDatabase
): void {
  ensureHooksWorkspaceSchema(tenantDb);
  if (tenantMetaGet(tenantDb, HOOKS_MOVED_META_KEY) === "1") return;

  const hasCloudHooks = tableExists(cloud, "hooks");
  if (hasCloudHooks) {
    const orphanCount = (
      cloud
        .prepare(
          `SELECT COUNT(*) AS c FROM hooks WHERE owner_tenant_id IS NULL`
        )
        .get() as { c: number }
    ).c;
    if (orphanCount > 0) {
      console.warn(
        `[hooks] ${orphanCount} Cloud hook(s) have null owner_tenant_id; leaving on Cloud`
      );
    }

    const hookIds = (
      cloud
        .prepare(`SELECT id FROM hooks WHERE owner_tenant_id = ?`)
        .all(tenantId) as Array<{ id: string }>
    ).map((h) => h.id);

    const copyTx = tenantDb.transaction(() => {
      copyRows(cloud, tenantDb, "hooks", "owner_tenant_id = ?", [tenantId]);
      if (hookIds.length > 0) {
        const ph = hookIds.map(() => "?").join(",");
        copyRows(cloud, tenantDb, "hook_runs", `hook_id IN (${ph})`, hookIds);
      }
    });
    copyTx();

    cloud.exec("PRAGMA foreign_keys = OFF");
    try {
      const delTx = cloud.transaction(() => {
        if (hookIds.length > 0) {
          const ph = hookIds.map(() => "?").join(",");
          cloud
            .prepare(`DELETE FROM hook_runs WHERE hook_id IN (${ph})`)
            .run(...hookIds);
          cloud
            .prepare(`DELETE FROM hooks WHERE id IN (${ph})`)
            .run(...hookIds);
        }
      });
      delTx();
    } finally {
      cloud.exec("PRAGMA foreign_keys = ON");
    }
  }

  tenantMetaSet(tenantDb, HOOKS_MOVED_META_KEY, "1");
}
