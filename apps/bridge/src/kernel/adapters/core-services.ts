import type { ObjectTypeDef, RecordData, RecordRow } from "@godmode/kernel";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../../db.js";
import { getCoreDb } from "../../core-db.js";
import {
  createWorkflow,
  createWorkflowComment,
  deleteWorkflowComment,
  deleteWorkflow,
  getWorkflowComment,
  getWorkflow,
  listWorkflowComments,
  listWorkflows,
  updateWorkflow,
} from "../../services/ai-workflows.js";
import {
  getReflectionConfig,
  patchReflectionConfig,
  type AgentReflectionConfig,
} from "../../services/reflection-config.js";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  reloadAiSchedules,
  updateSchedule,
} from "../../services/ai-scheduler.js";
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../../services/agents/agents-db.js";
import {
  deleteHook,
  getHook,
  getHookForRun,
  listHooks,
  createHook,
  updateHook,
  type HookOwnerScope,
} from "../../services/hook-service.js";
import {
  approveHookRun,
  rejectHookRun,
} from "../../services/hook-dispatcher.js";
import { refreshScheduler } from "../../services/scheduler.js";
import {
  getAssignment,
  listAssignments,
  setAssignment,
  type AiAgentAssignment,
  type AssignmentScopeType,
} from "../../services/ai-agent-assignments.js";
import type { OperationContext, RecordAdapter, RecordQuery } from "../adapter-registry.js";
import {
  createPage,
  deletePage,
  getPageById,
  listPages,
  updatePage,
  type WikiScope,
} from "../../services/wiki-service.js";

function page<T>(rows: T[], query: RecordQuery): { rows: T[]; total: number } {
  const offset = Math.max(Number(query.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

function record(def: ObjectTypeDef, id: string, data: RecordData): RecordRow {
  return { id, objectType: def.name, data: { id, ...data } };
}

function requiredText(data: RecordData, name: string): string {
  const value = data[name];
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`${name} required`), { status: 400 });
  }
  return value.trim();
}

function jsonText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseJson(value: string | null): unknown {
  if (value == null) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      /^(authorization|headers?|api[_-]?key|token|secret|password|credential)$/i.test(
        key
      )
    ) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redactCredentials(entry);
    }
  }
  return redacted;
}

function notFound(message: string): never {
  throw Object.assign(new Error(message), { status: 404 });
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), { status: 409 });
}

function enqueueAiJob(
  db: AppDatabase,
  input: {
    tenantId?: string;
    workflowId?: string;
    prompt?: string;
    context?: Record<string, unknown>;
    priority?: number;
  }
): string {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_prompt_queue
       (id, status, priority, workflow_id, adapter_ids_json, prompt, context_json, tenant_id)
     VALUES (?, 'pending', ?, ?, NULL, ?, ?, ?)`
  ).run(
    id,
    Number.isFinite(input.priority) ? Number(input.priority) : 0,
    input.workflowId ?? null,
    input.prompt ?? null,
    input.context ? JSON.stringify(input.context) : null,
    input.tenantId ?? null
  );
  return id;
}

function workflowRecord(def: ObjectTypeDef, row: ReturnType<typeof getWorkflow> extends infer T ? NonNullable<T> : never): RecordRow {
  return record(def, row.id, {
    agent_id: row.agent_id,
    name: row.name,
    config_json: row.config,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const workflowServiceAdapter: RecordAdapter = {
  id: "workflow_service",
  list(db, def, query) {
    const result = page(listWorkflows(db), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => workflowRecord(def, row)),
      total: result.total,
    };
  },
  get: (db, def, id) => {
    const row = getWorkflow(db, id);
    return row ? workflowRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    return workflowRecord(
      def,
      createWorkflow(db, {
        name: requiredText(data, "name"),
        agentId:
          typeof data.agent_id === "string"
            ? data.agent_id
            : ctx.agentId ?? null,
        config:
          data.config_json && typeof data.config_json === "object"
            ? (data.config_json as never)
            : undefined,
        enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
      })
    );
  },
  update(db, def, id, data) {
    const row = updateWorkflow(db, id, {
      name: typeof data.name === "string" ? data.name : undefined,
      agentId:
        data.agent_id === undefined ? undefined : (data.agent_id as string | null),
      config:
        data.config_json && typeof data.config_json === "object"
          ? (data.config_json as never)
          : undefined,
      enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
    });
    if (!row) throw Object.assign(new Error("Workflow not found"), { status: 404 });
    return workflowRecord(def, row);
  },
  delete(db, _def, id, ctx) {
    if (!getWorkflow(db, id)) notFound("Workflow not found");

    const coreDb = getCoreDb();
    const hookIds: string[] = [];
    const rows = coreDb
      .prepare(
        `SELECT id, action_config_json FROM hooks
         WHERE action_kind = 'run_workflow'
           AND owner_tenant_id = ?`
      )
      .all(ctx.tenantId ?? "") as Array<{
        id: string;
        action_config_json: string | null;
      }>;
    for (const row of rows) {
      const config = parseJson(row.action_config_json);
      if (
        config &&
        typeof config === "object" &&
        (config as Record<string, unknown>).workflowId === id
      ) {
        hookIds.push(row.id);
      }
    }

    db.transaction(() => {
      const tableExists = (table: string) =>
        Boolean(
          db
            .prepare(
              `SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`
            )
            .get(table)
        );
      if (tableExists("ai_prompt_queue")) {
        db.prepare(
          `DELETE FROM ai_prompt_queue
           WHERE workflow_id = ? AND status = 'pending'`
        ).run(id);
      }
      for (const table of [
        "ai_schedules",
        "ai_workflow_runs",
        "ai_workflow_comments",
      ]) {
        if (tableExists(table)) {
          db.prepare(`DELETE FROM "${table}" WHERE workflow_id = ?`).run(id);
        }
      }
      if (!deleteWorkflow(db, id)) notFound("Workflow not found");
    })();

    if (hookIds.length) {
      coreDb.transaction(() => {
        const remove = coreDb.prepare(`DELETE FROM hooks WHERE id = ?`);
        for (const hookId of hookIds) remove.run(hookId);
      })();
    }
    reloadAiSchedules();
    refreshScheduler();
  },
  actions: {
    run(db, _def, id, input, ctx) {
      if (!getWorkflow(db, id)) notFound("Workflow not found");
      const jobId = enqueueAiJob(db, {
        tenantId: ctx.tenantId,
        workflowId: id,
        prompt:
          typeof input.trigger_input === "string" ? input.trigger_input : undefined,
        context:
          typeof input.card_id === "string" && input.card_id
            ? { cardId: input.card_id }
            : undefined,
        priority: 2,
      });
      return { ok: true, jobId };
    },
  },
};

function workflowCommentRecord(
  def: ObjectTypeDef,
  row: NonNullable<ReturnType<typeof getWorkflowComment>>
): RecordRow {
  return record(def, row.id, {
    workflow_id: row.workflow_id,
    author: row.author,
    body: row.body,
    created_at: row.created_at,
  });
}

export const workflowCommentServiceAdapter: RecordAdapter = {
  id: "workflow_comment_service",
  list(db, def, query) {
    const workflowId =
      typeof query.filters?.workflow_id === "string"
        ? query.filters.workflow_id
        : query.parentId ?? undefined;
    const result = page(listWorkflowComments(db, workflowId), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => workflowCommentRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id) {
    const row = getWorkflowComment(db, id);
    return row ? workflowCommentRecord(def, row) : null;
  },
  create(db, def, data) {
    return workflowCommentRecord(
      def,
      createWorkflowComment(db, {
        workflowId: requiredText(data, "workflow_id"),
        author: data.author === "agent" ? "agent" : "user",
        body: requiredText(data, "body"),
      })
    );
  },
  delete(db, _def, id) {
    if (!deleteWorkflowComment(db, id)) {
      notFound("Workflow comment not found");
    }
  },
};

function workflowRunRecord(
  def: ObjectTypeDef,
  row: Record<string, unknown>
): RecordRow {
  return record(def, String(row.id), {
    workflow_id: row.workflow_id,
    status: row.status,
    trigger_input: row.trigger_input,
    state_json:
      typeof row.state_json === "string"
        ? parseJson(row.state_json)
        : row.state_json,
    awaiting_node_id: row.awaiting_node_id,
    card_id: row.card_id,
    result_json:
      typeof row.result_json === "string"
        ? parseJson(row.result_json)
        : row.result_json,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const workflowRunServiceAdapter: RecordAdapter = {
  id: "workflow_run_read",
  list(db, def, query) {
    const offset = Math.max(Number(query.offset) || 0, 0);
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM ai_workflow_runs`).get() as {
        c: number;
      }
    ).c;
    const rows = db
      .prepare(
        `SELECT * FROM ai_workflow_runs
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Record<string, unknown>[];
    return {
      objectType: def.name,
      records: rows.map((row) => workflowRunRecord(def, row)),
      total,
    };
  },
  get(db, def, id) {
    const row = db
      .prepare(`SELECT * FROM ai_workflow_runs WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? workflowRunRecord(def, row) : null;
  },
  actions: {
    resume(db, _def, id, input, ctx) {
      const run = db
        .prepare(
          `SELECT id, status, card_id FROM ai_workflow_runs WHERE id = ?`
        )
        .get(id) as
        | { id: string; status: string; card_id: string | null }
        | undefined;
      if (!run) notFound("Workflow run not found");
      if (run.status !== "awaiting_input") {
        conflict(`Run is not awaiting input (status=${run.status})`);
      }
      const decision =
        input.decision === "request_changes" ? "request_changes" : "approve";
      const comments =
        typeof input.comments === "string" && input.comments.trim()
          ? input.comments.trim()
          : undefined;
      if (decision === "request_changes" && comments && run.card_id) {
        db.prepare(
          `INSERT INTO ai_card_comments (id, card_id, author, body)
           VALUES (?, ?, 'user', ?)`
        ).run(uuidv4(), run.card_id, comments);
      }
      const jobId = enqueueAiJob(db, {
        tenantId: ctx.tenantId,
        context: {
          resumeRunId: run.id,
          resumeDecision: { decision, comments },
        },
        priority: 3,
      });
      return { ok: true, jobId };
    },
    cancel(db, _def, id) {
      const exists = db
        .prepare(`SELECT status FROM ai_workflow_runs WHERE id = ?`)
        .get(id) as { status: string } | undefined;
      if (!exists) notFound("Workflow run not found");
      const changed = db
        .prepare(
          `UPDATE ai_workflow_runs
           SET status = 'failed', error = 'cancelled', updated_at = datetime('now')
           WHERE id = ? AND status IN ('running', 'awaiting_input')`
        )
        .run(id).changes;
      if (!changed) conflict(`Run cannot be cancelled (status=${exists.status})`);
      db.prepare(
        `UPDATE ai_prompt_queue
         SET status = 'error', error = 'cancelled', finished_at = datetime('now')
         WHERE status = 'pending'
           AND json_extract(context_json, '$.resumeRunId') = ?`
      ).run(id);
      return { ok: true };
    },
  },
};

function scheduleRecord(
  def: ObjectTypeDef,
  row: NonNullable<ReturnType<typeof getSchedule>>
): RecordRow {
  return record(def, row.id, {
    workflow_id: row.workflow_id,
    cron_expr: row.cron_expr,
    timezone: row.timezone,
    enabled: Boolean(row.enabled),
    last_run_at: row.last_run_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const scheduleServiceAdapter: RecordAdapter = {
  id: "schedule_service",
  list(db, def, query) {
    const result = page(listSchedules(db), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => scheduleRecord(def, row)),
      total: result.total,
    };
  },
  get: (db, def, id) => {
    const row = getSchedule(db, id);
    return row ? scheduleRecord(def, row) : null;
  },
  create(db, def, data) {
    const row = createSchedule(db, {
      workflowId: requiredText(data, "workflow_id"),
      cronExpr: requiredText(data, "cron_expr"),
      timezone: typeof data.timezone === "string" ? data.timezone : undefined,
      enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
    });
    reloadAiSchedules();
    return scheduleRecord(def, row);
  },
  update(db, def, id, data) {
    const row = updateSchedule(db, id, {
      cronExpr: typeof data.cron_expr === "string" ? data.cron_expr : undefined,
      timezone: typeof data.timezone === "string" ? data.timezone : undefined,
      enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
    });
    if (!row) throw Object.assign(new Error("Schedule not found"), { status: 404 });
    reloadAiSchedules();
    return scheduleRecord(def, row);
  },
  delete(db, _def, id) {
    if (!deleteSchedule(db, id)) {
      throw Object.assign(new Error("Schedule not found"), { status: 404 });
    }
    reloadAiSchedules();
  },
  actions: {
    enable(db, def, id) {
      const row = updateSchedule(db, id, { enabled: true });
      if (!row) notFound("Schedule not found");
      reloadAiSchedules();
      return scheduleRecord(def, row);
    },
    disable(db, def, id) {
      const row = updateSchedule(db, id, { enabled: false });
      if (!row) notFound("Schedule not found");
      reloadAiSchedules();
      return scheduleRecord(def, row);
    },
  },
};

function agentRecord(
  def: ObjectTypeDef,
  row: NonNullable<ReturnType<typeof getAgent>>
): RecordRow {
  return record(def, row.id, {
    name: row.name,
    description: row.description,
    icon: row.icon,
    backend: row.backend,
    enabled: row.enabled,
    is_template: row.isTemplate,
    parent_id: row.parentId,
    team: row.team,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

export const agentServiceAdapter: RecordAdapter = {
  id: "agent_service",
  list(db, def, query) {
    const result = page(listAgents(db), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => agentRecord(def, row)),
      total: result.total,
    };
  },
  get: (db, def, id) => {
    const row = getAgent(db, id);
    return row ? agentRecord(def, row) : null;
  },
  create(db, def, data) {
    return agentRecord(
      def,
      createAgent(db, {
        id: typeof data.id === "string" ? data.id : undefined,
        name: requiredText(data, "name"),
        description:
          typeof data.description === "string" ? data.description : undefined,
        icon: typeof data.icon === "string" ? data.icon : undefined,
        backend: typeof data.backend === "string" ? (data.backend as never) : undefined,
        parentId:
          data.parent_id === undefined ? undefined : (data.parent_id as string | null),
        team: data.team === undefined ? undefined : (data.team as string | null),
      })
    );
  },
  update(db, def, id, data) {
    const row = updateAgent(db, id, {
      name: typeof data.name === "string" ? data.name : undefined,
      description:
        data.description === undefined ? undefined : (data.description as string | null),
      icon: data.icon === undefined ? undefined : (data.icon as string | null),
      backend: typeof data.backend === "string" ? (data.backend as never) : undefined,
      enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
      parentId:
        data.parent_id === undefined ? undefined : (data.parent_id as string | null),
      team: data.team === undefined ? undefined : (data.team as string | null),
    });
    if (!row) throw Object.assign(new Error("Agent not found"), { status: 404 });
    return agentRecord(def, row);
  },
  delete(db, _def, id) {
    if (!deleteAgent(db, id)) {
      throw Object.assign(new Error("Agent cannot be deleted"), { status: 409 });
    }
  },
  actions: {
    create_configured(db, def, _id, input) {
      return agentRecord(
        def,
        createAgent(db, {
          name: requiredText(input, "name"),
          description:
            typeof input.description === "string" ? input.description : undefined,
          icon: typeof input.icon === "string" ? input.icon : undefined,
          backend: typeof input.backend === "string" ? (input.backend as never) : undefined,
          systemPrompt:
            typeof input.system_prompt === "string" ? input.system_prompt : undefined,
          sampling:
            input.sampling && typeof input.sampling === "object"
              ? (input.sampling as never)
              : undefined,
          thinking:
            input.thinking && typeof input.thinking === "object"
              ? (input.thinking as never)
              : undefined,
          toolAllow:
            input.tool_allow === null || Array.isArray(input.tool_allow)
              ? (input.tool_allow as string[] | null)
              : undefined,
          autoApprove: Array.isArray(input.auto_approve)
            ? input.auto_approve.map(String)
            : undefined,
          modelPath:
            input.model_path === undefined
              ? undefined
              : (input.model_path as string | null),
          adapterIds: Array.isArray(input.adapter_ids)
            ? input.adapter_ids.map(String)
            : undefined,
          config:
            input.config && typeof input.config === "object"
              ? (input.config as Record<string, unknown>)
              : undefined,
          parentId:
            input.parent_id === undefined
              ? undefined
              : (input.parent_id as string | null),
          team: input.team === undefined ? undefined : (input.team as string | null),
        })
      );
    },
    update_config(db, def, id, input) {
      const row = updateAgent(db, id, {
        name: typeof input.name === "string" ? input.name : undefined,
        description:
          input.description === undefined ? undefined : (input.description as string | null),
        icon: input.icon === undefined ? undefined : (input.icon as string | null),
        backend: typeof input.backend === "string" ? (input.backend as never) : undefined,
        enabled: input.enabled === undefined ? undefined : Boolean(input.enabled),
        systemPrompt:
          typeof input.system_prompt === "string" ? input.system_prompt : undefined,
        sampling:
          input.sampling && typeof input.sampling === "object"
            ? (input.sampling as never)
            : undefined,
        thinking:
          input.thinking && typeof input.thinking === "object"
            ? (input.thinking as never)
            : undefined,
        toolAllow:
          input.tool_allow === null || Array.isArray(input.tool_allow)
            ? (input.tool_allow as string[] | null)
            : undefined,
        autoApprove: Array.isArray(input.auto_approve)
          ? input.auto_approve.map(String)
          : undefined,
        modelPath:
          input.model_path === undefined ? undefined : (input.model_path as string | null),
        adapterIds: Array.isArray(input.adapter_ids)
          ? input.adapter_ids.map(String)
          : undefined,
        config:
          input.config && typeof input.config === "object"
            ? (input.config as Record<string, unknown>)
            : undefined,
        parentId:
          input.parent_id === undefined ? undefined : (input.parent_id as string | null),
        team: input.team === undefined ? undefined : (input.team as string | null),
      });
      if (!row) notFound("Agent not found");
      return agentRecord(def, row);
    },
    clone(db, def, id, input) {
      const source = getAgent(db, id);
      if (!source) notFound("Agent not found");
      const cloned = createAgent(db, {
        id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : undefined,
        name: requiredText(input, "name"),
        description:
          typeof input.description === "string" ? input.description : undefined,
        cloneFromId: source.id,
        parentId:
          input.parent_id === undefined
            ? source.parentId
            : (input.parent_id as string | null),
        team:
          input.team === undefined ? source.team : (input.team as string | null),
      });
      return agentRecord(def, cloned);
    },
    assign(db, _def, id, input) {
      if (!getAgent(db, id)) notFound("Agent not found");
      const row = setAssignment(
        db,
        requiredText(input, "scope_type") as AssignmentScopeType,
        requiredText(input, "scope_id"),
        id,
        typeof input.role === "string" ? (input.role as never) : undefined
      );
      if (!row) conflict("Assignment not created");
      return {
        id: assignmentId(row),
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        agent_id: row.agent_id,
        role: row.role,
        updated_at: row.updated_at,
      };
    },
    configure_reflection(db, _def, id, input, ctx) {
      if (!getAgent(db, id)) notFound("Agent not found");
      const current = getReflectionConfig(db, id);
      const patch: Partial<AgentReflectionConfig> = {};
      if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
      if (input.mode !== undefined) {
        if (input.mode !== "approval" && input.mode !== "auto") {
          throw Object.assign(new Error("Invalid reflection mode"), { status: 400 });
        }
        patch.mode = input.mode;
      }
      if (input.schedule && typeof input.schedule === "object") {
        patch.schedule = {
          ...current.schedule,
          ...(input.schedule as Partial<AgentReflectionConfig["schedule"]>),
        };
      }
      if (input.idle && typeof input.idle === "object") {
        patch.idle = {
          ...current.idle,
          ...(input.idle as Partial<AgentReflectionConfig["idle"]>),
        };
      }
      const next = patchReflectionConfig(db, id, patch);
      if (!next) notFound("Agent not found");
      ctx.bus?.emit("agent.reflection.updated", {
        agentId: id,
        tenantId: ctx.tenantId,
      });
      return { reflection: next };
    },
    run_reflection(db, _def, id, _input, ctx) {
      if (!getAgent(db, id)) notFound("Agent not found");
      const jobId = enqueueAiJob(db, {
        tenantId: ctx.tenantId,
        context: {
          reflectionAgentId: id,
          reflectionTrigger: "manual",
        },
        priority: 0,
      });
      return { ok: true, jobId };
    },
  },
};

function assignmentId(row: Pick<AiAgentAssignment, "scope_type" | "scope_id">): string {
  return `${row.scope_type}:${row.scope_id}`;
}

function parseAssignmentId(id: string): {
  scopeType: AssignmentScopeType;
  scopeId: string;
} {
  const separator = id.indexOf(":");
  if (separator < 1 || separator === id.length - 1) {
    throw Object.assign(new Error("Assignment id must be scope_type:scope_id"), {
      status: 400,
    });
  }
  return {
    scopeType: id.slice(0, separator) as AssignmentScopeType,
    scopeId: id.slice(separator + 1),
  };
}

function assignmentRecord(def: ObjectTypeDef, row: AiAgentAssignment): RecordRow {
  return record(def, assignmentId(row), {
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    agent_id: row.agent_id,
    role: row.role,
    updated_at: row.updated_at,
  });
}

export const assignmentServiceAdapter: RecordAdapter = {
  id: "agent_assignment_service",
  list(db, def, query) {
    const result = page(listAssignments(db), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => assignmentRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id) {
    const parsed = parseAssignmentId(id);
    const row = getAssignment(db, parsed.scopeType, parsed.scopeId);
    return row ? assignmentRecord(def, row) : null;
  },
  create(db, def, data) {
    const row = setAssignment(
      db,
      requiredText(data, "scope_type") as AssignmentScopeType,
      requiredText(data, "scope_id"),
      requiredText(data, "agent_id"),
      typeof data.role === "string" ? (data.role as never) : undefined
    );
    if (!row) throw Object.assign(new Error("Assignment not created"), { status: 400 });
    return assignmentRecord(def, row);
  },
  update(db, def, id, data) {
    const parsed = parseAssignmentId(id);
    const existing = getAssignment(db, parsed.scopeType, parsed.scopeId);
    if (!existing) throw Object.assign(new Error("Assignment not found"), { status: 404 });
    const row = setAssignment(
      db,
      parsed.scopeType,
      parsed.scopeId,
      typeof data.agent_id === "string" ? data.agent_id : existing.agent_id,
      typeof data.role === "string" ? (data.role as never) : existing.role
    );
    if (!row) throw Object.assign(new Error("Assignment not found"), { status: 404 });
    return assignmentRecord(def, row);
  },
  delete(db, _def, id) {
    const parsed = parseAssignmentId(id);
    if (!getAssignment(db, parsed.scopeType, parsed.scopeId)) {
      throw Object.assign(new Error("Assignment not found"), { status: 404 });
    }
    setAssignment(db, parsed.scopeType, parsed.scopeId, null);
  },
};

function wikiScope(ctx: OperationContext): WikiScope {
  return { tenantIds: ctx.tenantId ? [ctx.tenantId] : [] };
}

function wikiRecord(
  def: ObjectTypeDef,
  row: NonNullable<ReturnType<typeof getPageById>>
): RecordRow {
  return record(def, row.id, {
    tenant_id: row.tenant_id,
    space: row.space,
    slug: row.slug,
    title: row.title,
    body_markdown: row.body_markdown,
    visibility: row.visibility,
    author_user_id: row.author_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const wikiPageServiceAdapter: RecordAdapter = {
  id: "wiki_page_service",
  list(_db, def, query, ctx) {
    let rows = listPages(wikiScope(ctx), {
      visibility:
        typeof query.filters?.visibility === "string"
          ? (query.filters.visibility as never)
          : undefined,
      space:
        typeof query.filters?.space === "string"
          ? query.filters.space
          : undefined,
    });
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => wikiRecord(def, row)),
      total: result.total,
    };
  },
  get(_db, def, id, ctx) {
    const row = getPageById(id);
    if (
      !row ||
      (row.visibility !== "external" &&
        !wikiScope(ctx).tenantIds.includes(row.tenant_id))
    ) {
      return null;
    }
    return wikiRecord(def, row);
  },
  create(_db, def, data, ctx) {
    if (!ctx.tenantId || !ctx.userId) {
      throw Object.assign(new Error("Tenant and user required"), { status: 401 });
    }
    return wikiRecord(
      def,
      createPage({
        tenantId: ctx.tenantId,
        authorUserId: ctx.userId,
        title: requiredText(data, "title"),
        bodyMarkdown:
          typeof data.body_markdown === "string" ? data.body_markdown : undefined,
        space:
          data.space === undefined ? undefined : (data.space as string | null),
        visibility:
          typeof data.visibility === "string" ? (data.visibility as never) : undefined,
        slug: typeof data.slug === "string" ? data.slug : undefined,
      })
    );
  },
  update(_db, def, id, data, ctx) {
    return wikiRecord(
      def,
      updatePage(
        id,
        {
          title: typeof data.title === "string" ? data.title : undefined,
          bodyMarkdown:
            typeof data.body_markdown === "string"
              ? data.body_markdown
              : undefined,
          space:
            data.space === undefined ? undefined : (data.space as string | null),
          visibility:
            typeof data.visibility === "string"
              ? (data.visibility as never)
              : undefined,
        },
        wikiScope(ctx)
      )
    );
  },
  delete(_db, _def, id, ctx) {
    deletePage(id, wikiScope(ctx));
  },
};

function revisionRecord(
  def: ObjectTypeDef,
  row: Record<string, unknown>
): RecordRow {
  return record(def, String(row.id), {
    page_id: row.page_id,
    title: row.title,
    body_markdown: row.body_markdown,
    author_user_id: row.author_user_id,
    created_at: row.created_at,
  });
}

export const wikiRevisionServiceAdapter: RecordAdapter = {
  id: "wiki_revision_service",
  list(_db, def, query, ctx) {
    const db = getCoreDb();
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const tenantId = ctx.tenantId ?? "";
    const predicate = `(p.visibility='external' OR p.tenant_id=?)`;
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM wiki_revisions r
           JOIN wiki_pages p ON p.id=r.page_id WHERE ${predicate}`
        )
        .get(tenantId) as { c: number }
    ).c;
    const rows = db
      .prepare(
        `SELECT r.* FROM wiki_revisions r
         JOIN wiki_pages p ON p.id=r.page_id
         WHERE ${predicate}
         ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(tenantId, limit, offset) as Record<string, unknown>[];
    return {
      objectType: def.name,
      records: rows.map((row) => revisionRecord(def, row)),
      total,
    };
  },
  get(_db, def, id, ctx) {
    const row = getCoreDb()
      .prepare(
        `SELECT r.* FROM wiki_revisions r
         JOIN wiki_pages p ON p.id=r.page_id
         WHERE r.id=? AND (p.visibility='external' OR p.tenant_id=?)`
      )
      .get(id, ctx.tenantId ?? "") as Record<string, unknown> | undefined;
    return row ? revisionRecord(def, row) : null;
  },
};

function hookScope(db: AppDatabase, ctx: OperationContext): HookOwnerScope {
  if (!ctx.userId) throw Object.assign(new Error("Authenticated user required"), { status: 401 });
  return {
    userId: ctx.userId,
    tenantId: ctx.tenantId ?? null,
    agentIds: listAgents(db).map((agent) => agent.id),
  };
}

function hookRecord(def: ObjectTypeDef, row: ReturnType<typeof getHook>): RecordRow {
  return record(def, row.id, {
    owner_kind: row.owner_kind,
    owner_id: row.owner_id,
    owner_tenant_id: row.owner_tenant_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    trigger_kind: row.trigger_kind,
    event_type: row.event_type,
    schedule_cron: row.schedule_cron,
    condition_json: parseJson(row.condition_json),
    action_kind: row.action_kind,
    action_config_json: redactCredentials(parseJson(row.action_config_json)),
    require_approval: Boolean(row.require_approval),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_fired_at: row.last_fired_at,
  });
}

export const hookServiceAdapter: RecordAdapter = {
  id: "hook_service",
  list(db, def, query, ctx) {
    const result = page(listHooks(hookScope(db, ctx)), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => hookRecord(def, row)),
      total: result.total,
    };
  },
  get: (db, def, id, ctx) => hookRecord(def, getHook(id, hookScope(db, ctx))),
  create(db, def, data, ctx) {
    const scope = hookScope(db, ctx);
    const created = hookRecord(
      def,
      createHook(
        {
          ownerKind: requiredText(data, "owner_kind") as never,
          ownerId: requiredText(data, "owner_id"),
          ownerTenantId:
            data.owner_tenant_id === undefined
              ? undefined
              : (data.owner_tenant_id as string | null),
          name: requiredText(data, "name"),
          enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
          triggerKind: requiredText(data, "trigger_kind") as never,
          eventType: data.event_type as string | null | undefined,
          scheduleCron: data.schedule_cron as string | null | undefined,
          conditionJson: jsonText(data.condition_json),
          actionKind: requiredText(data, "action_kind") as never,
          actionConfigJson: jsonText(data.action_config_json),
          requireApproval: Boolean(data.require_approval),
        },
        scope
      )
    );
    refreshScheduler();
    return created;
  },
  update(db, def, id, data, ctx) {
    const updated = hookRecord(
      def,
      updateHook(
        id,
        {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.trigger_kind !== undefined
            ? { triggerKind: data.trigger_kind }
            : {}),
          ...(data.event_type !== undefined ? { eventType: data.event_type } : {}),
          ...(data.schedule_cron !== undefined
            ? { scheduleCron: data.schedule_cron }
            : {}),
          ...(data.condition_json !== undefined
            ? { conditionJson: jsonText(data.condition_json) }
            : {}),
          ...(data.action_kind !== undefined
            ? { actionKind: data.action_kind }
            : {}),
          ...(data.action_config_json !== undefined
            ? { actionConfigJson: jsonText(data.action_config_json) }
            : {}),
          ...(data.require_approval !== undefined
            ? { requireApproval: data.require_approval }
            : {}),
        },
        hookScope(db, ctx)
      )
    );
    refreshScheduler();
    return updated;
  },
  delete(db, _def, id, ctx) {
    deleteHook(id, hookScope(db, ctx));
    refreshScheduler();
  },
  actions: {
    enable(db, def, id, _input, ctx) {
      const row = updateHook(id, { enabled: true }, hookScope(db, ctx));
      refreshScheduler();
      return hookRecord(def, row);
    },
    disable(db, def, id, _input, ctx) {
      const row = updateHook(id, { enabled: false }, hookScope(db, ctx));
      refreshScheduler();
      return hookRecord(def, row);
    },
  },
};

function hookRunRecord(
  def: ObjectTypeDef,
  row: Record<string, unknown>
): RecordRow {
  return record(def, String(row.id), {
    hook_id: row.hook_id,
    event_id: row.event_id,
    status: row.status,
    detail: row.detail,
    result_json:
      typeof row.result_json === "string"
        ? parseJson(row.result_json)
        : row.result_json,
    created_at: row.created_at,
  });
}

export const hookRunServiceAdapter: RecordAdapter = {
  id: "hook_run_read",
  list(db, def, query, ctx) {
    const scope = hookScope(db, ctx);
    const rows = listHooks(scope).flatMap((hook) =>
      getCoreDb()
        .prepare(
          `SELECT * FROM hook_runs WHERE hook_id = ?
           ORDER BY created_at DESC LIMIT 200`
        )
        .all(hook.id) as Record<string, unknown>[]
    );
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => hookRunRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    const scope = hookScope(db, ctx);
    getHookForRun(id, scope);
    const row = getCoreDb()
      .prepare(`SELECT * FROM hook_runs WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? hookRunRecord(def, row) : null;
  },
  actions: {
    async approve(db, _def, id, _input, ctx) {
      const coreDb = getCoreDb();
      getHookForRun(id, hookScope(db, ctx), coreDb);
      const row = coreDb
        .prepare(`SELECT status FROM hook_runs WHERE id = ?`)
        .get(id) as { status: string } | undefined;
      if (!row) notFound("Hook run not found");
      if (row.status !== "pending_approval") {
        conflict(`Hook run is not pending approval (status=${row.status})`);
      }
      await approveHookRun(id, coreDb);
      return { ok: true };
    },
    reject(db, _def, id, _input, ctx) {
      const coreDb = getCoreDb();
      getHookForRun(id, hookScope(db, ctx), coreDb);
      const row = coreDb
        .prepare(`SELECT status FROM hook_runs WHERE id = ?`)
        .get(id) as { status: string } | undefined;
      if (!row) notFound("Hook run not found");
      if (row.status !== "pending_approval") {
        conflict(`Hook run is not pending approval (status=${row.status})`);
      }
      rejectHookRun(id, coreDb);
      return { ok: true };
    },
  },
};
