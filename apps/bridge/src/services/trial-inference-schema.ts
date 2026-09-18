import type Database from "better-sqlite3";

/**
 * Cloud-DB schema for GodMode trial inference grants (#758).
 * Stores metadata only (key hash / provider ids). Never persist plaintext keys here.
 */
export function ensureTrialInferenceTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trial_inference_grants (
      id TEXT PRIMARY KEY,
      subject_key TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      visitor_key TEXT,
      provider TEXT NOT NULL DEFAULT 'openrouter',
      mechanism TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('active', 'converted', 'expired', 'revoked', 'failed')
      ),
      model_id TEXT NOT NULL,
      provider_key_hash TEXT,
      provider_key_id TEXT,
      prompt_count INTEGER NOT NULL DEFAULT 0,
      spent_usd REAL NOT NULL DEFAULT 0,
      budget_usd REAL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (subject_key)
    );
    CREATE INDEX IF NOT EXISTS trial_inference_grants_user_idx
      ON trial_inference_grants(user_id);
    CREATE INDEX IF NOT EXISTS trial_inference_grants_visitor_idx
      ON trial_inference_grants(visitor_key);
    CREATE INDEX IF NOT EXISTS trial_inference_grants_status_idx
      ON trial_inference_grants(status);
  `);
  // Additive columns for DBs created before signup-guide hard caps.
  const cols = db
    .prepare(`PRAGMA table_info(trial_inference_grants)`)
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("spent_usd")) {
    db.exec(
      `ALTER TABLE trial_inference_grants ADD COLUMN spent_usd REAL NOT NULL DEFAULT 0`
    );
  }
  if (!names.has("budget_usd")) {
    db.exec(`ALTER TABLE trial_inference_grants ADD COLUMN budget_usd REAL`);
  }
}
