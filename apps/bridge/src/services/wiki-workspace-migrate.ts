import type Database from "better-sqlite3";
import type { CoreDatabase } from "../core-db.js";
import { addCol, tableExists } from "./db-migrations.js";
import { backfillWikiFts } from "./wiki-rag.js";

export const WIKI_MOVED_META_KEY = "wiki_moved_to_workspace_v1";

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
  if (!tableExists(db, "wiki_plane_meta")) return null;
  const row = db
    .prepare("SELECT value FROM wiki_plane_meta WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function tenantMetaSet(db: SqliteDb, key: string, value: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_plane_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO wiki_plane_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(key, value);
}

/** Create wiki SoR tables on a Workspace DB (idempotent). */
export function ensureWikiWorkspaceSchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_pages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      space TEXT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'internal'
        CHECK (visibility IN ('internal', 'external')),
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS wiki_pages_scope_idx
      ON wiki_pages(tenant_id, visibility, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_tenant_visibility_slug_idx
      ON wiki_pages(tenant_id, visibility, slug);
    CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_external_slug_idx
      ON wiki_pages(slug) WHERE visibility = 'external';

    CREATE TABLE IF NOT EXISTS wiki_revisions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS wiki_revisions_page_idx
      ON wiki_revisions(page_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS wiki_page_proposals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create', 'update')),
      space TEXT,
      slug TEXT,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      target_page_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'synthesize',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS wiki_page_proposals_status_idx
      ON wiki_page_proposals(tenant_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS wiki_plane_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  addCol(db, "wiki_pages", "embedding", "BLOB");
  addCol(db, "wiki_pages", "embedding_dim", "INTEGER");

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(
      page_id UNINDEXED,
      title,
      body
    );
  `);
}

function copyTenantRows(
  cloud: CoreDatabase,
  tenantDb: SqliteDb,
  table: string,
  tenantId: string
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
  const hasTenantCol = cols.includes("tenant_id");
  const rows = hasTenantCol
    ? (cloud
        .prepare(
          `SELECT ${colList} FROM ${quoteIdent(table)} WHERE tenant_id = ?`
        )
        .all(tenantId) as Array<Record<string, unknown>>)
    : [];
  // Revisions: copy by page_id for this tenant's pages
  if (table === "wiki_revisions") {
    const pageIds = (
      cloud
        .prepare(`SELECT id FROM wiki_pages WHERE tenant_id = ?`)
        .all(tenantId) as Array<{ id: string }>
    ).map((p) => p.id);
    if (pageIds.length === 0) return;
    const placeholdersIn = pageIds.map(() => "?").join(",");
    const revRows = cloud
      .prepare(
        `SELECT ${colList} FROM wiki_revisions WHERE page_id IN (${placeholdersIn})`
      )
      .all(...pageIds) as Array<Record<string, unknown>>;
    for (const row of revRows) {
      insert.run(...shared.map((c) => row[c]));
    }
    return;
  }
  for (const row of rows) {
    insert.run(...shared.map((c) => row[c]));
  }
}

/**
 * Copy this tenant's wiki rows from Cloud into the Workspace DB once.
 * Deletes Cloud rows for the tenant afterward; keeps Cloud table DDL.
 */
export function migrateWikiFromCloud(
  tenantId: string,
  tenantDb: SqliteDb,
  cloud: CoreDatabase
): void {
  ensureWikiWorkspaceSchema(tenantDb);
  if (tenantMetaGet(tenantDb, WIKI_MOVED_META_KEY) === "1") return;

  const hasCloudWiki = tableExists(cloud, "wiki_pages");
  if (hasCloudWiki) {
    const copyTx = tenantDb.transaction(() => {
      copyTenantRows(cloud, tenantDb, "wiki_pages", tenantId);
      copyTenantRows(cloud, tenantDb, "wiki_revisions", tenantId);
      copyTenantRows(cloud, tenantDb, "wiki_page_proposals", tenantId);
    });
    copyTx();
    backfillWikiFts(tenantDb as CoreDatabase);

    const pageIds = (
      cloud
        .prepare(`SELECT id FROM wiki_pages WHERE tenant_id = ?`)
        .all(tenantId) as Array<{ id: string }>
    ).map((p) => p.id);
    cloud.exec("PRAGMA foreign_keys = OFF");
    try {
      const delTx = cloud.transaction(() => {
        if (pageIds.length > 0) {
          const ph = pageIds.map(() => "?").join(",");
          cloud
            .prepare(`DELETE FROM wiki_revisions WHERE page_id IN (${ph})`)
            .run(...pageIds);
          for (const pageId of pageIds) {
            try {
              cloud
                .prepare(`DELETE FROM wiki_pages_fts WHERE page_id = ?`)
                .run(pageId);
            } catch {
              /* FTS may be absent on legacy cloud */
            }
          }
        }
        cloud
          .prepare(`DELETE FROM wiki_page_proposals WHERE tenant_id = ?`)
          .run(tenantId);
        cloud.prepare(`DELETE FROM wiki_pages WHERE tenant_id = ?`).run(tenantId);
      });
      delTx();
    } finally {
      cloud.exec("PRAGMA foreign_keys = ON");
    }
  }

  tenantMetaSet(tenantDb, WIKI_MOVED_META_KEY, "1");
}
