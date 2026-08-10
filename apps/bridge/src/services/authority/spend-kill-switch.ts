/**
 * Runtime spend kill switches (#96 Slice 3 / thin #91 wire).
 * Stored in core platform_meta; no image redeploy required.
 */
import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";

const CACHE_MS = 3_000;

export const META_GLOBAL_SPEND_DISABLED = "authority.spend_disabled";

export function tenantSpendDisabledKey(tenantId: string): string {
  return `authority.tenant.${tenantId}.spend_disabled`;
}

type KillCache = {
  at: number;
  spendDisabled: boolean;
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
    spendDisabled: readFlag(META_GLOBAL_SPEND_DISABLED),
  };
  return globalCache;
}

function cachedTenant(tenantId: string): KillCache {
  const now = Date.now();
  const hit = tenantCache.get(tenantId);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const next: KillCache = {
    at: now,
    spendDisabled: readFlag(tenantSpendDisabledKey(tenantId)),
  };
  tenantCache.set(tenantId, next);
  return next;
}

export function invalidateSpendKillSwitchCache(tenantId?: string): void {
  globalCache = null;
  if (tenantId) tenantCache.delete(tenantId);
  else tenantCache.clear();
}

/** Env nuclear: PLATFORM_SPEND_DISABLED=true */
export function isEnvSpendKillActive(): boolean {
  const raw = (process.env.PLATFORM_SPEND_DISABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function isGlobalSpendKillActive(): boolean {
  return cachedGlobal().spendDisabled;
}

export function isTenantSpendKillActive(tenantId: string): boolean {
  return cachedTenant(tenantId).spendDisabled;
}

export type SpendKillState = {
  envDisabled: boolean;
  global: { spendDisabled: boolean };
  tenants: Record<string, { spendDisabled: boolean }>;
};

export function getSpendKillState(tenantIds?: string[]): SpendKillState {
  const global = cachedGlobal();
  const tenants: SpendKillState["tenants"] = {};
  for (const id of tenantIds ?? []) {
    tenants[id] = { spendDisabled: cachedTenant(id).spendDisabled };
  }
  return {
    envDisabled: isEnvSpendKillActive(),
    global: { spendDisabled: global.spendDisabled },
    tenants,
  };
}

export function setGlobalSpendKill(opts: { spendDisabled?: boolean }): void {
  const core = getCloudDb();
  if (opts.spendDisabled === true) {
    setPlatformMeta(core, META_GLOBAL_SPEND_DISABLED, "true");
  } else if (opts.spendDisabled === false) {
    setPlatformMeta(core, META_GLOBAL_SPEND_DISABLED, "false");
  }
  invalidateSpendKillSwitchCache();
}

export function setTenantSpendKill(
  tenantId: string,
  opts: { spendDisabled?: boolean }
): void {
  const core = getCloudDb();
  const tid = tenantId.trim();
  if (!tid) throw new Error("tenantId required");
  if (opts.spendDisabled === true) {
    setPlatformMeta(core, tenantSpendDisabledKey(tid), "true");
  } else if (opts.spendDisabled === false) {
    setPlatformMeta(core, tenantSpendDisabledKey(tid), "false");
  }
  invalidateSpendKillSwitchCache(tid);
}
