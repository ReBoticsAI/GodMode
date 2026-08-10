/**
 * Admin Authority read models for delete hard-stop (#96 Slice 5).
 */
import { getCloudDb, listAllTenantIds } from "../../core-db.js";
import { getTenantDb } from "../../tenant-registry.js";
import { ensureToolAuditTable } from "../coding/tool-audit.js";
import { getDeleteKillState } from "./delete-kill-switch.js";

export type DeleteAuthorityEvent = {
  tenantId: string;
  tenantName: string | null;
  agentId: string;
  userId: string | null;
  action: string;
  result: string;
  command: string | null;
  createdAt: string;
};

export function listDeleteAuthorityEvents(limit = 100): DeleteAuthorityEvent[] {
  const cap = Math.max(1, Math.min(Math.floor(limit) || 100, 500));
  const core = getCloudDb();
  const tenantRows = core
    .prepare(`SELECT id, name FROM tenants ORDER BY name ASC`)
    .all() as Array<{ id: string; name: string }>;
  const nameById = new Map(tenantRows.map((t) => [t.id, t.name]));
  const tenantIds = listAllTenantIds(core);

  const events: DeleteAuthorityEvent[] = [];
  for (const tenantId of tenantIds) {
    try {
      const db = getTenantDb(tenantId);
      ensureToolAuditTable(db);
      const rows = db
        .prepare(
          `SELECT agent_id, user_id, action, result, command, created_at
           FROM tool_audit_log
           WHERE result LIKE 'kill:%delete%'
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

export function getDeleteAuthorityStatus() {
  const core = getCloudDb();
  const tenantRows = core
    .prepare(
      `SELECT id, name, is_operator FROM tenants ORDER BY is_operator DESC, name ASC`
    )
    .all() as Array<{ id: string; name: string; is_operator: number }>;
  const tenantIds = tenantRows.map((t) => t.id);
  const kills = getDeleteKillState(tenantIds);

  return {
    kills,
    tenants: tenantRows.map((t) => ({
      id: t.id,
      name: t.name,
      isOperator: Boolean(t.is_operator),
      deleteDisabled: Boolean(kills.tenants[t.id]?.deleteDisabled),
    })),
  };
}
