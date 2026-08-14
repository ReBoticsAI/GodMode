import type { Request } from "express";
import { getCloudDb } from "../core-db.js";
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
  const core = getCloudDb();

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
  ["ready", "Ready", 1],
  ["in_progress", "In Progress", 2],
  ["review", "Review", 3],
  ["done", "Done", 4],
] as const;

function seedCanonicalColumns(db: AppDatabase, projectId: string): void {
  for (const [colId, name, order] of CANONICAL_COLUMNS) {
    db.prepare(
      `INSERT INTO ai_project_columns (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sort_order = excluded.sort_order`
    ).run(colId, projectId, name, order);
  }
}

/** Lazily create the default personal kanban board ("My Tasks"). */
export function ensureUserProject(userId: string, db: AppDatabase): string {
  const id = userProjectId(userId);
  const byId = db
    .prepare(`SELECT id FROM ai_projects WHERE id = ?`)
    .get(id) as { id: string } | undefined;
  if (!byId) {
    db.prepare(
      `INSERT OR IGNORE INTO ai_projects (id, name, user_id, agent_id, columns_json) VALUES (?, ?, ?, NULL, ?)`
    ).run(id, "My Tasks", userId, JSON.stringify(defaultBoardColumns()));
  }
  // Backfill columns_json for boards created before multi-board schema.
  db.prepare(
    `UPDATE ai_projects SET columns_json=? WHERE id=? AND (columns_json IS NULL OR columns_json='')`
  ).run(JSON.stringify(defaultBoardColumns()), id);
  seedCanonicalColumns(db, id);
  return id;
}

export type BoardColumnDef = {
  id: string;
  name: string;
  sort_order: number;
  /** When true, column is omitted from the board (cards stay in place). */
  hidden?: boolean;
  /** Soft WIP limit shown in the column header; null/undefined = no limit. */
  wip_limit?: number | null;
};

export type UserBoardRow = {
  id: string;
  name: string;
  user_id: string | null;
  archived_at: string | null;
  github_project_node_id: string | null;
  github_project_url: string | null;
  github_status_map_json: string | null;
  columns_json: string | null;
  sync_enabled: number;
  last_synced_at: string | null;
  last_sync_error: string | null;
  sync_started_at: string | null;
  last_sync_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

export function defaultBoardColumns(): BoardColumnDef[] {
  return CANONICAL_COLUMNS.map(([id, name, sort_order]) => ({
    id,
    name,
    sort_order,
  }));
}

export function parseBoardColumns(raw: string | null | undefined): BoardColumnDef[] {
  if (!raw) return defaultBoardColumns();
  try {
    const parsed = JSON.parse(raw) as BoardColumnDef[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultBoardColumns();
    return parsed
      .filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
      .map((c, i) => {
        const wip =
          c.wip_limit == null || c.wip_limit === undefined
            ? null
            : Number(c.wip_limit);
        return {
          id: c.id,
          name: c.name,
          sort_order: Number.isFinite(c.sort_order) ? Number(c.sort_order) : i,
          hidden: Boolean(c.hidden),
          wip_limit:
            wip != null && Number.isFinite(wip) && wip > 0
              ? Math.floor(wip)
              : null,
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order);
  } catch {
    return defaultBoardColumns();
  }
}

export function columnsForBoard(board: UserBoardRow): BoardColumnDef[] {
  return parseBoardColumns(board.columns_json);
}

/** Visible columns for the kanban (hidden ones stay in columns_json for card ids). */
export function visibleColumnsForBoard(board: UserBoardRow): BoardColumnDef[] {
  return columnsForBoard(board).filter((c) => !c.hidden);
}

export function firstVisibleColumnId(board: UserBoardRow): string {
  return visibleColumnsForBoard(board)[0]?.id ?? columnsForBoard(board)[0]?.id ?? "backlog";
}

export function boardHasColumn(board: UserBoardRow, columnId: string): boolean {
  return columnsForBoard(board).some((c) => c.id === columnId);
}

export function slugBoardColumnId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "column";
}

function uniqueColumnId(name: string, existing: Set<string>): string {
  let id = slugBoardColumnId(name);
  if (!existing.has(id)) return id;
  let n = 2;
  while (existing.has(`${id}_${n}`)) n += 1;
  return `${id}_${n}`;
}

/**
 * Replace board columns_json. Cards in removed columns move to `fallbackColumnId`
 * or the first remaining column. Status map keys for removed columns are dropped.
 */
export function updateBoardColumns(
  userId: string,
  db: AppDatabase,
  boardId: string,
  columnsInput: BoardColumnDef[],
  opts?: { fallbackColumnId?: string }
): UserBoardRow {
  const board = getUserBoard(userId, db, boardId);
  if (!board || board.archived_at) {
    throw Object.assign(new Error("Board not found"), { status: 404 });
  }
  if (!Array.isArray(columnsInput) || columnsInput.length === 0) {
    throw Object.assign(new Error("At least one column is required"), {
      status: 400,
    });
  }

  const used = new Set<string>();
  const columns: BoardColumnDef[] = columnsInput.map((c, i) => {
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name) {
      throw Object.assign(new Error("Column name required"), { status: 400 });
    }
    let id =
      typeof c.id === "string" && c.id.trim() ? c.id.trim() : slugBoardColumnId(name);
    if (used.has(id)) id = uniqueColumnId(name, used);
    used.add(id);
    const wip =
      c.wip_limit == null || c.wip_limit === undefined
        ? null
        : Number(c.wip_limit);
    return {
      id,
      name,
      sort_order: Number.isFinite(c.sort_order) ? Number(c.sort_order) : i,
      hidden: Boolean(c.hidden),
      wip_limit:
        wip != null && Number.isFinite(wip) && wip > 0 ? Math.floor(wip) : null,
    };
  });

  const visible = columns.filter((c) => !c.hidden);
  if (visible.length === 0) {
    throw Object.assign(new Error("At least one visible column is required"), {
      status: 400,
    });
  }

  const idSet = new Set(columns.map((c) => c.id));
  const fallback =
    (opts?.fallbackColumnId && idSet.has(opts.fallbackColumnId)
      ? opts.fallbackColumnId
      : null) ??
    visible[0]!.id;

  const cards = db
    .prepare(`SELECT id, column_id FROM ai_project_cards WHERE project_id=?`)
    .all(boardId) as Array<{ id: string; column_id: string }>;
  const updateCol = db.prepare(
    `UPDATE ai_project_cards SET column_id=?, updated_at=datetime('now') WHERE id=?`
  );
  for (const card of cards) {
    if (!idSet.has(card.column_id)) {
      updateCol.run(fallback, card.id);
    }
  }

  let statusMap: Record<string, string> = {};
  try {
    statusMap = board.github_status_map_json
      ? (JSON.parse(board.github_status_map_json) as Record<string, string>)
      : {};
  } catch {
    statusMap = {};
  }
  const nextMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(statusMap)) {
    if (idSet.has(k)) nextMap[k] = v;
  }

  db.prepare(
    `UPDATE ai_projects SET columns_json=?, github_status_map_json=?, updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(
    JSON.stringify(columns),
    Object.keys(nextMap).length ? JSON.stringify(nextMap) : board.github_status_map_json,
    boardId,
    userId
  );

  return getUserBoard(userId, db, boardId)!;
}

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
  const columns = defaultBoardColumns();
  db.prepare(
    `INSERT INTO ai_projects (id, name, user_id, agent_id, columns_json) VALUES (?, ?, ?, NULL, ?)`
  ).run(id, trimmed, userId, JSON.stringify(columns));
  seedCanonicalColumns(db, id);
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
  if (existing) {
    db.prepare(
      `UPDATE ai_projects SET columns_json=? WHERE id=? AND (columns_json IS NULL OR columns_json='')`
    ).run(JSON.stringify(defaultBoardColumns()), existing.id);
    seedCanonicalColumns(db, existing.id);
    return existing.id;
  }
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
    `INSERT OR IGNORE INTO ai_projects (id, name, agent_id, columns_json) VALUES (?, ?, ?, ?)`
  ).run(id, name, agentId, JSON.stringify(defaultBoardColumns()));
  db.prepare(`UPDATE ai_projects SET agent_id = ? WHERE id = ?`).run(agentId, id);
  db.prepare(
    `UPDATE ai_projects SET columns_json=? WHERE id=? AND (columns_json IS NULL OR columns_json='')`
  ).run(JSON.stringify(defaultBoardColumns()), id);
  seedCanonicalColumns(db, id);
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
