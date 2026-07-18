import type { Request } from "express";
import type { AppDatabase } from "../db.js";
import { getCoreDb } from "../core-db.js";
import type { ShareGrantRole } from "../core-db.js";
import { getAgent } from "../services/agents/agents-db.js";
import { resolveShareAccess } from "../services/share-service.js";
import { KernelError } from "./record-api.js";

export const GODMODE_AGENT_HEADER = "X-GodMode-Agent-Id";

export type KernelAgentScope = {
  agentId: string;
  db: AppDatabase;
  tenantId: string;
  owned: boolean;
  role: ShareGrantRole | "owner";
};

/**
 * Resolve agent scoping for HTTP Record API requests.
 * Accepts `?agentId=` or `X-GodMode-Agent-Id`. Own agents live in the caller's
 * tenant DB; shared agents resolve via share grants (minRole editor for writes).
 */
export function resolveAgentIdFromRequest(req: Request): string | undefined {
  const header = req.get(GODMODE_AGENT_HEADER)?.trim();
  const query = req.query.agentId;
  const fromQuery = typeof query === "string" ? query.trim() : undefined;
  const raw = header || fromQuery;
  return raw || undefined;
}

export function resolveKernelAgentScope(
  req: Request,
  agentId: string,
  minRole: ShareGrantRole = "editor"
): KernelAgentScope {
  const tenantDb = (req.tenantDb ?? undefined) as AppDatabase | undefined;
  if (!tenantDb || !req.tenantId) {
    throw new KernelError(401, "Authenticated tenant required for agent scope");
  }
  if (getAgent(tenantDb, agentId)) {
    return {
      agentId,
      db: tenantDb,
      tenantId: req.tenantId,
      owned: true,
      role: "owner",
    };
  }
  const userId = req.user?.id;
  if (!userId) {
    throw new KernelError(404, `Agent not found: ${agentId}`);
  }
  const access = resolveShareAccess(getCoreDb(), {
    userId,
    tenantId: req.tenantId,
    resourceKind: "agent",
    resourceId: agentId,
    minRole,
  });
  if (!access) {
    throw new KernelError(404, `Agent not found: ${agentId}`);
  }
  return {
    agentId,
    db: access.db,
    tenantId: access.ownerTenantId,
    owned: false,
    role: access.role,
  };
}
