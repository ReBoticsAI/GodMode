/**
 * Runtime deploy kill switches (#96 Slice 4).
 * Stored in core platform_meta; no image redeploy required.
 */
import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";

const CACHE_MS = 3_000;

export const META_GLOBAL_DEPLOY_DISABLED = "authority.deploy_disabled";

export function tenantDeployDisabledKey(tenantId: string): string {
  return `authority.tenant.${tenantId}.deploy_disabled`;
}

type KillCache = {
  at: number;
  deployDisabled: boolean;
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
    deployDisabled: readFlag(META_GLOBAL_DEPLOY_DISABLED),
  };
  return globalCache;
}

function cachedTenant(tenantId: string): KillCache {
  const now = Date.now();
  const hit = tenantCache.get(tenantId);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const next: KillCache = {
    at: now,
    deployDisabled: readFlag(tenantDeployDisabledKey(tenantId)),
  };
  tenantCache.set(tenantId, next);
  return next;
}

export function invalidateDeployKillSwitchCache(tenantId?: string): void {
  globalCache = null;
  if (tenantId) tenantCache.delete(tenantId);
  else tenantCache.clear();
}

/** Env nuclear: PLATFORM_DEPLOY_DISABLED=true */
export function isEnvDeployKillActive(): boolean {
  const raw = (process.env.PLATFORM_DEPLOY_DISABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function isGlobalDeployKillActive(): boolean {
  return cachedGlobal().deployDisabled;
}

export function isTenantDeployKillActive(tenantId: string): boolean {
  return cachedTenant(tenantId).deployDisabled;
}

export type DeployKillState = {
  envDisabled: boolean;
  global: { deployDisabled: boolean };
  tenants: Record<string, { deployDisabled: boolean }>;
};

export function getDeployKillState(tenantIds?: string[]): DeployKillState {
  const global = cachedGlobal();
  const tenants: DeployKillState["tenants"] = {};
  for (const id of tenantIds ?? []) {
    tenants[id] = { deployDisabled: cachedTenant(id).deployDisabled };
  }
  return {
    envDisabled: isEnvDeployKillActive(),
    global: { deployDisabled: global.deployDisabled },
    tenants,
  };
}

export function setGlobalDeployKill(opts: { deployDisabled?: boolean }): void {
  const core = getCloudDb();
  if (opts.deployDisabled === true) {
    setPlatformMeta(core, META_GLOBAL_DEPLOY_DISABLED, "true");
  } else if (opts.deployDisabled === false) {
    setPlatformMeta(core, META_GLOBAL_DEPLOY_DISABLED, "false");
  }
  invalidateDeployKillSwitchCache();
}

export function setTenantDeployKill(
  tenantId: string,
  opts: { deployDisabled?: boolean }
): void {
  const core = getCloudDb();
  const tid = tenantId.trim();
  if (!tid) throw new Error("tenantId required");
  if (opts.deployDisabled === true) {
    setPlatformMeta(core, tenantDeployDisabledKey(tid), "true");
  } else if (opts.deployDisabled === false) {
    setPlatformMeta(core, tenantDeployDisabledKey(tid), "false");
  }
  invalidateDeployKillSwitchCache(tid);
}
