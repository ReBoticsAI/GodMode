import type Database from "better-sqlite3";
import { registerMigration, addCol } from "./db-migrations.js";
import { encryptSecret, decryptSecret } from "./holdings/crypto-box.js";

const MIGRATION_VERSION = 1;

export function registerDataManagementMigrations(): void {
  registerMigration(MIGRATION_VERSION, "data_management_upgrade_v1", migrateV1);
  registerMigration(6, "plugin_knowledge_source_v6", migratePluginKnowledgeV2);
}

function migratePluginKnowledgeV2(db: Database.Database): void {
  addCol(db, "ai_rules", "source_plugin_id", "TEXT");
  addCol(db, "ai_skills", "source_plugin_id", "TEXT");
}

function migrateV1(db: Database.Database): void {
  // --- Hot-path indexes ---
  db.exec(`
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_project
      ON ai_project_cards(project_id, sort_order);
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_column
      ON ai_project_cards(column_id, sort_order);
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_parent
      ON ai_project_cards(parent_card_id, sort_order);
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_agent_due
      ON ai_project_cards(assigned_agent_id, due_at);
  `);

  const hasPmSignals = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='pm_signals'`)
    .get();
  if (hasPmSignals) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS pm_signals_by_market_ts
        ON pm_signals(market_id, detected_at DESC);
      CREATE INDEX IF NOT EXISTS pm_signals_by_acted_ts
        ON pm_signals(acted_on, detected_at DESC);
    `);
  }

  // --- Events / outbox spine ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      actor_agent_id TEXT,
      subject TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      dispatched INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_by_ts ON events(ts DESC);
    CREATE INDEX IF NOT EXISTS events_undispatched ON events(dispatched, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS events_seq ON events(seq);
  `);

  // --- DB-first knowledge store ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_rules (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'intelligence',
      description TEXT NOT NULL,
      body TEXT NOT NULL,
      always_apply INTEGER NOT NULL DEFAULT 1,
      globs_json TEXT NOT NULL DEFAULT '[]',
      departments_json TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 50,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_rules_agent ON ai_rules(agent_id, priority);

    CREATE TABLE IF NOT EXISTS ai_skills (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'intelligence',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      tools_json TEXT NOT NULL DEFAULT '[]',
      departments_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_skills_agent ON ai_skills(agent_id, name);

    CREATE TABLE IF NOT EXISTS ai_prompts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'system',
      label TEXT,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_prompts_agent_kind ON ai_prompts(agent_id, kind);
  `);

  addCol(db, "ai_artifacts", "content", "TEXT");
  addCol(db, "ai_memories", "embedding_model", "TEXT");
  addCol(db, "ai_memories", "valid_from", "TEXT");
  addCol(db, "ai_memories", "valid_until", "TEXT");

  // FTS5 for hybrid RAG keyword leg
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ai_memories_fts USING fts5(
      memory_id UNINDEXED,
      text,
      tokenize='porter unicode61'
    );
  `);

  ensureCapabilityTables(db);

  // Encrypt existing plaintext ai_secrets
  migrateEncryptSecrets(db);

  // Import file-backed rules/skills into DB (one-time idempotent)
  importRulesFromFiles(db);
  importSkillsFromFiles(db);
}

/**
 * Idempotent creation of the Agent Capability Graph tables. Lives outside the
 * versioned migration so existing installs (where migration v1 already ran)
 * still get the tables on boot.
 */
export function ensureCapabilityTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_capability_embeddings (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      when_to_use TEXT NOT NULL DEFAULT '',
      pairs_with TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      embedding BLOB,
      embedding_dim INTEGER,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, id, agent_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS ai_capability_fts USING fts5(
      kind,
      id,
      agent_id UNINDEXED,
      text,
      tokenize='porter unicode61'
    );
  `);
}

function migrateEncryptSecrets(db: Database.Database): void {
  const rows = db
    .prepare(`SELECT id, value FROM ai_secrets`)
    .all() as Array<{ id: string; value: string }>;
  const update = db.prepare(`UPDATE ai_secrets SET value = ? WHERE id = ?`);
  for (const row of rows) {
    try {
      decryptSecret(row.value);
      // Already encrypted
    } catch {
      update.run(encryptSecret(row.value), row.id);
    }
  }
}

function importRulesFromFiles(db: Database.Database): void {
  // Deferred to knowledge-store.ts on first access if files exist
}

function importSkillsFromFiles(db: Database.Database): void {
  // Deferred to knowledge-store.ts on first access if files exist
}

/** Monotonic event sequence allocator. */
export function nextEventSeq(db: Database.Database): number {
  const row = db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM events`).get() as {
    n: number;
  };
  return row.n;
}

export interface PlatformEventInput {
  id: string;
  type: string;
  actorAgentId?: string | null;
  subject?: string | null;
  payload?: Record<string, unknown>;
}

/** Append an event row; call inside the same transaction as the state change when possible. */
export function insertEvent(db: Database.Database, evt: PlatformEventInput): void {
  const seq = nextEventSeq(db);
  db.prepare(
    `INSERT INTO events (id, seq, ts, type, actor_agent_id, subject, payload_json, dispatched)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, 0)`
  ).run(
    evt.id,
    seq,
    evt.type,
    evt.actorAgentId ?? null,
    evt.subject ?? null,
    JSON.stringify(evt.payload ?? {})
  );
}

/** Transaction helper: run fn and record an event atomically. */
export function recordEvent<T>(
  db: Database.Database,
  evt: PlatformEventInput,
  fn: () => T
): T {
  const tx = db.transaction(() => {
    const result = fn();
    insertEvent(db, evt);
    return result;
  });
  return tx();
}

export function listUndispatchedEvents(
  db: Database.Database,
  limit = 100
): Array<{
  id: string;
  seq: number;
  ts: string;
  type: string;
  actor_agent_id: string | null;
  subject: string | null;
  payload_json: string;
}> {
  return db
    .prepare(
      `SELECT id, seq, ts, type, actor_agent_id, subject, payload_json
       FROM events WHERE dispatched = 0 ORDER BY seq ASC LIMIT ?`
    )
    .all(limit) as Array<{
    id: string;
    seq: number;
    ts: string;
    type: string;
    actor_agent_id: string | null;
    subject: string | null;
    payload_json: string;
  }>;
}

export function markEventsDispatched(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE events SET dispatched = 1 WHERE id IN (${placeholders})`).run(...ids);
}
