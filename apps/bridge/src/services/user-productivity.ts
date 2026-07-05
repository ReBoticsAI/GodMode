import type { Request } from "express";
import { getCoreDb } from "../core-db.js";
import type { ShareGrantRole } from "../core-db.js";
import {
  assertShareRole,
  resolveShareAccess,
  type ShareError,
} from "./share-service.js";
import type { AppDatabase } from "../db.js";
import { getUserOwnerTenantDb, getUserOwnerTenantId } from "./user-scope.js";
import { v4 as uuidv4 } from "uuid";

export type UserProductivityRole = ShareGrantRole | "owner";

export interface UserProductivityAccess {
  ownerUserId: string;
  ownerTenantId: string;
  role: UserProductivityRole;
  db: AppDatabase;
}

const ROLE_RANK: Record<UserProductivityRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

function parseTargetUserId(req: Request): string {
  const q = req.query.userId;
  if (typeof q === "string" && q.trim()) return q.trim();
  return req.user!.id;
}

export function resolveUserCalendarAccess(
  req: Request,
  minRole: ShareGrantRole = "viewer"
): UserProductivityAccess {
  return resolveUserResourceAccess(req, "user_calendar", minRole);
}

export function resolveUserTasksAccess(
  req: Request,
  minRole: ShareGrantRole = "viewer"
): UserProductivityAccess {
  return resolveUserResourceAccess(req, "user_tasks", minRole);
}

function resolveUserResourceAccess(
  req: Request,
  resourceKind: "user_calendar" | "user_tasks",
  minRole: ShareGrantRole
): UserProductivityAccess {
  const callerId = req.user!.id;
  const targetUserId = parseTargetUserId(req);
  const core = getCoreDb();

  if (targetUserId === callerId) {
    const ownerTenantId = getUserOwnerTenantId(callerId);
    return {
      ownerUserId: callerId,
      ownerTenantId,
      role: "owner",
      db: getUserOwnerTenantDb(callerId),
    };
  }

  const shared = resolveShareAccess(core, {
    userId: callerId,
    tenantId: req.tenantId ?? getUserOwnerTenantId(callerId),
    resourceKind,
    resourceId: targetUserId,
    minRole,
  });

  if (!shared) {
    const err = new Error("No access to this user's resource") as ShareError & {
      status: number;
    };
    err.status = 403;
    throw err;
  }

  return {
    ownerUserId: targetUserId,
    ownerTenantId: shared.ownerTenantId,
    role: shared.role,
    db: shared.db,
  };
}

export function requireWriteAccess(access: UserProductivityAccess): void {
  if (access.role === "owner") return;
  assertShareRole(access.role, "editor");
}

/** Lazily create the personal kanban project for a user. */
export function ensureUserProject(userId: string, db: AppDatabase): string {
  const existing = db
    .prepare(`SELECT id FROM ai_projects WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`)
    .get(userId) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = `user-${userId}`;
  db.prepare(
    `INSERT OR IGNORE INTO ai_projects (id, name, user_id, agent_id) VALUES (?, ?, ?, NULL)`
  ).run(id, "My Tasks", userId);

  const cols = [
    ["backlog", "Backlog", 0],
    ["in_progress", "In Progress", 1],
    ["review", "Review", 2],
    ["done", "Done", 3],
  ] as const;
  for (const [colId, name, order] of cols) {
    db.prepare(
      `INSERT OR IGNORE INTO ai_project_columns (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)`
    ).run(colId, id, name, order);
  }

  return id;
}

export function userProjectId(userId: string): string {
  return `user-${userId}`;
}

/**
 * Resolve (or lazily create) the single Kanban board project owned by an agent.
 * Mirrors the `/projects` route resolver: the root `intelligence` agent adopts
 * the legacy `default` project; other agents get a fresh project that reuses the
 * shared canonical columns (backlog/in_progress/review/done). Used by the
 * Kanban-backed `todo_write` tool so its cards land on the agent's own board.
 */
export function ensureAgentProject(agentId: string, db: AppDatabase): string {
  const existing = db
    .prepare(`SELECT id FROM ai_projects WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1`)
    .get(agentId) as { id: string } | undefined;
  if (existing) return existing.id;
  const agent = db
    .prepare(`SELECT name FROM ai_agents WHERE id = ?`)
    .get(agentId) as { name: string } | undefined;
  const id = agentId === "intelligence" ? "default" : uuidv4();
  const name = `${agent?.name ?? "Agent"} Tasks`;
  db.prepare(
    `INSERT OR IGNORE INTO ai_projects (id, name, agent_id) VALUES (?, ?, ?)`
  ).run(id, name, agentId);
  db.prepare(`UPDATE ai_projects SET agent_id = ? WHERE id = ?`).run(agentId, id);
  return id;
}

export function newId(): string {
  return uuidv4();
}

export function hasMinRole(
  role: UserProductivityRole,
  min: ShareGrantRole
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min === "viewer" ? "viewer" : min];
}
