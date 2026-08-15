import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { configureDbPragmas, logDbConfig } from "./services/db-config.js";

interface CachedUserDb {
  db: AppDatabase;
  lastAccess: number;
}

const cache = new Map<string, CachedUserDb>();
const MAX_OPEN = 16;
const IDLE_MS = 10 * 60 * 1000;
let idleTimer: ReturnType<typeof setInterval> | null = null;

/** Identity for vault fallthrough (User DB handle → userId). */
const userDbIdentity = new WeakMap<AppDatabase, { userId: string }>();

function userDbPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(config.usersDir, `${safe}.sqlite`);
}

/**
 * User DB schema (Epic: User-level data plane).
 * Starts with Platform Vault and Personal Vault GitHub Connect; other
 * personal-layer tables land in follow-ups.
 */
export function migrateUserDb(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      agent_id TEXT,
      owner_kind TEXT NOT NULL DEFAULT 'platform'
        CHECK (owner_kind IN ('platform', 'user', 'agent')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (owner_kind = 'agent' AND agent_id IS NOT NULL)
        OR (owner_kind IN ('platform', 'user') AND agent_id IS NULL)
      )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ai_secrets_name_platform_uq
      ON ai_secrets(name) WHERE owner_kind = 'platform';
    CREATE UNIQUE INDEX IF NOT EXISTS ai_secrets_name_user_uq
      ON ai_secrets(name) WHERE owner_kind = 'user';
    CREATE UNIQUE INDEX IF NOT EXISTS ai_secrets_name_agent_uq
      ON ai_secrets(name, agent_id) WHERE owner_kind = 'agent';
    CREATE TABLE IF NOT EXISTS user_db_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO user_db_meta (key, value, updated_at)
     VALUES ('schema_kind', 'user_vault_v1', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run();
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_OPEN) return;
  const entries = [...cache.entries()].sort(
    (a, b) => a[1].lastAccess - b[1].lastAccess
  );
  while (cache.size > MAX_OPEN && entries.length > 0) {
    const [id, entry] = entries.shift()!;
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
    cache.delete(id);
  }
}

function sweepIdle(): void {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.lastAccess > IDLE_MS) {
      try {
        entry.db.close();
      } catch {
        /* ignore */
      }
      cache.delete(id);
    }
  }
}

function ensureIdleTimer(): void {
  if (idleTimer) return;
  idleTimer = setInterval(sweepIdle, 60_000);
  idleTimer.unref?.();
}

/** Open (or return cached) the per-account User SQLite database. */
export function getUserDb(userId: string): AppDatabase {
  const key = userId.trim();
  if (!key) throw new Error("userId is required for User DB");

  const existing = cache.get(key);
  if (existing) {
    existing.lastAccess = Date.now();
    migrateUserDb(existing.db);
    return existing.db;
  }

  fs.mkdirSync(config.usersDir, { recursive: true });
  const filePath = userDbPath(key);
  const db = new Database(filePath);
  configureDbPragmas(db);
  logDbConfig(db);
  const appDb = db as unknown as AppDatabase;
  migrateUserDb(appDb);
  userDbIdentity.set(appDb, { userId: key });

  cache.set(key, { db: appDb, lastAccess: Date.now() });
  evictIfNeeded();
  ensureIdleTimer();
  return appDb;
}

/** Ensure the User DB file exists (signup / first workspace). */
export function ensureUserDb(userId: string): AppDatabase {
  return getUserDb(userId);
}

export function getUserIdForDb(db: AppDatabase): string | null {
  return userDbIdentity.get(db)?.userId ?? null;
}

export function evictUserDb(userId: string): void {
  const entry = cache.get(userId);
  if (!entry) return;
  try {
    entry.db.close();
  } catch {
    /* ignore */
  }
  cache.delete(userId);
}

export function closeAllUserDbs(): void {
  for (const [, entry] of cache) {
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
  }
  cache.clear();
}

export function listCachedUserIds(): string[] {
  return [...cache.keys()];
}
