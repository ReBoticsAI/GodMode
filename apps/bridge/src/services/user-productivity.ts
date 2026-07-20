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

/** Stable id for the default personal board. */
export function userProjectId(userId: string): string {
  return `user-${userId}`;
}

const CANONICAL_COLUMNS = [
  ["backlog", "Backlog", 0],
  ["in_progress", "In Progress", 1],
  ["review", "Review", 2],
  ["done", "Done", 3],
] as const;

function seedCanonicalColumns(db: AppDatabase, projectId: string): void {
  for (const [colId, name, order] of CANONICAL_COLUMNS) {
    db.prepare(
      `INSERT OR IGNORE INTO ai_project_columns (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)`
    ).run(colId, projectId, name, order);
  }
}

/** Lazily create the default personal kanban board ("My Tasks"). */
export function ensureUserProject(userId: string, db: AppDatabase): string {
  const id = userProjectId(userId);
  const byId = db
    .prepare(`SELECT id FROM ai_projects WHERE id = ?`)
    .get(id) as { id: string } | undefined;
  if (byId) {
    seedCanonicalColumns(db, id);
    return id;
  }

  db.prepare(
    `INSERT OR IGNORE INTO ai_projects (id, name, user_id, agent_id) VALUES (?, ?, ?, NULL)`
  ).run(id, "My Tasks", userId);
  seedCanonicalColumns(db, id);
  return id;
}

export type UserBoardRow = {
  id: string;
  name: string;
  user_id: string | null;
  archived_at: string | null;
  github_project_node_id: string | null;
  github_project_url: string | null;
  github_status_map_json: string | null;
  sync_enabled: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

/** List non-archived (or all) user-owned kanban boards. */
export function listUserBoards(
  userId: string,
  db: AppDatabase,
  opts?: { includeArchived?: boolean }
): UserBoardRow[] {
  ensureUserProject(userId, db);
  if (opts?.includeArchived) {
    return db
      .prepare(
        `SELECT * FROM ai_projects WHERE user_id = ? ORDER BY
           CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC`
      )
      .all(userId, userProjectId(userId)) as UserBoardRow[];
  }
  return db
    .prepare(
      `SELECT * FROM ai_projects WHERE user_id = ? AND archived_at IS NULL
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC`
    )
    .all(userId, userProjectId(userId)) as UserBoardRow[];
}

export function getUserBoard(
  userId: string,
  db: AppDatabase,
  boardId: string
): UserBoardRow | undefined {
  return db
    .prepare(
      `SELECT * FROM ai_projects WHERE id = ? AND user_id = ?`
    )
    .get(boardId, userId) as UserBoardRow | undefined;
}

/** Create an additional personal kanban board (not My Tasks). */
export function createUserBoard(
  userId: string,
  db: AppDatabase,
  name: string
): UserBoardRow {
  ensureUserProject(userId, db);
  const trimmed = name.trim();
  if (!trimmed) throw Object.assign(new Error("name required"), { status: 400 });
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_projects (id, name, user_id, agent_id) VALUES (?, ?, ?, NULL)`
  ).run(id, trimmed, userId);
  db.prepare(
    `UPDATE ai_projects SET updated_at=datetime('now') WHERE id=?`
  ).run(id);
  return getUserBoard(userId, db, id)!;
}

export function renameUserBoard(
  userId: string,
  db: AppDatabase,
  boardId: string,
  name: string
): UserBoardRow {
  const trimmed = name.trim();
  if (!trimmed) throw Object.assign(new Error("name required"), { status: 400 });
  const board = getUserBoard(userId, db, boardId);
  if (!board) throw Object.assign(new Error("Board not found"), { status: 404 });
  db.prepare(
    `UPDATE ai_projects SET name=?, updated_at=datetime('now') WHERE id=? AND user_id=?`
  ).run(trimmed, boardId, userId);
  return getUserBoard(userId, db, boardId)!;
}

export function archiveUserBoard(
  userId: string,
  db: AppDatabase,
  boardId: string
): UserBoardRow {
  if (boardId === userProjectId(userId)) {
    throw Object.assign(new Error("Cannot archive My Tasks"), { status: 400 });
  }
  const board = getUserBoard(userId, db, boardId);
  if (!board) throw Object.assign(new Error("Board not found"), { status: 404 });
  db.prepare(
    `UPDATE ai_projects SET archived_at=datetime('now'), sync_enabled=0, updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(boardId, userId);
  return getUserBoard(userId, db, boardId)!;
}

/** Resolve which board to use; defaults to My Tasks. Verifies ownership. */
export function resolveUserBoardId(
  userId: string,
  db: AppDatabase,
  projectId?: string | null
): string {
  const defaultId = ensureUserProject(userId, db);
  if (!projectId || projectId === defaultId) return defaultId;
  const board = getUserBoard(userId, db, projectId);
  if (!board || board.archived_at) {
    throw Object.assign(new Error("Board not found"), { status: 404 });
  }
  return board.id;
}

/**
 * Resolve (or lazily create) the single Kanban board project owned by an agent.
 * Agents are digital principals with their own workspace (tasks, calendar, memory).
 * The root `intelligence` agent adopts the legacy `default` project; other agents
 * get a fresh project that reuses the shared canonical columns
 * (backlog/in_progress/review/done). Used by TaskCard Record mutations when
 * OperationContext.agentId is set, and by the Kanban-backed `todo_write` tool.
 */
export function ensureAgentProject(agentId: string, db: AppDatabase): string {
  const existing = db
    .prepare(`SELECT id FROM ai_projects WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1`)
    .get(agentId) as { id: string } | undefined;
  if (existing) return existing.id;
  let agentName: string | undefined;
  try {
    const agent = db
      .prepare(`SELECT name FROM ai_agents WHERE id = ?`)
      .get(agentId) as { name: string } | undefined;
    agentName = agent?.name;
  } catch {
    // Test fixtures (and rare degraded DBs) may lack ai_agents; name is cosmetic.
  }
  const id = agentId === "intelligence" ? "default" : uuidv4();
  const name = `${agentName ?? "Agent"} Tasks`;
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
