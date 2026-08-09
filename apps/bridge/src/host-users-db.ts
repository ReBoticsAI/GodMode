/**
 * Host Users DB (Epic #499): cross-account hub surfaces.
 * Distinct from per-account User Vault files under users/<userId>.sqlite.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import type { CoreDatabase } from "./core-db.js";
import { configureDbPragmas, logDbConfig } from "./services/db-config.js";
import { tableExists } from "./services/db-migrations.js";

export type HostUsersDatabase = Database.Database;

const HUB_MOVED_META_KEY = "hub_tables_moved_to_users_v1";

/** Copy order respects in-hub foreign keys. */
export const HUB_TABLE_COPY_ORDER = [
  "platform_groups",
  "platform_group_members",
  "dm_conversations",
  "dm_conversation_members",
  "dm_blobs",
  "dm_messages",
  "dm_message_attachments",
  "notifications",
  "support_tickets",
  "support_messages",
] as const;

let hostUsersSingleton: HostUsersDatabase | null = null;

/** Current hub schema (no REFERENCES to Cloud `users`). */
export function migrateHostUsersDb(db: HostUsersDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_groups (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS platform_group_members (
      group_id TEXT NOT NULL REFERENCES platform_groups(id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL CHECK (member_kind IN ('user', 'agent')),
      member_id TEXT NOT NULL,
      tenant_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, member_kind, member_id, tenant_id)
    );
    CREATE INDEX IF NOT EXISTS platform_group_members_lookup_idx
      ON platform_group_members(member_kind, member_id, tenant_id);

    CREATE TABLE IF NOT EXISTS dm_conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
      title TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT,
      last_message_preview TEXT
    );
    CREATE INDEX IF NOT EXISTS dm_conversations_updated_idx
      ON dm_conversations(last_message_at DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS dm_conversation_members (
      conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_read_at TEXT,
      last_read_message_id TEXT,
      member_kind TEXT NOT NULL DEFAULT 'user',
      agent_id TEXT,
      agent_tenant_id TEXT,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS dm_conversation_members_user_idx
      ON dm_conversation_members(user_id, conversation_id);

    CREATE TABLE IF NOT EXISTS dm_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at TEXT,
      deleted_at TEXT,
      sender_kind TEXT NOT NULL DEFAULT 'user',
      sender_agent_id TEXT,
      sender_agent_tenant_id TEXT
    );
    CREATE INDEX IF NOT EXISTS dm_messages_conversation_idx
      ON dm_messages(conversation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS dm_blobs (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS dm_blobs_owner_idx
      ON dm_blobs(owner_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS dm_message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'resource_ref')),
      blob_id TEXT REFERENCES dm_blobs(id) ON DELETE SET NULL,
      resource_kind TEXT,
      resource_id TEXT,
      label TEXT,
      href TEXT,
      mime TEXT,
      size INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS dm_message_attachments_message_idx
      ON dm_message_attachments(message_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('user', 'agent')),
      recipient_id TEXT NOT NULL,
      recipient_tenant_id TEXT,
      category TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      resource_kind TEXT,
      resource_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx
      ON notifications(recipient_kind, recipient_id, read_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      requester_kind TEXT NOT NULL CHECK (requester_kind IN ('user', 'agent')),
      requester_id TEXT NOT NULL,
      requester_tenant_id TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      category TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
      priority TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      target_kind TEXT NOT NULL DEFAULT 'resource_owner',
      shared_grant_id TEXT,
      owner_user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS support_tickets_status_idx
      ON support_tickets(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS support_tickets_requester_idx
      ON support_tickets(requester_kind, requester_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'agent', 'admin')),
      author_id TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS support_messages_ticket_idx
      ON support_messages(ticket_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS host_users_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare(
    `INSERT INTO host_users_meta (key, value, updated_at)
     VALUES ('schema_kind', 'host_users_hub_v1', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run();

  const supportSlug = "support";
  const existingSupport = db
    .prepare(`SELECT id FROM platform_groups WHERE slug = ?`)
    .get(supportSlug);
  if (!existingSupport) {
    db.prepare(
      `INSERT INTO platform_groups (id, slug, name, description)
       VALUES (?, ?, ?, ?)`
    ).run(
      uuidv4(),
      supportSlug,
      "Support",
      "Users and agents who can answer hub and shared-resource support tickets."
    );
  }

  try {
    db.prepare(
      `DELETE FROM notifications
       WHERE (title IS NULL OR trim(title) = '')
         AND (body IS NULL OR trim(body) = '')`
    ).run();
  } catch {
    /* optional */
  }
}

function columnNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function coreMetaGet(core: CoreDatabase, key: string): string | null {
  const row = core
    .prepare("SELECT value FROM platform_meta WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function coreMetaSet(core: CoreDatabase, key: string, value: string): void {
  core
    .prepare(
      `INSERT INTO platform_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
    )
    .run(key, value);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Copy hub tables from Cloud/core into Users.sqlite once, then drop them on Cloud.
 * Idempotent via platform_meta on Cloud.
 */
export function migrateHubTablesFromCore(core: CoreDatabase): void {
  if (coreMetaGet(core, HUB_MOVED_META_KEY) === "1") {
    initHostUsersDb();
    return;
  }

  const hasLegacyHub = tableExists(core, "dm_conversations") || tableExists(core, "notifications");
  const usersDb = initHostUsersDb();

  if (hasLegacyHub) {
    const copyTx = usersDb.transaction(() => {
      for (const table of HUB_TABLE_COPY_ORDER) {
        if (!tableExists(core, table)) continue;
        const cols = columnNames(core, table);
        if (cols.length === 0) continue;
        const destCols = new Set(columnNames(usersDb, table));
        const shared = cols.filter((c) => destCols.has(c));
        if (shared.length === 0) continue;
        const colList = shared.map(quoteIdent).join(", ");
        const placeholders = shared.map(() => "?").join(", ");
        const insert = usersDb.prepare(
          `INSERT OR IGNORE INTO ${quoteIdent(table)} (${colList})
           VALUES (${placeholders})`
        );
        const rows = core
          .prepare(`SELECT ${colList} FROM ${quoteIdent(table)}`)
          .all() as Array<Record<string, unknown>>;
        for (const row of rows) {
          insert.run(...shared.map((c) => row[c]));
        }
      }
    });
    copyTx();

    core.exec("PRAGMA foreign_keys = OFF");
    try {
      for (const table of [...HUB_TABLE_COPY_ORDER].reverse()) {
        if (tableExists(core, table)) {
          core.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
        }
      }
    } finally {
      core.exec("PRAGMA foreign_keys = ON");
    }
  }

  coreMetaSet(core, HUB_MOVED_META_KEY, "1");
}

export function initHostUsersDb(): HostUsersDatabase {
  if (hostUsersSingleton) return hostUsersSingleton;

  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.hostUsersDbPath);
  configureDbPragmas(db);
  logDbConfig(db);
  migrateHostUsersDb(db);
  hostUsersSingleton = db;
  return db;
}

export function getHostUsersDb(): HostUsersDatabase {
  if (!hostUsersSingleton) return initHostUsersDb();
  return hostUsersSingleton;
}

/** Test helper. */
export function closeHostUsersDbForTests(): void {
  if (!hostUsersSingleton) return;
  try {
    hostUsersSingleton.close();
  } catch {
    /* ignore */
  }
  hostUsersSingleton = null;
}
