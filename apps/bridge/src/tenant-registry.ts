import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { migrateTenantDb, type AppDatabase } from "./db.js";
import { configureDbPragmas, logDbConfig } from "./services/db-config.js";
import { ensureTenantKindMeta } from "./services/tenant-kind.js";
import { seedDomainSkills } from "./services/ai-skills.js";

interface CachedTenant {
  db: AppDatabase;
  lastAccess: number;
}

const cache = new Map<string, CachedTenant>();
/** Tenants kept open for the Bridge process lifetime (never idle-swept). */
const pinned = new Set<string>();
const MAX_OPEN = 8;
const IDLE_MS = 10 * 60 * 1000;

let idleTimer: ReturnType<typeof setInterval> | null = null;

function tenantDbPath(tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(config.tenantsDir, `${safe}.sqlite`);
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_OPEN) return;
  const entries = [...cache.entries()].sort(
    (a, b) => a[1].lastAccess - b[1].lastAccess
  );
  while (cache.size > MAX_OPEN && entries.length > 0) {
    const [id, entry] = entries.shift()!;
    if (pinned.has(id)) continue;
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
    if (pinned.has(id)) continue;
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

/** Keep a tenant DB open for the Bridge process lifetime (skip idle sweep). */
export function pinTenantDb(tenantId: string): void {
  pinned.add(tenantId);
}

/** Open (or return cached) the SQLite handle for a tenant workspace. */
export function getTenantDb(tenantId: string): AppDatabase {
  const existing = cache.get(tenantId);
  if (existing) {
    existing.lastAccess = Date.now();
    migrateTenantDb(existing.db);
    return existing.db;
  }

  fs.mkdirSync(config.tenantsDir, { recursive: true });
  const filePath = tenantDbPath(tenantId);
  const db = new Database(filePath);
  configureDbPragmas(db);
  logDbConfig(db);
  migrateTenantDb(db);
  const kind = ensureTenantKindMeta(tenantId, db);
  if (kind === "operator") {
    try {
      seedDomainSkills(db);
    } catch {
      /* optional */
    }
  }

  cache.set(tenantId, { db, lastAccess: Date.now() });
  evictIfNeeded();
  ensureIdleTimer();
  return db;
}

/**
 * Close and forget a single tenant's cached SQLite handle. Required before
 * deleting a tenant's .sqlite file on Windows, where an open handle keeps the
 * file locked (unlink would fail with EBUSY/EPERM). Also unpins it.
 */
export function evictTenantDb(tenantId: string): void {
  pinned.delete(tenantId);
  const entry = cache.get(tenantId);
  if (!entry) return;
  try {
    entry.db.close();
  } catch {
    /* ignore */
  }
  cache.delete(tenantId);
}

export function closeAllTenantDbs(): void {
  pinned.clear();
  for (const [, entry] of cache) {
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
  }
  cache.clear();
}

export function listCachedTenantIds(): string[] {
  return [...cache.keys()];
}
