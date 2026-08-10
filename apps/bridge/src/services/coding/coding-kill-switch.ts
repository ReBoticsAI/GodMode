/**
 * Runtime coding/build kill switches (#96 Slice 1 / former #179).
 * Stored in core platform_meta; no image redeploy required.
 */
import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";

const CACHE_MS = 3_000;

export const META_GLOBAL_CODING_DISABLED = "authority.coding_disabled";
export const META_GLOBAL_BUILDS_DISABLED = "authority.builds_disabled";

export function tenantCodingDisabledKey(tenantId: string): string {
  return `authority.tenant.${tenantId}.coding_disabled`;
}

export function tenantBuildsDisabledKey(tenantId: string): string {
  return `authority.tenant.${tenantId}.builds_disabled`;
}

type KillCache = {
  at: number;
  codingDisabled: boolean;
  buildsDisabled: boolean;
};

let globalCache: KillCache | null = null;
const tenantCache = new Map<string, KillCache>();

function readFlag(key: string): boolean {
  const raw = getPlatformMeta(getCloudDb(), key);
  return raw === "true" || raw === "1";
}

function cachedGlobal(): KillCache {
  const now = Date.now();
  if (globalCache && now - globalCache.at < CACHE_MS) return globalCache;
  globalCache = {
    at: now,
    codingDisabled: readFlag(META_GLOBAL_CODING_DISABLED),
    buildsDisabled: readFlag(META_GLOBAL_BUILDS_DISABLED),
  };
  return globalCache;
}

function cachedTenant(tenantId: string): KillCache {
  const now = Date.now();
  const hit = tenantCache.get(tenantId);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const next: KillCache = {
    at: now,
    codingDisabled: readFlag(tenantCodingDisabledKey(tenantId)),
    buildsDisabled: readFlag(tenantBuildsDisabledKey(tenantId)),
  };
  tenantCache.set(tenantId, next);
  return next;
}

/** Clear in-process cache after admin updates. */
export function invalidateCodingKillSwitchCache(tenantId?: string): void {
  globalCache = null;
  if (tenantId) tenantCache.delete(tenantId);
  else tenantCache.clear();
}

export function isGlobalCodingKillActive(): boolean {
  return cachedGlobal().codingDisabled;
}

export function isGlobalBuildsKillActive(): boolean {
  return cachedGlobal().buildsDisabled;
}

export function isTenantCodingKillActive(tenantId: string): boolean {
  return cachedTenant(tenantId).codingDisabled;
}

export function isTenantBuildsKillActive(tenantId: string): boolean {
  return cachedTenant(tenantId).buildsDisabled;
}

export type CodingKillState = {
  global: { codingDisabled: boolean; buildsDisabled: boolean };
  tenants: Record<
    string,
    { codingDisabled: boolean; buildsDisabled: boolean }
  >;
};

export function getCodingKillState(tenantIds?: string[]): CodingKillState {
  const global = cachedGlobal();
  const tenants: CodingKillState["tenants"] = {};
  for (const id of tenantIds ?? []) {
    const t = cachedTenant(id);
    tenants[id] = {
      codingDisabled: t.codingDisabled,
      buildsDisabled: t.buildsDisabled,
    };
  }
  return {
    global: {
      codingDisabled: global.codingDisabled,
      buildsDisabled: global.buildsDisabled,
    },
    tenants,
  };
}

export function setGlobalCodingKill(opts: {
  codingDisabled?: boolean;
  buildsDisabled?: boolean;
}): void {
  const core = getCloudDb();
  if (opts.codingDisabled === true) {
    setPlatformMeta(core, META_GLOBAL_CODING_DISABLED, "true");
  } else if (opts.codingDisabled === false) {
    setPlatformMeta(core, META_GLOBAL_CODING_DISABLED, "false");
  }
  if (opts.buildsDisabled === true) {
    setPlatformMeta(core, META_GLOBAL_BUILDS_DISABLED, "true");
  } else if (opts.buildsDisabled === false) {
    setPlatformMeta(core, META_GLOBAL_BUILDS_DISABLED, "false");
  }
  invalidateCodingKillSwitchCache();
}

export function setTenantCodingKill(
  tenantId: string,
  opts: { codingDisabled?: boolean; buildsDisabled?: boolean }
): void {
  const core = getCloudDb();
  const tid = tenantId.trim();
  if (!tid) throw new Error("tenantId required");
  if (opts.codingDisabled === true) {
    setPlatformMeta(core, tenantCodingDisabledKey(tid), "true");
  } else if (opts.codingDisabled === false) {
    setPlatformMeta(core, tenantCodingDisabledKey(tid), "false");
  }
  if (opts.buildsDisabled === true) {
    setPlatformMeta(core, tenantBuildsDisabledKey(tid), "true");
  } else if (opts.buildsDisabled === false) {
    setPlatformMeta(core, tenantBuildsDisabledKey(tid), "false");
  }
  invalidateCodingKillSwitchCache(tid);
}
