import type { AppDatabase } from "../db.js";
import { getAgent } from "./agents/agents-db.js";

export type AssignmentScopeType = "department" | "division" | "page";

export type AssignmentRole = "viewer" | "editor" | "owner";

const ASSIGNMENT_ROLES: AssignmentRole[] = ["viewer", "editor", "owner"];

export function isAssignmentRole(value: unknown): value is AssignmentRole {
  return (
    typeof value === "string" && ASSIGNMENT_ROLES.includes(value as AssignmentRole)
  );
}

export interface AiAgentAssignment {
  scope_type: AssignmentScopeType;
  scope_id: string;
  agent_id: string;
  role: AssignmentRole;
  updated_at: string;
}

export type InheritedFrom = "page" | "division" | "department" | "root";

export interface ResolvedAgent {
  agentId: string;
  inheritedFrom: InheritedFrom;
}

const SCOPE_TYPES: AssignmentScopeType[] = ["department", "division", "page"];

export function isAssignmentScopeType(value: unknown): value is AssignmentScopeType {
  return typeof value === "string" && SCOPE_TYPES.includes(value as AssignmentScopeType);
}

export function departmentScopeId(departmentId: string): string {
  return departmentId;
}

export function divisionScopeId(departmentId: string, divisionId: string): string {
  return `${departmentId}/${divisionId}`;
}

export function pageScopeId(
  departmentId: string,
  divisionId: string,
  pageId: string
): string {
  return `${departmentId}/${divisionId}/${pageId}`;
}

export function listAssignments(db: AppDatabase): AiAgentAssignment[] {
  return db
    .prepare(
      `SELECT scope_type, scope_id, agent_id, role, updated_at
       FROM ai_agent_assignments
       ORDER BY scope_type, scope_id`
    )
    .all() as AiAgentAssignment[];
}

export function getAssignment(
  db: AppDatabase,
  scopeType: AssignmentScopeType,
  scopeId: string
): AiAgentAssignment | null {
  const row = db
    .prepare(
      `SELECT scope_type, scope_id, agent_id, role, updated_at
       FROM ai_agent_assignments
       WHERE scope_type = ? AND scope_id = ?`
    )
    .get(scopeType, scopeId) as AiAgentAssignment | undefined;
  return row ?? null;
}

export class AssignmentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function setAssignment(
  db: AppDatabase,
  scopeType: AssignmentScopeType,
  scopeId: string,
  agentId: string | null | undefined,
  role?: AssignmentRole | null
): AiAgentAssignment | null {
  if (!isAssignmentScopeType(scopeType)) {
    throw new AssignmentError(400, "invalid scopeType");
  }
  if (typeof scopeId !== "string" || scopeId.trim().length === 0) {
    throw new AssignmentError(400, "scopeId required");
  }
  if (role != null && !isAssignmentRole(role)) {
    throw new AssignmentError(400, "invalid role");
  }
  const normalized = typeof agentId === "string" ? agentId.trim() : "";
  if (!normalized) {
    db.prepare(
      `DELETE FROM ai_agent_assignments WHERE scope_type = ? AND scope_id = ?`
    ).run(scopeType, scopeId);
    return null;
  }
  if (!getAgent(db, normalized)) {
    throw new AssignmentError(404, "agent not found");
  }
  // Default new assignments to 'owner' (back-compat); preserve the prior role
  // on update when the caller does not specify one.
  const existing = getAssignment(db, scopeType, scopeId);
  const nextRole: AssignmentRole = role ?? existing?.role ?? "owner";
  db.prepare(
    `INSERT INTO ai_agent_assignments (scope_type, scope_id, agent_id, role, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(scope_type, scope_id)
     DO UPDATE SET agent_id = excluded.agent_id, role = excluded.role, updated_at = datetime('now')`
  ).run(scopeType, scopeId, normalized, nextRole);
  return getAssignment(db, scopeType, scopeId);
}

/** Update only the role on an existing assignment. */
export function setAssignmentRole(
  db: AppDatabase,
  scopeType: AssignmentScopeType,
  scopeId: string,
  role: AssignmentRole
): AiAgentAssignment | null {
  if (!isAssignmentRole(role)) {
    throw new AssignmentError(400, "invalid role");
  }
  const existing = getAssignment(db, scopeType, scopeId);
  if (!existing) {
    throw new AssignmentError(404, "assignment not found");
  }
  return setAssignment(db, scopeType, scopeId, existing.agent_id, role);
}

export function resolveAgentForPage(
  db: AppDatabase,
  loc: { departmentId: string; divisionId?: string | null; pageId?: string | null }
): ResolvedAgent {
  const departmentId = loc.departmentId;
  const divisionId = loc.divisionId || null;
  const pageId = loc.pageId || null;

  if (divisionId && pageId) {
    const page = getAssignment(
      db,
      "page",
      pageScopeId(departmentId, divisionId, pageId)
    );
    if (page) return { agentId: page.agent_id, inheritedFrom: "page" };
  }
  if (divisionId) {
    const division = getAssignment(
      db,
      "division",
      divisionScopeId(departmentId, divisionId)
    );
    if (division) return { agentId: division.agent_id, inheritedFrom: "division" };
  }
  const department = getAssignment(
    db,
    "department",
    departmentScopeId(departmentId)
  );
  if (department) {
    return { agentId: department.agent_id, inheritedFrom: "department" };
  }
  return { agentId: "intelligence", inheritedFrom: "root" };
}
