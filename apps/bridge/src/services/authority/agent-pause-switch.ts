/**
 * Runtime agent execution pause switches (#96 Slice 8).
 * Stored in core platform_meta; no image redeploy required.
 */
import { getCoreDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";

const CACHE_MS = 3_000;

export const META_GLOBAL_AGENTS_PAUSED = "authority.agents_paused";

export function tenantAgentsPausedKey(tenantId: string): string {
  return `authority.tenant.${tenantId}.agents_paused`;
}

export function tenantAgentPausedKey(tenantId: string, agentId: string): string {
  return `authority.tenant.${tenantId}.agent.${agentId}.paused`;
}

type PauseCache = {
  at: number;
  paused: boolean;
};

let globalCache: PauseCache | null = null;
const tenantCache = new Map<string, PauseCache>();
const agentCache = new Map<string, PauseCache>();

function readFlag(key: string): boolean {
  const raw = getPlatformMeta(getCoreDb(), key);
  return raw === "true" || raw === "1";
}

function cachedGlobal(): PauseCache {
  const now = Date.now();
  if (globalCache && now - globalCache.at < CACHE_MS) return globalCache;
  globalCache = {
    at: now,
    paused: readFlag(META_GLOBAL_AGENTS_PAUSED),
  };
  return globalCache;
}

function cachedTenant(tenantId: string): PauseCache {
  const now = Date.now();
  const hit = tenantCache.get(tenantId);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const next: PauseCache = {
    at: now,
    paused: readFlag(tenantAgentsPausedKey(tenantId)),
  };
  tenantCache.set(tenantId, next);
  return next;
}

function cachedAgent(tenantId: string, agentId: string): PauseCache {
  const key = `${tenantId}:${agentId}`;
  const now = Date.now();
  const hit = agentCache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const next: PauseCache = {
    at: now,
    paused: readFlag(tenantAgentPausedKey(tenantId, agentId)),
  };
  agentCache.set(key, next);
  return next;
}

export function invalidateAgentPauseSwitchCache(opts?: {
  tenantId?: string;
  agentId?: string;
}): void {
  globalCache = null;
  if (!opts?.tenantId) {
    tenantCache.clear();
    agentCache.clear();
    return;
  }
  tenantCache.delete(opts.tenantId);
  if (opts.agentId) {
    agentCache.delete(`${opts.tenantId}:${opts.agentId}`);
  } else {
    for (const key of agentCache.keys()) {
      if (key.startsWith(`${opts.tenantId}:`)) agentCache.delete(key);
    }
  }
}

/** Env nuclear: PLATFORM_AGENTS_DISABLED=true */
export function isEnvAgentPauseActive(): boolean {
  const raw = (process.env.PLATFORM_AGENTS_DISABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function isGlobalAgentPauseActive(): boolean {
  return cachedGlobal().paused;
}

export function isTenantAgentPauseActive(tenantId: string): boolean {
  return cachedTenant(tenantId).paused;
}

export function isPerAgentPauseActive(tenantId: string, agentId: string): boolean {
  return cachedAgent(tenantId, agentId).paused;
}

export type AgentPauseKillState = {
  envDisabled: boolean;
  global: { agentsPaused: boolean };
  tenants: Record<string, { agentsPaused: boolean }>;
};

export function getAgentPauseKillState(tenantIds?: string[]): AgentPauseKillState {
  const global = cachedGlobal();
  const tenants: AgentPauseKillState["tenants"] = {};
  for (const id of tenantIds ?? []) {
    tenants[id] = { agentsPaused: cachedTenant(id).paused };
  }
  return {
    envDisabled: isEnvAgentPauseActive(),
    global: { agentsPaused: global.paused },
    tenants,
  };
}

export function setGlobalAgentPause(opts: { agentsPaused?: boolean }): void {
  const core = getCoreDb();
  if (opts.agentsPaused === true) {
    setPlatformMeta(core, META_GLOBAL_AGENTS_PAUSED, "true");
  } else if (opts.agentsPaused === false) {
    setPlatformMeta(core, META_GLOBAL_AGENTS_PAUSED, "false");
  }
  invalidateAgentPauseSwitchCache();
}

export function setTenantAgentPause(
  tenantId: string,
  opts: { agentsPaused?: boolean }
): void {
  const core = getCoreDb();
  const tid = tenantId.trim();
  if (!tid) throw new Error("tenantId required");
  if (opts.agentsPaused === true) {
    setPlatformMeta(core, tenantAgentsPausedKey(tid), "true");
  } else if (opts.agentsPaused === false) {
    setPlatformMeta(core, tenantAgentsPausedKey(tid), "false");
  }
  invalidateAgentPauseSwitchCache({ tenantId: tid });
}

export function setAgentPause(
  tenantId: string,
  agentId: string,
  opts: { paused?: boolean }
): void {
  const core = getCoreDb();
  const tid = tenantId.trim();
  const aid = agentId.trim();
  if (!tid || !aid) throw new Error("tenantId and agentId required");
  if (opts.paused === true) {
    setPlatformMeta(core, tenantAgentPausedKey(tid, aid), "true");
  } else if (opts.paused === false) {
    setPlatformMeta(core, tenantAgentPausedKey(tid, aid), "false");
  }
  invalidateAgentPauseSwitchCache({ tenantId: tid, agentId: aid });
}
