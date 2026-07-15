import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { insertEvent } from "./data-management-migration.js";
import {
  type AssignmentRole,
  departmentScopeId,
  divisionScopeId,
  getAssignment,
  pageScopeId,
} from "./ai-agent-assignments.js";

export interface PlatformScope {
  departmentId: string;
  divisionId?: string | null;
  pageId?: string | null;
}

export class PlatformScopeError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

const ROLE_RANK: Record<AssignmentRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

/**
 * Minimum role each mutating Platform Builder action requires on its scope.
 * Read-only/auto tools are not gated here. `create_department` is global and
 * handled separately (superuser-only) since there is no platform-wide scope.
 */
const ACTION_MIN_ROLE: Record<string, AssignmentRole> = {
  // Structure (Phase A)
  create_division: "editor",
  create_page: "editor",
  update_structure_node: "editor",
  delete_structure_node: "owner",
  assign_agent: "owner",
  set_agent_role: "owner",
  attach_node_agent: "editor",
  bootstrap_sierra_area: "editor",
  bootstrap_polymarket_area: "editor",
  // Polymarket (Phase B)
  create_pm_strategy: "editor",
  update_pm_strategy: "editor",
  enable_pm_strategy: "owner",
  disable_pm_strategy: "owner",
  // Playbooks (Phase C)
  upsert_playbook_spec: "editor",
  sc_remove_all: "owner",
};

/** Actions that have no scope (platform-wide) and require the Intelligence superuser. */
const GLOBAL_ACTIONS = new Set<string>([
  "create_department",
  "create_agent",
  "create_record",
  "create_structure_node",
]);

function scopeLabel(scope: PlatformScope): string {
  if (scope.divisionId && scope.pageId) {
    return `page ${pageScopeId(scope.departmentId, scope.divisionId, scope.pageId)}`;
  }
  if (scope.divisionId) {
    return `division ${divisionScopeId(scope.departmentId, scope.divisionId)}`;
  }
  return `department ${scope.departmentId}`;
}

/** Role this agent holds at the nearest enclosing scope it is assigned to. */
function assignmentRoleFor(
  db: AppDatabase,
  scopeType: "department" | "division" | "page",
  scopeId: string,
  agentId: string
): AssignmentRole | null {
  const row = getAssignment(db, scopeType, scopeId);
  return row && row.agent_id === agentId ? row.role : null;
}

/** Walk page -> division -> department, mirroring resolveAgentForPage. */
function resolveRole(
  db: AppDatabase,
  agentId: string,
  scope: PlatformScope
): AssignmentRole | null {
  if (scope.divisionId && scope.pageId) {
    const r = assignmentRoleFor(
      db,
      "page",
      pageScopeId(scope.departmentId, scope.divisionId, scope.pageId),
      agentId
    );
    if (r) return r;
  }
  if (scope.divisionId) {
    const r = assignmentRoleFor(
      db,
      "division",
      divisionScopeId(scope.departmentId, scope.divisionId),
      agentId
    );
    if (r) return r;
  }
  return assignmentRoleFor(
    db,
    "department",
    departmentScopeId(scope.departmentId),
    agentId
  );
}

/**
 * Effective Platform Builder role for an agent at a scope.
 *   - `intelligence` is the global superuser (always `owner`).
 *   - `dept-<id>` is the implicit `owner` of its own department (and children).
 *   - otherwise resolved from explicit assignments (page -> division -> dept).
 */
export function effectiveRole(
  db: AppDatabase,
  agentId: string,
  scope: PlatformScope
): AssignmentRole | null {
  if (agentId === "intelligence") return "owner";
  if (agentId === `dept-${scope.departmentId}`) return "owner";
  return resolveRole(db, agentId, scope);
}

/**
 * Throw a {@link PlatformScopeError} unless `agentId` may perform `action` on
 * `scope`. Intelligence bypasses all checks. Unknown (ungated) actions are allowed.
 */
export function assertPlatformAction(
  db: AppDatabase,
  opts: { agentId: string; action: string; scope?: PlatformScope }
): void {
  const agentId = opts.agentId || "intelligence";
  if (agentId === "intelligence") return;

  if (GLOBAL_ACTIONS.has(opts.action)) {
    throw new PlatformScopeError(
      `'${opts.action}' is a platform-wide action restricted to the Intelligence superuser`
    );
  }

  const required = ACTION_MIN_ROLE[opts.action];
  if (required == null) return;
  if (!opts.scope) {
    throw new PlatformScopeError(`'${opts.action}' requires a scope`);
  }

  const role = effectiveRole(db, agentId, opts.scope);
  if (!role || ROLE_RANK[role] < ROLE_RANK[required]) {
    throw new PlatformScopeError(
      `Agent '${agentId}' needs '${required}' on ${scopeLabel(opts.scope)} but has '${role ?? "none"}'`
    );
  }
}

/** Append a Platform Builder mutation to the audit log (best effort). */
export function logPlatformAction(
  db: AppDatabase,
  entry: {
    agentId: string;
    action: string;
    scope?: PlatformScope;
    payload?: unknown;
    result: string;
  }
): void {
  try {
    const scopeStr = entry.scope ? scopeLabel(entry.scope) : null;
    const payloadHash =
      entry.payload != null
        ? createHash("sha256")
            .update(JSON.stringify(entry.payload))
            .digest("hex")
            .slice(0, 16)
        : null;
    db.prepare(
      `INSERT INTO platform_action_log (agent_id, action, scope, payload_hash, result)
       VALUES (?, ?, ?, ?, ?)`
    ).run(entry.agentId, entry.action, scopeStr, payloadHash, entry.result);
    insertEvent(db, {
      id: uuidv4(),
      type: "platform.action",
      actorAgentId: entry.agentId,
      subject: scopeStr,
      payload: { action: entry.action, result: entry.result, payloadHash },
    });
  } catch {
    /* never let auditing break a tool */
  }
}

export interface PlatformActionLogRow {
  id: number;
  agent_id: string;
  action: string;
  scope: string | null;
  payload_hash: string | null;
  result: string;
  created_at: string;
}

/** Most recent platform mutations for the oversight feed. */
export function listPlatformActions(
  db: AppDatabase,
  limit = 50
): PlatformActionLogRow[] {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return db
    .prepare(
      `SELECT id, agent_id, action, scope, payload_hash, result, created_at
       FROM platform_action_log
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(n) as PlatformActionLogRow[];
}
