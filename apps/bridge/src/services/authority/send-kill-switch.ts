/**
 * Runtime send kill switches (#96 Slice 6).
 * Stored in core platform_meta; no image redeploy required.
 */
import { getCoreDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";

const CACHE_MS = 3_000;

export const META_GLOBAL_SEND_DISABLED = "authority.send_disabled";

export function tenantSendDisabledKey(tenantId: string): string {
  return `authority.tenant.${tenantId}.send_disabled`;
}

type KillCache = {
  at: number;
  sendDisabled: boolean;
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
    sendDisabled: readFlag(META_GLOBAL_SEND_DISABLED),
  };
  return globalCache;
}

function cachedTenant(tenantId: string): KillCache {
  const now = Date.now();
  const hit = tenantCache.get(tenantId);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const next: KillCache = {
    at: now,
    sendDisabled: readFlag(tenantSendDisabledKey(tenantId)),
  };
  tenantCache.set(tenantId, next);
  return next;
}

export function invalidateSendKillSwitchCache(tenantId?: string): void {
  globalCache = null;
  if (tenantId) tenantCache.delete(tenantId);
  else tenantCache.clear();
}

/** Env nuclear: PLATFORM_SEND_DISABLED=true */
export function isEnvSendKillActive(): boolean {
  const raw = (process.env.PLATFORM_SEND_DISABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function isGlobalSendKillActive(): boolean {
  return cachedGlobal().sendDisabled;
}

export function isTenantSendKillActive(tenantId: string): boolean {
  return cachedTenant(tenantId).sendDisabled;
}

export type SendKillState = {
  envDisabled: boolean;
  global: { sendDisabled: boolean };
  tenants: Record<string, { sendDisabled: boolean }>;
};

export function getSendKillState(tenantIds?: string[]): SendKillState {
  const global = cachedGlobal();
  const tenants: SendKillState["tenants"] = {};
  for (const id of tenantIds ?? []) {
    tenants[id] = { sendDisabled: cachedTenant(id).sendDisabled };
  }
  return {
    envDisabled: isEnvSendKillActive(),
    global: { sendDisabled: global.sendDisabled },
    tenants,
  };
}

export function setGlobalSendKill(opts: { sendDisabled?: boolean }): void {
  const core = getCoreDb();
  if (opts.sendDisabled === true) {
    setPlatformMeta(core, META_GLOBAL_SEND_DISABLED, "true");
  } else if (opts.sendDisabled === false) {
    setPlatformMeta(core, META_GLOBAL_SEND_DISABLED, "false");
  }
  invalidateSendKillSwitchCache();
}

export function setTenantSendKill(
  tenantId: string,
  opts: { sendDisabled?: boolean }
): void {
  const core = getCoreDb();
  const tid = tenantId.trim();
  if (!tid) throw new Error("tenantId required");
  if (opts.sendDisabled === true) {
    setPlatformMeta(core, tenantSendDisabledKey(tid), "true");
  } else if (opts.sendDisabled === false) {
    setPlatformMeta(core, tenantSendDisabledKey(tid), "false");
  }
  invalidateSendKillSwitchCache(tid);
}
