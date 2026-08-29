import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { migrateTenantDb, type AppDatabase } from "./db.js";
import { configureDbPragmas, logDbConfig } from "./services/db-config.js";
import { ensureTenantKindMeta, isOperatorTenantDb } from "./services/tenant-kind.js";
import { seedDomainSkills } from "./services/ai-skills.js";
import { getCloudDb, listAllTenantIds } from "./core-db.js";
import { migrateWikiFromCloud } from "./services/wiki-workspace-migrate.js";
import { migrateHooksFromCloud } from "./services/hooks-workspace-migrate.js";
import { migratePlatformEventsFromCloud } from "./services/platform-events-workspace-migrate.js";

const require = createRequire(import.meta.url);

/** Once per open DB handle (process lifetime / until eviction). */
const personalRepaired = new WeakSet<AppDatabase>();

/**
 * Personal toolAllow / bootstrap repair on every getTenantDb open.
 * Lazy require avoids a cycle: tenant-registry → personal-os-seed →
 * knowledge-store → agents-db → tenant-registry.
 */
function repairPersonalTenantIfNeeded(db: AppDatabase): void {
  try {
    if (personalRepaired.has(db)) return;
    if (isOperatorTenantDb(db)) {
      personalRepaired.add(db);
      return;
    }
    const { repairPersonalOsTenant } = require("./services/personal-os-seed.js") as typeof import("./services/personal-os-seed.js");
    repairPersonalOsTenant(db);
    personalRepaired.add(db);
  } catch (err) {
    console.warn(
      "[tenant] personal toolAllow repair failed:",
      err instanceof Error ? err.message : err
    );
  }
}

interface CachedTenant {
  db: AppDatabase;
  lastAccess: number;
}

const cache = new Map<string, CachedTenant>();
/**
 * Refcounted pins: while count > 0 the tenant skips LRU and idle sweep.
 * Bootstrap pins the operator once and never unpins (permanent hold).
 */
const pinCounts = new Map<string, number>();
const MAX_OPEN = 8;
const IDLE_MS = 10 * 60 * 1000;

function isPinned(tenantId: string): boolean {
  return (pinCounts.get(tenantId) ?? 0) > 0;
}

/** Workspace DB handle → tenantId (Platform Vault fallthrough via workspace owner). */
const tenantDbIdentity = new WeakMap<AppDatabase, { tenantId: string }>();

let idleTimer: ReturnType<typeof setInterval> | null = null;

export function getTenantIdForDb(db: AppDatabase): string | null {
  return tenantDbIdentity.get(db)?.tenantId ?? null;
}

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
    if (isPinned(id)) continue;
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
    if (isPinned(id)) continue;
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

/** Increment pin count so this tenant skips LRU and idle sweep while held. */
export function pinTenantDb(tenantId: string): void {
  const id = tenantId?.trim();
  if (!id) return;
  pinCounts.set(id, (pinCounts.get(id) ?? 0) + 1);
}

/**
 * Decrement pin count. At 0 the tenant may be reclaimed by LRU/idle again.
 * Does not close the handle. No-op for empty ids or already-zero counts.
 */
export function unpinTenantDb(tenantId: string): void {
  const id = tenantId?.trim();
  if (!id) return;
  const next = (pinCounts.get(id) ?? 0) - 1;
  if (next <= 0) pinCounts.delete(id);
  else pinCounts.set(id, next);
}

/** Test helper: current pin refcount (0 if unpinned). */
export function getTenantDbPinCount(tenantId: string): number {
  return pinCounts.get(tenantId?.trim() ?? "") ?? 0;
}

/**
 * Tenant id + lazy DB accessor for SaaS-wide scans. Uses a getter so LRU eviction
 * does not leave callers holding closed SQLite handles when many tenants are
 * opened in one loop (MAX_OPEN is 8).
 */
export function listTenantDbAccessors(
  fallbackDb: AppDatabase
): Array<{ tenantId: string; db: AppDatabase }> {
  let ids: string[];
  try {
    ids = listAllTenantIds(getCloudDb());
  } catch {
    return [{ tenantId: "", db: fallbackDb }];
  }
  if (ids.length === 0) {
    return [{ tenantId: "", db: fallbackDb }];
  }
  return ids.map((tenantId) => ({
    tenantId,
    get db() {
      return getTenantDb(tenantId);
    },
  }));
}

/** Open (or return cached) the SQLite handle for a tenant workspace. */
export function getTenantDb(tenantId: string): AppDatabase {
  const existing = cache.get(tenantId);
  if (existing) {
    existing.lastAccess = Date.now();
    migrateTenantDb(existing.db);
    try {
      migrateWikiFromCloud(tenantId, existing.db, getCloudDb());
    } catch (err) {
      console.warn(
        `[wiki] migrate for ${tenantId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
    try {
      migrateHooksFromCloud(tenantId, existing.db, getCloudDb());
    } catch (err) {
      console.warn(
        `[hooks] migrate for ${tenantId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
    try {
      migratePlatformEventsFromCloud(tenantId, existing.db, getCloudDb());
    } catch (err) {
      console.warn(
        `[platform_events] migrate for ${tenantId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
    repairPersonalTenantIfNeeded(existing.db);
    return existing.db;
  }

  fs.mkdirSync(config.tenantsDir, { recursive: true });
  const filePath = tenantDbPath(tenantId);
  const db = new Database(filePath);
  configureDbPragmas(db);
  logDbConfig(db);
  migrateTenantDb(db);
  try {
    migrateWikiFromCloud(tenantId, db, getCloudDb());
  } catch (err) {
    console.warn(
      `[wiki] migrate for ${tenantId} failed:`,
      err instanceof Error ? err.message : err
    );
  }
  try {
    migrateHooksFromCloud(tenantId, db, getCloudDb());
  } catch (err) {
    console.warn(
      `[hooks] migrate for ${tenantId} failed:`,
      err instanceof Error ? err.message : err
    );
  }
  try {
    migratePlatformEventsFromCloud(tenantId, db, getCloudDb());
  } catch (err) {
    console.warn(
      `[platform_events] migrate for ${tenantId} failed:`,
      err instanceof Error ? err.message : err
    );
  }
  const kind = ensureTenantKindMeta(tenantId, db);
  if (kind === "operator") {
    try {
      seedDomainSkills(db);
    } catch {
      /* optional */
    }
  }

  tenantDbIdentity.set(db, { tenantId });
  cache.set(tenantId, { db, lastAccess: Date.now() });
  evictIfNeeded();
  ensureIdleTimer();
  repairPersonalTenantIfNeeded(db);
  return db;
}

/**
 * Close and forget a single tenant's cached SQLite handle. Required before
 * deleting a tenant's .sqlite file on Windows, where an open handle keeps the
 * file locked (unlink would fail with EBUSY/EPERM). Also unpins it.
 */
export function evictTenantDb(tenantId: string): void {
  pinCounts.delete(tenantId);
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
  pinCounts.clear();
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
