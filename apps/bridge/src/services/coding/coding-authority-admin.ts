/**
 * Admin Authority read models for coding (#96 Slice 2).
 */
import { config } from "../../config.js";
import { getCloudDb, listAllTenantIds } from "../../core-db.js";
import { getTenantDb } from "../../tenant-registry.js";
import { ensureToolAuditTable } from "./tool-audit.js";
import {
  assertBuildSupervisorUrl,
  codingBuildMode,
} from "./ephemeral-build.js";
import { getCodingKillState } from "./coding-kill-switch.js";
import { getCodingQuotaSnapshot } from "./coding-quota.js";
import { countOpenPtySessions } from "./terminal-session-manager.js";

export type CodingAuthorityEvent = {
  tenantId: string;
  tenantName: string | null;
  agentId: string;
  userId: string | null;
  action: string;
  result: string;
  command: string | null;
  createdAt: string;
};

export function listCodingAuthorityEvents(limit = 100): CodingAuthorityEvent[] {
  const cap = Math.max(1, Math.min(Math.floor(limit) || 100, 500));
  const core = getCloudDb();
  const tenantRows = core
    .prepare(`SELECT id, name FROM tenants ORDER BY name ASC`)
    .all() as Array<{ id: string; name: string }>;
  const nameById = new Map(tenantRows.map((t) => [t.id, t.name]));
  const tenantIds = listAllTenantIds(core);

  const events: CodingAuthorityEvent[] = [];
  for (const tenantId of tenantIds) {
    try {
      const db = getTenantDb(tenantId);
      ensureToolAuditTable(db);
      const rows = db
        .prepare(
          `SELECT agent_id, user_id, action, result, command, created_at
           FROM tool_audit_log
           WHERE result LIKE 'quota:%' OR result LIKE 'kill:%'
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(cap) as Array<{
        agent_id: string;
        user_id: string | null;
        action: string;
        result: string;
        command: string | null;
        created_at: string;
      }>;
      for (const row of rows) {
        events.push({
          tenantId,
          tenantName: nameById.get(tenantId) ?? null,
          agentId: row.agent_id,
          userId: row.user_id,
          action: row.action,
          result: row.result,
          command: row.command,
          createdAt: row.created_at,
        });
      }
    } catch {
      /* tenant DB missing or unreadable: skip */
    }
  }

  events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return events.slice(0, cap);
}

export type BuildSupervisorHealth = {
  ok: boolean;
  reachable: boolean;
  error?: string;
  concurrency?: {
    globalActive?: number;
    globalLimit?: number;
    tenantActive?: Record<string, number>;
    tenantLimit?: number;
  };
  defaultNet?: string;
  egressNetwork?: string;
};

async function fetchBuildSupervisorHealth(): Promise<BuildSupervisorHealth | null> {
  if (codingBuildMode() !== "ephemeral") return null;
  const urlRaw = config.codingBuildSupervisorUrl.trim();
  if (!urlRaw) return null;
  try {
    const base = assertBuildSupervisorUrl(urlRaw);
    const healthUrl = new URL("health", `${base.href.replace(/\/?$/, "/")}`);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2500);
    try {
      const res = await fetch(healthUrl, { signal: ac.signal });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return {
          ok: false,
          reachable: true,
          error: `Non-JSON health (HTTP ${res.status})`,
        };
      }
      const concurrency = body.concurrency as
        | BuildSupervisorHealth["concurrency"]
        | undefined;
      return {
        ok: Boolean(body.ok) && res.ok,
        reachable: true,
        concurrency,
        defaultNet:
          body.defaultNet != null ? String(body.defaultNet) : undefined,
        egressNetwork:
          body.egressNetwork != null ? String(body.egressNetwork) : undefined,
        error: res.ok ? undefined : String(body.error ?? `HTTP ${res.status}`),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getCodingAuthorityStatus() {
  const core = getCloudDb();
  const tenantRows = core
    .prepare(
      `SELECT id, name, is_operator FROM tenants ORDER BY is_operator DESC, name ASC`
    )
    .all() as Array<{ id: string; name: string; is_operator: number }>;
  const tenantIds = tenantRows.map((t) => t.id);
  const kills = getCodingKillState(tenantIds);
  const quota = getCodingQuotaSnapshot();
  const supervisor = await fetchBuildSupervisorHealth();

  return {
    kills,
    quota,
    tenants: tenantRows.map((t) => ({
      id: t.id,
      name: t.name,
      isOperator: Boolean(t.is_operator),
      openPtySessions: countOpenPtySessions(t.id),
      terminalActive: quota.live.terminalByTenant[t.id] ?? 0,
      codingDisabled: Boolean(kills.tenants[t.id]?.codingDisabled),
      buildsDisabled: Boolean(kills.tenants[t.id]?.buildsDisabled),
    })),
    supervisor,
    platform: {
      isSaas: config.isSaas,
      saasAllowCodeAccess: config.saasAllowCodeAccess,
    },
  };
}
