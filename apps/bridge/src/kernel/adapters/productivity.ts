import { v4 as uuidv4 } from "uuid";
import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import type { AppDatabase } from "../../db.js";
import type { ShareGrantRole } from "../../core-db.js";
import {
  advanceSubtaskOnResultComment,
  reconcileParentProgress,
} from "../../services/card-progress.js";
import {
  ensureAgentProject,
  ensureUserProject,
} from "../../services/user-productivity.js";
import {
  assertShareRole,
  resolveShareAccess,
} from "../../services/share-service.js";
import { broadcastCardActivity } from "../../ws-broker.js";
import type {
  OperationContext,
  RecordAdapter,
  RecordQuery,
} from "../adapter-registry.js";

function requireUser(ctx: OperationContext): string {
  if (!ctx.userId) {
    throw Object.assign(new Error("Authenticated user required"), { status: 401 });
  }
  return ctx.userId;
}

/** Agent workspace when `ctx.agentId` is set; otherwise the caller's personal OS. */
function productivityProjectId(db: AppDatabase, ctx: OperationContext): string {
  if (ctx.agentId) return ensureAgentProject(ctx.agentId, db);
  return ensureUserProject(requireUser(ctx), db);
}

function record(
  def: ObjectTypeDef,
  row: Record<string, unknown>
): RecordRow {
  const data: RecordData = {};
  for (const field of def.fields) {
    if (field.secret || !(field.name in row)) continue;
    const value = row[field.name];
    if (field.fieldType === "Check") data[field.name] = Boolean(value);
    else if (field.fieldType === "JSON" && typeof value === "string") {
      try {
        data[field.name] = JSON.parse(value);
      } catch {
        data[field.name] = value;
      }
    } else data[field.name] = value;
  }
  const id = String(row.id);
  return { id, objectType: def.name, data: { id, ...data } };
}

function paging(query: RecordQuery): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(Number(query.limit) || 100, 1), 500),
    offset: Math.max(Number(query.offset) || 0, 0),
  };
}

function notFound(label: string): never {
  throw Object.assign(new Error(`${label} not found`), { status: 404 });
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function requiredText(data: RecordData, name: string): string {
  const value = data[name];
  if (typeof value !== "string" || !value.trim()) {
    badRequest(`${name} required`);
  }
  return value.trim();
}

interface ProductivityAccess {
  db: AppDatabase;
  ownerUserId: string;
  ownerTenantId: string;
  role: ShareGrantRole;
}

function sharedAccesses(
  ctx: OperationContext,
  resourceKind: "user_calendar" | "user_tasks"
): ProductivityAccess[] {
  if (!ctx.data?.coreDb || !ctx.userId || !ctx.tenantId) return [];
  const resources = ctx.data.coreDb
    .prepare(
      `SELECT DISTINCT resource_id
       FROM share_grants
       WHERE resource_kind=?
         AND (grantee_user_id=? OR grantee_tenant_id=?)`
    )
    .all(resourceKind, ctx.userId, ctx.tenantId) as Array<{
    resource_id: string;
  }>;
  const accesses: ProductivityAccess[] = [];
  for (const { resource_id: ownerUserId } of resources) {
    const access = resolveShareAccess(ctx.data.coreDb, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      resourceKind,
      resourceId: ownerUserId,
      minRole: "viewer",
    });
    if (access) {
      accesses.push({
        ...access,
        ownerUserId,
      });
    }
  }
  return accesses;
}

function routedContext(
  ctx: OperationContext,
  access: ProductivityAccess
): OperationContext {
  return { ...ctx, tenantId: access.ownerTenantId };
}

const WRITE_ACTION_ROLES = ["editor", "owner", "intelligence"] as const;

export const CALENDAR_EVENT_ACTIONS: ActionDef[] = [
  {
    name: "transition",
    label: "Transition",
    description: "Change the lifecycle status of this calendar event.",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: [...WRITE_ACTION_ROLES],
    confirmation: { required: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: {
          type: "string",
          enum: ["scheduled", "completed", "cancelled"],
        },
      },
    },
  },
];

export const TASK_CARD_ACTIONS: ActionDef[] = [
  {
    name: "move",
    label: "Move",
    description: "Move this card to another Kanban lane.",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: [...WRITE_ACTION_ROLES],
    confirmation: { required: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["column_id"],
      properties: {
        column_id: { type: "string", minLength: 1 },
        sort_order: { type: "integer", minimum: 0 },
      },
    },
  },
  {
    name: "assign",
    label: "Assign",
    description: "Assign or unassign an agent from this card.",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: [...WRITE_ACTION_ROLES],
    confirmation: { required: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["assigned_agent_id"],
      properties: {
        assigned_agent_id: { type: ["string", "null"], minLength: 1 },
      },
    },
  },
  {
    name: "transition",
    label: "Transition",
    description: "Change this card's lifecycle status and canonical lane.",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: [...WRITE_ACTION_ROLES],
    confirmation: { required: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: {
          type: "string",
          enum: ["pending", "working", "review", "blocked", "accepted", "done", "cancelled"],
        },
      },
    },
  },
  {
    name: "add_comment",
    label: "Add comment",
    description: "Append an audit comment to this card.",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: [...WRITE_ACTION_ROLES],
    confirmation: { required: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["body"],
      properties: {
        body: { type: "string", minLength: 1 },
        kind: {
          type: "string",
          enum: ["note", "action", "result", "issue"],
        },
      },
    },
  },
];

export const CARD_COMMENT_ACTIONS: ActionDef[] = [
  {
    ...TASK_CARD_ACTIONS.find((action) => action.name === "add_comment")!,
    target: "collection",
    description: "Append an audit comment to a user-owned task card.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["card_id", "body"],
      properties: {
        card_id: { type: "string", minLength: 1 },
        body: { type: "string", minLength: 1 },
        kind: {
          type: "string",
          enum: ["note", "action", "result", "issue"],
        },
      },
    },
  },
];

const CALENDAR_WRITABLE = new Set([
  "kind",
  "title",
  "description",
  "start_at",
  "end_at",
  "all_day",
  "location",
  "linked_card_id",
  "linked_run_id",
  "status",
]);

function calendarRowByUser(
  db: AppDatabase,
  id: string,
  userId: string
): Record<string, unknown> | undefined {
  return db
    .prepare(`SELECT * FROM ai_calendar_events WHERE id=? AND user_id=?`)
    .get(id, userId) as Record<string, unknown> | undefined;
}

function calendarRowByAgent(
  db: AppDatabase,
  id: string,
  agentId: string
): Record<string, unknown> | undefined {
  return db
    .prepare(`SELECT * FROM ai_calendar_events WHERE id=? AND agent_id=?`)
    .get(id, agentId) as Record<string, unknown> | undefined;
}

function calendarAccess(
  db: AppDatabase,
  id: string,
  ctx: OperationContext,
  write = false
): { access: ProductivityAccess; row: Record<string, unknown>; agentId?: string } | null {
  if (ctx.agentId) {
    const local = calendarRowByAgent(db, id, ctx.agentId);
    if (!local) return null;
    return {
      access: {
        db,
        ownerUserId: ctx.userId ?? "",
        ownerTenantId: ctx.tenantId ?? "",
        role: "owner",
      },
      row: local,
      agentId: ctx.agentId,
    };
  }
  const userId = requireUser(ctx);
  const local = calendarRowByUser(db, id, userId);
  if (local) {
    return {
      access: {
        db,
        ownerUserId: userId,
        ownerTenantId: ctx.tenantId ?? "",
        role: "owner",
      },
      row: local,
    };
  }
  for (const access of sharedAccesses(ctx, "user_calendar")) {
    const row = calendarRowByUser(access.db, id, access.ownerUserId);
    if (!row) continue;
    if (write) assertShareRole(access.role, "editor");
    return { access, row };
  }
  return null;
}

export const calendarEventServiceAdapter: RecordAdapter = {
  id: "calendar_event_service",
  list(db, def, query, ctx) {
    const { limit, offset } = paging(query);
    if (ctx.agentId) {
      const rows = db
        .prepare(
          `SELECT * FROM ai_calendar_events WHERE agent_id=?
           ORDER BY start_at ASC`
        )
        .all(ctx.agentId) as Record<string, unknown>[];
      return {
        objectType: def.name,
        records: rows.slice(offset, offset + limit).map((row) => record(def, row)),
        total: rows.length,
      };
    }
    const userId = requireUser(ctx);
    const localRows = db
      .prepare(
        `SELECT * FROM ai_calendar_events WHERE user_id=?
         ORDER BY start_at ASC`
      )
      .all(userId) as Record<string, unknown>[];
    const rows = [
      ...localRows,
      ...sharedAccesses(ctx, "user_calendar").flatMap((access) =>
        access.db
          .prepare(`SELECT * FROM ai_calendar_events WHERE user_id=?`)
          .all(access.ownerUserId) as Record<string, unknown>[]
      ),
    ].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
    return {
      objectType: def.name,
      records: rows.slice(offset, offset + limit).map((row) => record(def, row)),
      total: rows.length,
    };
  },
  get(db, def, id, ctx) {
    const resolved = calendarAccess(db, id, ctx);
    return resolved ? record(def, resolved.row) : null;
  },
  create(db, def, data, ctx) {
    const id = typeof data.id === "string" && data.id ? data.id : uuidv4();
    if (ctx.agentId) {
      requireUser(ctx);
      db.prepare(
        `INSERT INTO ai_calendar_events
         (id, agent_id, user_id, kind, title, description, start_at, end_at,
          all_day, location, linked_card_id, linked_run_id, status)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        ctx.agentId,
        data.kind ?? "event",
        data.title,
        data.description ?? null,
        data.start_at,
        data.end_at ?? null,
        data.all_day ? 1 : 0,
        data.location ?? null,
        data.linked_card_id ?? null,
        data.linked_run_id ?? null,
        data.status ?? "scheduled"
      );
      return record(def, calendarRowByAgent(db, id, ctx.agentId)!);
    }
    const userId = requireUser(ctx);
    db.prepare(
      `INSERT INTO ai_calendar_events
       (id, agent_id, user_id, kind, title, description, start_at, end_at,
        all_day, location, linked_card_id, linked_run_id, status)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      data.kind ?? "event",
      data.title,
      data.description ?? null,
      data.start_at,
      data.end_at ?? null,
      data.all_day ? 1 : 0,
      data.location ?? null,
      data.linked_card_id ?? null,
      data.linked_run_id ?? null,
      data.status ?? "scheduled"
    );
    return record(def, calendarRowByUser(db, id, userId)!);
  },
  update(db, def, id, data, ctx) {
    const resolved = calendarAccess(db, id, ctx, true);
    if (!resolved) notFound("CalendarEvent");
    const { access, agentId } = resolved;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [name, value] of Object.entries(data)) {
      if (!CALENDAR_WRITABLE.has(name)) continue;
      sets.push(`"${name}"=?`);
      values.push(name === "all_day" ? (value ? 1 : 0) : value ?? null);
    }
    if (sets.length) {
      sets.push(`updated_at=datetime('now')`);
      if (agentId) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET ${sets.join(", ")} WHERE id=? AND agent_id=?`
        ).run(...values, id, agentId);
      } else {
        access.db.prepare(
          `UPDATE ai_calendar_events SET ${sets.join(", ")} WHERE id=? AND user_id=?`
        ).run(...values, id, access.ownerUserId);
      }
    }
    return record(
      def,
      agentId
        ? calendarRowByAgent(access.db, id, agentId)!
        : calendarRowByUser(access.db, id, access.ownerUserId)!
    );
  },
  delete(db, _def, id, ctx) {
    const resolved = calendarAccess(db, id, ctx, true);
    if (!resolved) notFound("CalendarEvent");
    const result = resolved.agentId
      ? resolved.access.db
          .prepare(`DELETE FROM ai_calendar_events WHERE id=? AND agent_id=?`)
          .run(id, resolved.agentId)
      : resolved.access.db
          .prepare(`DELETE FROM ai_calendar_events WHERE id=? AND user_id=?`)
          .run(id, resolved.access.ownerUserId);
    if (!result.changes) notFound("CalendarEvent");
  },
  actions: {
    transition(db, def, id, input, ctx) {
      const resolved = calendarAccess(db, id, ctx, true);
      if (!resolved) notFound("CalendarEvent");
      const { access, agentId } = resolved;
      const status = requiredText(input, "status");
      if (!["scheduled", "completed", "cancelled"].includes(status)) {
        badRequest("invalid calendar status");
      }
      if (agentId) {
        access.db.prepare(
          `UPDATE ai_calendar_events
           SET status=?, updated_at=datetime('now')
           WHERE id=? AND agent_id=?`
        ).run(status, id, agentId);
        return record(def, calendarRowByAgent(access.db, id, agentId)!);
      }
      access.db.prepare(
        `UPDATE ai_calendar_events
         SET status=?, updated_at=datetime('now')
         WHERE id=? AND user_id=?`
      ).run(status, id, access.ownerUserId);
      return record(def, calendarRowByUser(access.db, id, access.ownerUserId)!);
    },
  },
};

const CARD_WRITABLE = new Set([
  "title",
  "description",
  "prompt",
  "context_json",
  "tags_json",
  "due_at",
  "linked_chat_id",
  "linked_workflow_id",
  "priority",
  "parent_card_id",
  "status",
  "assigned_agent_id",
  "column_id",
  "sort_order",
]);

function cardRow(
  db: AppDatabase,
  id: string,
  projectId: string
): Record<string, unknown> | undefined {
  return db
    .prepare(`SELECT * FROM ai_project_cards WHERE id=? AND project_id=?`)
    .get(id, projectId) as Record<string, unknown> | undefined;
}

function existingUserProject(db: AppDatabase, userId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM ai_projects WHERE user_id=? ORDER BY created_at ASC LIMIT 1`
    )
    .get(userId) as { id: string } | undefined;
  return row?.id ?? null;
}

function taskAccess(
  db: AppDatabase,
  id: string,
  ctx: OperationContext,
  write = false
): { access: ProductivityAccess; projectId: string; row: Record<string, unknown> } | null {
  if (ctx.agentId) {
    const projectId = ensureAgentProject(ctx.agentId, db);
    const local = cardRow(db, id, projectId);
    if (local) {
      return {
        access: {
          db,
          ownerUserId: ctx.userId ?? "",
          ownerTenantId: ctx.tenantId ?? "",
          role: "owner",
        },
        projectId,
        row: local,
      };
    }
    // HTTP agent workspace is strict. Agent runtime may still comment/act on
    // personal-user cards while carrying agentId for authorship.
    if (ctx.source === "http") return null;
  }
  const userId = requireUser(ctx);
  const localProjectId = ensureUserProject(userId, db);
  const local = cardRow(db, id, localProjectId);
  if (local) {
    return {
      access: {
        db,
        ownerUserId: userId,
        ownerTenantId: ctx.tenantId ?? "",
        role: "owner",
      },
      projectId: localProjectId,
      row: local,
    };
  }
  for (const access of sharedAccesses(ctx, "user_tasks")) {
    const projectId = existingUserProject(access.db, access.ownerUserId);
    if (!projectId) continue;
    const row = cardRow(access.db, id, projectId);
    if (!row) continue;
    if (write) assertShareRole(access.role, "editor");
    return { access, projectId, row };
  }
  return null;
}

function canonicalColumnExists(db: AppDatabase, columnId: string): boolean {
  return Boolean(
    db.prepare(`SELECT id FROM ai_project_columns WHERE id=?`).get(columnId)
  );
}

function notifyCardMutation(
  db: AppDatabase,
  card: Record<string, unknown>,
  ctx: OperationContext,
  reason: string
): void {
  if (
    ctx.bus &&
    reason !== "comment" &&
    (card.column_id === "done" ||
      card.status === "accepted" ||
      card.status === "done")
  ) {
    const projectOwner = db
      .prepare(`SELECT agent_id FROM ai_projects WHERE id=?`)
      .get(String(card.project_id)) as { agent_id: string | null } | undefined;
    ctx.bus.emit("card_completed", {
      cardId: String(card.id),
      agentId:
        (card.assigned_agent_id as string | null) ??
        projectOwner?.agent_id ??
        "intelligence",
    });
  }
  broadcastCardActivity(ctx.tenantId, {
    cardId: String(card.id),
    agentId: (card.assigned_agent_id as string | null) ?? null,
    chatId: (card.linked_chat_id as string | null) ?? null,
    reason,
  });
}

function appendScopedComment(
  db: AppDatabase,
  def: ObjectTypeDef,
  cardId: string,
  input: RecordData,
  ctx: OperationContext
): RecordRow {
  const resolved = taskAccess(db, cardId, ctx, true);
  if (!resolved) notFound("TaskCard");
  const { access, projectId, row: card } = resolved;
  const targetCtx = routedContext(ctx, access);
  const body = requiredText(input, "body");
  const kind =
    input.kind === undefined ? null : requiredText(input, "kind");
  if (kind && !["note", "action", "result", "issue"].includes(kind)) {
    badRequest("invalid comment kind");
  }
  const author = ctx.source === "agent" || ctx.agentId ? "agent" : "user";
  const commentId = uuidv4();
  access.db.prepare(
    `INSERT INTO ai_card_comments (id, card_id, author, body, kind)
     VALUES (?, ?, ?, ?, ?)`
  ).run(commentId, cardId, author, body, kind);

  if (author === "agent" && kind === "result") {
    advanceSubtaskOnResultComment(access.db, cardId, targetCtx.tenantId);
  } else if (author === "agent" && card.parent_card_id) {
    reconcileParentProgress(
      access.db,
      String(card.parent_card_id),
      targetCtx.tenantId
    );
  }
  notifyCardMutation(
    access.db,
    cardRow(access.db, cardId, projectId)!,
    targetCtx,
    "comment"
  );
  const row = access.db
    .prepare(`SELECT * FROM ai_card_comments WHERE id=? AND card_id=?`)
    .get(commentId, cardId) as Record<string, unknown>;
  return record(def, row);
}

export const taskCardServiceAdapter: RecordAdapter = {
  id: "task_card_service",
  list(db, def, query, ctx) {
    const { limit, offset } = paging(query);
    if (ctx.agentId) {
      requireUser(ctx);
      const projectId = ensureAgentProject(ctx.agentId, db);
      const rows = db
        .prepare(
          `SELECT * FROM ai_project_cards WHERE project_id=?
           ORDER BY sort_order ASC`
        )
        .all(projectId) as Record<string, unknown>[];
      return {
        objectType: def.name,
        records: rows.slice(offset, offset + limit).map((row) => record(def, row)),
        total: rows.length,
      };
    }
    const userId = requireUser(ctx);
    const projectId = ensureUserProject(userId, db);
    const localRows = db
      .prepare(
        `SELECT * FROM ai_project_cards WHERE project_id=?
         ORDER BY sort_order ASC`
      )
      .all(projectId) as Record<string, unknown>[];
    const rows = [...localRows];
    for (const access of sharedAccesses(ctx, "user_tasks")) {
      const sharedProjectId = existingUserProject(access.db, access.ownerUserId);
      if (!sharedProjectId) continue;
      rows.push(
        ...(access.db
          .prepare(
            `SELECT * FROM ai_project_cards WHERE project_id=? ORDER BY sort_order ASC`
          )
          .all(sharedProjectId) as Record<string, unknown>[])
      );
    }
    return {
      objectType: def.name,
      records: rows.slice(offset, offset + limit).map((row) => record(def, row)),
      total: rows.length,
    };
  },
  get(db, def, id, ctx) {
    const resolved = taskAccess(db, id, ctx);
    return resolved ? record(def, resolved.row) : null;
  },
  create(db, def, data, ctx) {
    const projectId = productivityProjectId(db, ctx);
    const columnId =
      typeof data.column_id === "string" ? data.column_id : "backlog";
    const id = typeof data.id === "string" && data.id ? data.id : uuidv4();
    const order = (
      db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS value
           FROM ai_project_cards WHERE project_id=? AND column_id=?`
        )
        .get(projectId, columnId) as { value: number }
    ).value;
    db.prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, description, prompt, context_json,
        tags_json, due_at, linked_chat_id, linked_workflow_id, priority,
        parent_card_id, status, assigned_agent_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      projectId,
      columnId,
      data.title,
      data.description ?? null,
      data.prompt ?? null,
      data.context_json == null ? null : JSON.stringify(data.context_json),
      data.tags_json == null ? null : JSON.stringify(data.tags_json),
      data.due_at ?? null,
      data.linked_chat_id ?? null,
      data.linked_workflow_id ?? null,
      data.priority ?? 2,
      data.parent_card_id ?? null,
      data.status ?? null,
      data.assigned_agent_id ?? null,
      order + 1
    );
    return record(def, cardRow(db, id, projectId)!);
  },
  update(db, def, id, data, ctx) {
    const resolved = taskAccess(db, id, ctx, true);
    if (!resolved) notFound("TaskCard");
    const { access, projectId } = resolved;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [name, raw] of Object.entries(data)) {
      if (!CARD_WRITABLE.has(name)) continue;
      const value =
        ["context_json", "tags_json"].includes(name) &&
        raw != null &&
        typeof raw !== "string"
          ? JSON.stringify(raw)
          : raw;
      sets.push(`"${name}"=?`);
      values.push(value ?? null);
    }
    if (sets.length) {
      sets.push(`updated_at=datetime('now')`);
      access.db.prepare(
        `UPDATE ai_project_cards SET ${sets.join(", ")} WHERE id=? AND project_id=?`
      ).run(...values, id, projectId);
    }
    return record(def, cardRow(access.db, id, projectId)!);
  },
  delete(db, _def, id, ctx) {
    const resolved = taskAccess(db, id, ctx, true);
    if (!resolved) notFound("TaskCard");
    const result = resolved.access.db
      .prepare(`DELETE FROM ai_project_cards WHERE id=? AND project_id=?`)
      .run(id, resolved.projectId);
    if (!result.changes) notFound("TaskCard");
  },
  actions: {
    move(db, def, id, input, ctx) {
      const resolved = taskAccess(db, id, ctx, true);
      if (!resolved) notFound("TaskCard");
      const { access, projectId, row: current } = resolved;
      const targetCtx = routedContext(ctx, access);
      const columnId = requiredText(input, "column_id");
      if (!canonicalColumnExists(access.db, columnId)) {
        badRequest("unknown project column");
      }
      let sortOrder: number;
      if (input.sort_order === undefined) {
        sortOrder =
          (
            access.db
              .prepare(
                `SELECT COALESCE(MAX(sort_order), -1) AS value
                 FROM ai_project_cards WHERE project_id=? AND column_id=?`
              )
              .get(projectId, columnId) as { value: number }
          ).value + 1;
      } else {
        sortOrder = Number(input.sort_order);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
          badRequest("sort_order must be a non-negative integer");
        }
      }
      const impliedStatus =
        columnId === "done" && !["accepted", "done", "cancelled"].includes(String(current.status ?? ""))
          ? "done"
          : current.status;
      access.db.prepare(
        `UPDATE ai_project_cards
         SET column_id=?, sort_order=?, status=?, updated_at=datetime('now')
         WHERE id=? AND project_id=?`
      ).run(columnId, sortOrder, impliedStatus ?? null, id, projectId);
      const updated = cardRow(access.db, id, projectId)!;
      if (updated.parent_card_id) {
        reconcileParentProgress(
          access.db,
          String(updated.parent_card_id),
          targetCtx.tenantId
        );
      }
      notifyCardMutation(access.db, updated, targetCtx, "card_updated");
      return record(def, updated);
    },
    assign(db, def, id, input, ctx) {
      const resolved = taskAccess(db, id, ctx, true);
      if (!resolved) notFound("TaskCard");
      const { access, projectId } = resolved;
      const raw = input.assigned_agent_id;
      if (raw !== null && (typeof raw !== "string" || !raw.trim())) {
        badRequest("assigned_agent_id must be non-empty text or null");
      }
      const assignedAgentId = raw === null ? null : raw.trim();
      access.db.prepare(
        `UPDATE ai_project_cards
         SET assigned_agent_id=?, updated_at=datetime('now')
         WHERE id=? AND project_id=?`
      ).run(assignedAgentId, id, projectId);
      const updated = cardRow(access.db, id, projectId)!;
      notifyCardMutation(
        access.db,
        updated,
        routedContext(ctx, access),
        "card_updated"
      );
      return record(def, updated);
    },
    transition(db, def, id, input, ctx) {
      const resolved = taskAccess(db, id, ctx, true);
      if (!resolved) notFound("TaskCard");
      const { access, projectId, row: current } = resolved;
      const targetCtx = routedContext(ctx, access);
      const status = requiredText(input, "status");
      const columnByStatus: Record<string, string | undefined> = {
        pending: "backlog",
        working: "in_progress",
        review: "review",
        accepted: "done",
        done: "done",
        cancelled: "done",
      };
      if (
        !["pending", "working", "review", "blocked", "accepted", "done", "cancelled"].includes(
          status
        )
      ) {
        badRequest("invalid card status");
      }
      const columnId = columnByStatus[status] ?? String(current.column_id);
      access.db.prepare(
        `UPDATE ai_project_cards
         SET status=?, column_id=?, updated_at=datetime('now')
         WHERE id=? AND project_id=?`
      ).run(status, columnId, id, projectId);
      const updated = cardRow(access.db, id, projectId)!;
      if (updated.parent_card_id) {
        reconcileParentProgress(
          access.db,
          String(updated.parent_card_id),
          targetCtx.tenantId
        );
      }
      notifyCardMutation(access.db, updated, targetCtx, "card_updated");
      return record(def, updated);
    },
    add_comment(db, _def, id, input, ctx) {
      return appendScopedComment(db, CARD_COMMENT_RECORD_DEF, id, input, ctx);
    },
  },
};

const CARD_COMMENT_RECORD_DEF: ObjectTypeDef = {
  name: "CardComment",
  label: "Card Comment",
  storage: { kind: "adapter", adapterId: "card_comment_service" },
  fields: [
    { name: "id", label: "Id", fieldType: "Data" },
    { name: "card_id", label: "Card Id", fieldType: "Data" },
    { name: "author", label: "Author", fieldType: "Data" },
    { name: "body", label: "Body", fieldType: "Data" },
    { name: "kind", label: "Kind", fieldType: "Data" },
    { name: "created_at", label: "Created At", fieldType: "Data" },
  ],
};

export const cardCommentServiceAdapter: RecordAdapter = {
  id: "card_comment_service",
  list(db, def, query, ctx) {
    const projectId = productivityProjectId(db, ctx);
    const { limit, offset } = paging(query);
    const rows = db
      .prepare(
        `SELECT c.* FROM ai_card_comments c
         JOIN ai_project_cards card ON card.id=c.card_id
         WHERE card.project_id=?
         ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(projectId, limit, offset) as Record<string, unknown>[];
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM ai_card_comments c
           JOIN ai_project_cards card ON card.id=c.card_id
           WHERE card.project_id=?`
        )
        .get(projectId) as { c: number }
    ).c;
    return {
      objectType: def.name,
      records: rows.map((row) => record(def, row)),
      total,
    };
  },
  get(db, def, id, ctx) {
    const projectId = productivityProjectId(db, ctx);
    const row = db
      .prepare(
        `SELECT c.* FROM ai_card_comments c
         JOIN ai_project_cards card ON card.id=c.card_id
         WHERE c.id=? AND card.project_id=?`
      )
      .get(id, projectId) as Record<string, unknown> | undefined;
    return row ? record(def, row) : null;
  },
  actions: {
    add_comment(db, def, _id, input, ctx) {
      return appendScopedComment(
        db,
        def,
        requiredText(input, "card_id"),
        input,
        ctx
      );
    },
  },
};
