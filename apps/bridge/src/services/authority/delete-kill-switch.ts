/**
 * Runtime delete kill switches (#96 Slice 5).
 * Stored in core platform_meta; no image redeploy required.
 */
import { getCoreDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";

const CACHE_MS = 3_000;

export const META_GLOBAL_DELETE_DISABLED = "authority.delete_disabled";

export function tenantDeleteDisabledKey(tenantId: string): string {
  return `authority.tenant.${tenantId}.delete_disabled`;
}

type KillCache = {
  at: number;
  deleteDisabled: boolean;
};

let globalCache: KillCache | null = null;
const tenantCache = new Map<string, KillCache>();

function readFlag(key: string): boolean {
  const raw = getPlatformMeta(getCoreDb(), key);
  return raw === "true" || raw === "1";
}

function cachedGlobal(): KillCache {
  const now = Date.now();
  if (globalCache && now - globalCache.at < CACHE_MS) return globalCache;
  globalCache = {
    at: now,
    deleteDisabled: readFlag(META_GLOBAL_DELETE_DISABLED),
  };
  return globalCache;
}

function cachedTenant(tenantId: string): KillCache {
  const now = Date.now();
  const hit = tenantCache.get(tenantId);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const next: KillCache = {
    at: now,
    deleteDisabled: readFlag(tenantDeleteDisabledKey(tenantId)),
  };
  tenantCache.set(tenantId, next);
  return next;
}

export function invalidateDeleteKillSwitchCache(tenantId?: string): void {
  globalCache = null;
  if (tenantId) tenantCache.delete(tenantId);
  else tenantCache.clear();
}

/** Env nuclear: PLATFORM_DELETE_DISABLED=true */
export function isEnvDeleteKillActive(): boolean {
  const raw = (process.env.PLATFORM_DELETE_DISABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function isGlobalDeleteKillActive(): boolean {
  return cachedGlobal().deleteDisabled;
}

export function isTenantDeleteKillActive(tenantId: string): boolean {
  return cachedTenant(tenantId).deleteDisabled;
}

export type DeleteKillState = {
  envDisabled: boolean;
  global: { deleteDisabled: boolean };
  tenants: Record<string, { deleteDisabled: boolean }>;
};

export function getDeleteKillState(tenantIds?: string[]): DeleteKillState {
  const global = cachedGlobal();
  const tenants: DeleteKillState["tenants"] = {};
  for (const id of tenantIds ?? []) {
    tenants[id] = { deleteDisabled: cachedTenant(id).deleteDisabled };
  }
  return {
    envDisabled: isEnvDeleteKillActive(),
    global: { deleteDisabled: global.deleteDisabled },
    tenants,
  };
}

export function setGlobalDeleteKill(opts: { deleteDisabled?: boolean }): void {
  const core = getCoreDb();
  if (opts.deleteDisabled === true) {
    setPlatformMeta(core, META_GLOBAL_DELETE_DISABLED, "true");
  } else if (opts.deleteDisabled === false) {
    setPlatformMeta(core, META_GLOBAL_DELETE_DISABLED, "false");
  }
  invalidateDeleteKillSwitchCache();
}

export function setTenantDeleteKill(
  tenantId: string,
  opts: { deleteDisabled?: boolean }
): void {
  const core = getCoreDb();
  const tid = tenantId.trim();
  if (!tid) throw new Error("tenantId required");
  if (opts.deleteDisabled === true) {
    setPlatformMeta(core, tenantDeleteDisabledKey(tid), "true");
  } else if (opts.deleteDisabled === false) {
    setPlatformMeta(core, tenantDeleteDisabledKey(tid), "false");
  }
  invalidateDeleteKillSwitchCache(tid);
}
