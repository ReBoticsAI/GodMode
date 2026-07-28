/**
 * Admin Authority read models for agent execution pause (#96 Slice 8).
 */
import { getCoreDb, listAllTenantIds } from "../../core-db.js";
import { getTenantDb } from "../../tenant-registry.js";
import { listAgents } from "../agents/agents-db.js";
import { ensureToolAuditTable } from "../coding/tool-audit.js";
import {
  getAgentPauseKillState,
  isPerAgentPauseActive,
} from "./agent-pause-switch.js";

export type AgentPauseAuthorityEvent = {
  tenantId: string;
  tenantName: string | null;
  agentId: string;
  userId: string | null;
  action: string;
  result: string;
  command: string | null;
  createdAt: string;
};

export function listAgentPauseAuthorityEvents(
  limit = 100
): AgentPauseAuthorityEvent[] {
  const cap = Math.max(1, Math.min(Math.floor(limit) || 100, 500));
  const core = getCoreDb();
  const tenantRows = core
    .prepare(`SELECT id, name FROM tenants ORDER BY name ASC`)
    .all() as Array<{ id: string; name: string }>;
  const nameById = new Map(tenantRows.map((t) => [t.id, t.name]));
  const tenantIds = listAllTenantIds(core);

  const events: AgentPauseAuthorityEvent[] = [];
  for (const tenantId of tenantIds) {
    try {
      const db = getTenantDb(tenantId);
      ensureToolAuditTable(db);
      const rows = db
        .prepare(
          `SELECT agent_id, user_id, action, result, command, created_at
           FROM tool_audit_log
           WHERE result LIKE 'kill:%agent%'
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

  events.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
  return events.slice(0, cap);
}

export function getAgentPauseAuthorityStatus() {
  const core = getCoreDb();
  const tenantRows = core
    .prepare(
      `SELECT id, name, is_operator FROM tenants ORDER BY is_operator DESC, name ASC`
    )
    .all() as Array<{ id: string; name: string; is_operator: number }>;
  const tenantIds = tenantRows.map((t) => t.id);
  const kills = getAgentPauseKillState(tenantIds);

  return {
    kills,
    tenants: tenantRows.map((t) => {
      let agents: Array<{
        id: string;
        name: string;
        enabled: boolean;
        paused: boolean;
      }> = [];
      try {
        const db = getTenantDb(t.id);
        agents = listAgents(db).map((a) => ({
          id: a.id,
          name: a.name,
          enabled: a.enabled,
          paused: isPerAgentPauseActive(t.id, a.id),
        }));
      } catch {
        /* skip unreadable tenant */
      }
      return {
        id: t.id,
        name: t.name,
        isOperator: Boolean(t.is_operator),
        agentsPaused: Boolean(kills.tenants[t.id]?.agentsPaused),
        agents,
      };
    }),
  };
}
