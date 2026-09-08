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
}
