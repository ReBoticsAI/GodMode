import type Database from "better-sqlite3";

/** Schema for unlock gates (no service imports; safe for core-db migrations). */
export function ensureChatUnlockTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS unlock_entitlements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unlockable_id TEXT NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('tutorial', 'purchase', 'admin')),
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      transaction_id TEXT,
      UNIQUE (user_id, unlockable_id)
    );
    CREATE INDEX IF NOT EXISTS unlock_entitlements_user_idx
      ON unlock_entitlements(user_id);

    CREATE TABLE IF NOT EXISTS unlock_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unlockable_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      provider TEXT NOT NULL DEFAULT 'stripe',
      provider_ref TEXT,
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'completed', 'failed', 'canceled')
      ),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS unlock_transactions_user_idx
      ON unlock_transactions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS unlock_transactions_provider_ref_idx
      ON unlock_transactions(provider_ref)
      WHERE provider_ref IS NOT NULL;

    CREATE TABLE IF NOT EXISTS unlock_tutorial_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unlockable_id TEXT NOT NULL,
      steps_json TEXT NOT NULL DEFAULT '{}',
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, unlockable_id)
    );

    CREATE TABLE IF NOT EXISTS chat_graph_docs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT,
      doc_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id)
    );
  `);
}
