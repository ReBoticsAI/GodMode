import type Database from "better-sqlite3";
import type { CoreDatabase } from "../core-db.js";
import { tableExists } from "./db-migrations.js";

export const PLATFORM_EVENTS_MOVED_META_KEY =
  "platform_events_moved_to_workspace_v1";

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
  if (!tableExists(db, "platform_events_plane_meta")) return null;
  const row = db
    .prepare("SELECT value FROM platform_events_plane_meta WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function tenantMetaSet(db: SqliteDb, key: string, value: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_events_plane_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO platform_events_plane_meta (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value, updated_at=datetime('now')`
  ).run(key, value);
}

/**
 * PlatformEvent SoR on Workspace (not the durable outbox `events` table).
 * `tenant_id` is required for new rows.
 */
export function ensurePlatformEventsWorkspaceSchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
      actor_id TEXT,
      tenant_id TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS platform_events_type_idx
      ON platform_events(type, created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_events_tenant_idx
      ON platform_events(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS platform_events_plane_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Copy this workspace's Cloud PlatformEvent rows into `platform_events` once.
 * Leaves Cloud rows with null tenant_id on Cloud (orphans).
 */
export function migratePlatformEventsFromCloud(
  tenantId: string,
  tenantDb: SqliteDb,
  cloud: CoreDatabase
): void {
  ensurePlatformEventsWorkspaceSchema(tenantDb);
  if (tenantMetaGet(tenantDb, PLATFORM_EVENTS_MOVED_META_KEY) === "1") return;

  if (!tableExists(cloud, "events")) {
    tenantMetaSet(tenantDb, PLATFORM_EVENTS_MOVED_META_KEY, "1");
    return;
  }

  const orphanCount = (
    cloud
      .prepare(`SELECT COUNT(*) AS c FROM events WHERE tenant_id IS NULL`)
      .get() as { c: number }
  ).c;
  if (orphanCount > 0) {
    console.warn(
      `[platform_events] ${orphanCount} Cloud event(s) have null tenant_id; leaving on Cloud`
    );
  }

  const cols = columnNames(cloud, "events");
  const destCols = new Set(columnNames(tenantDb, "platform_events"));
  const shared = cols.filter((c) => destCols.has(c));
  if (shared.length === 0) {
    tenantMetaSet(tenantDb, PLATFORM_EVENTS_MOVED_META_KEY, "1");
    return;
  }

  const colList = shared.map(quoteIdent).join(", ");
  const placeholders = shared.map(() => "?").join(", ");
  const insert = tenantDb.prepare(
    `INSERT OR IGNORE INTO platform_events (${colList}) VALUES (${placeholders})`
  );

  const rows = cloud
    .prepare(`SELECT ${colList} FROM events WHERE tenant_id = ?`)
    .all(tenantId) as Array<Record<string, unknown>>;

  const copyTx = tenantDb.transaction(() => {
    for (const row of rows) {
      insert.run(...shared.map((c) => row[c]));
    }
  });
  copyTx();

  if (rows.length > 0) {
    const ids = rows.map((r) => r.id as string);
    const ph = ids.map(() => "?").join(",");
    cloud.prepare(`DELETE FROM events WHERE id IN (${ph})`).run(...ids);
  }

  tenantMetaSet(tenantDb, PLATFORM_EVENTS_MOVED_META_KEY, "1");
}
