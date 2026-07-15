import { v4 as uuidv4 } from "uuid";
import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import type { AppDatabase } from "../../db.js";
import {
  createRuleFile,
  deleteRuleFile,
  listAiRules,
  setAiRuleStatus,
  updateAiRuleState,
} from "../../services/ai-rules.js";
import {
  createSkillFile,
  deleteSkillFile,
  listAiSkills,
  setAiSkillStatus,
  updateAiSkillState,
} from "../../services/ai-skills.js";
import {
  deleteArtifact,
  getArtifact,
  listArtifacts,
  readArtifact,
  saveArtifact,
} from "../../services/ai-artifacts.js";
import {
  approveWikiProposal,
  createWikiProposal,
  listWikiProposals,
  rejectWikiProposal,
  type WikiPageProposal,
  type WikiProposalStatus,
} from "../../services/wiki-proposals.js";
import {
  approveReflectionProposal,
  createReflectionProposal,
  listReflectionProposals,
  rejectReflectionProposal,
  type ReflectionProposal,
} from "../../services/reflection-proposals.js";
import {
  clearNotifications,
  createNotification,
  deleteNotification,
  listNotificationsForAgent,
  listNotificationsForUser,
  markAllRead,
  markRead,
  type NotificationRecipient,
} from "../../services/notification-service.js";
import {
  indexMemory,
  removeMemoryFromIndex,
} from "../../services/embeddings/memory-embeddings.js";
import type {
  OperationContext,
  RecordAdapter,
  RecordQuery,
} from "../adapter-registry.js";

export const CONTENT_LIFECYCLE_ACTIONS: ActionDef[] = [
  {
    name: "approve",
    label: "Approve",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["editor", "owner", "intelligence"],
    idempotency: { required: true },
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "reject",
    label: "Reject",
    target: "record",
    effect: "destructive",
    execution: "sync",
    roles: ["editor", "owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    idempotency: { required: true },
    inputSchema: { type: "object", additionalProperties: false },
  },
];

export const NOTIFICATION_ACTIONS: ActionDef[] = [
  {
    name: "mark_read",
    label: "Mark Read",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["viewer", "editor", "owner", "intelligence"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "mark_all_read",
    label: "Mark All Read",
    target: "collection",
    effect: "write",
    execution: "sync",
    roles: ["viewer", "editor", "owner", "intelligence"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "clear",
    label: "Clear",
    target: "collection",
    effect: "destructive",
    execution: "sync",
    roles: ["viewer", "editor", "owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    idempotency: { required: true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { read_only: { type: "boolean" } },
    },
  },
];

type DataRow = Record<string, unknown>;

function record(def: ObjectTypeDef, id: string, data: RecordData): RecordRow {
  return { id, objectType: def.name, data: { id, ...data } };
}

function page<T>(rows: T[], query: RecordQuery): { rows: T[]; total: number } {
  const offset = Math.max(Number(query.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

function requiredText(data: RecordData, name: string): string {
  const value = data[name];
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`${name} required`), { status: 400 });
  }
  return value.trim();
}

function notFound(label: string): never {
  throw Object.assign(new Error(`${label} not found`), { status: 404 });
}

function agentId(ctx: OperationContext): string {
  return ctx.agentId ?? "intelligence";
}

function agentClause(ctx: OperationContext): { sql: string; params: string[] } {
  const id = agentId(ctx);
  return id === "intelligence"
    ? { sql: `(agent_id = ? OR agent_id IS NULL)`, params: [id] }
    : { sql: `agent_id = ?`, params: [id] };
}

function coreDb(db: AppDatabase, ctx: OperationContext): AppDatabase {
  return ctx.data?.coreDb ?? db;
}

function jsonArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map(String);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function memoryRecord(
  def: ObjectTypeDef,
  row: DataRow
): RecordRow {
  return record(def, String(row.id), {
    agent_id: row.agent_id ?? "intelligence",
    scope: row.scope,
    chat_id: row.chat_id,
    text: row.text,
    category: row.category,
    source: row.source,
    enabled: Boolean(row.enabled),
    status: row.status,
    pack_id: row.pack_id,
    valid_from: row.valid_from,
    valid_until: row.valid_until,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function memoryRow(
  db: AppDatabase,
  id: string,
  ctx: OperationContext
): DataRow | undefined {
  const scope = agentClause(ctx);
  return db
    .prepare(
      `SELECT id, agent_id, scope, chat_id, text, category, source, enabled,
              status, pack_id, valid_from, valid_until, created_at, updated_at
       FROM ai_memories WHERE id = ? AND ${scope.sql}`
    )
    .get(id, ...scope.params) as DataRow | undefined;
}

export const memoryServiceAdapter: RecordAdapter = {
  id: "memory_service",
  list(db, def, query, ctx) {
    const scope = agentClause(ctx);
    const filters = query.filters ?? {};
    const where = [scope.sql];
    const params: unknown[] = [...scope.params];
    if (filters.status === "active" || filters.status === "pending") {
      where.push("status = ?");
      params.push(filters.status);
    }
    if (typeof filters.scope === "string") {
      where.push("scope = ?");
      params.push(filters.scope);
    }
    if (typeof filters.chat_id === "string") {
      where.push("(scope = 'global' OR (scope = 'chat' AND chat_id = ?))");
      params.push(filters.chat_id);
    }
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM ai_memories WHERE ${where.join(" AND ")}`)
        .get(...params) as { c: number }
    ).c;
    const offset = Math.max(Number(query.offset) || 0, 0);
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const rows = db
      .prepare(
        `SELECT id, agent_id, scope, chat_id, text, category, source, enabled,
                status, pack_id, valid_from, valid_until, created_at, updated_at
         FROM ai_memories WHERE ${where.join(" AND ")}
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as DataRow[];
    return {
      objectType: def.name,
      records: rows.map((row) => memoryRecord(def, row)),
      total,
    };
  },
  get(db, def, id, ctx) {
    const row = memoryRow(db, id, ctx);
    return row ? memoryRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    const text = requiredText(data, "text");
    const scope = data.scope === "chat" ? "chat" : "global";
    const chatId =
      scope === "chat" && typeof data.chat_id === "string" && data.chat_id
        ? data.chat_id
        : null;
    if (scope === "chat" && !chatId) {
      throw Object.assign(new Error("chat_id required for chat memory"), {
        status: 400,
      });
    }
    const id =
      typeof data.id === "string" && data.id.trim() ? data.id.trim() : uuidv4();
    const status = data.status === "pending" ? "pending" : "active";
    db.prepare(
      `INSERT INTO ai_memories
       (id, agent_id, scope, chat_id, text, category, source, enabled, status,
        pack_id, valid_from, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      agentId(ctx),
      scope,
      chatId,
      text,
      data.category ?? null,
      typeof data.source === "string" ? data.source : "manual",
      data.enabled === false ? 0 : 1,
      status,
      data.pack_id ?? null,
      data.valid_from ?? null,
      data.valid_until ?? null
    );
    if (status === "active" && data.enabled !== false) {
      indexMemory(db, null, id, text);
    }
    return memoryRecord(def, memoryRow(db, id, ctx)!);
  },
  update(db, def, id, data, ctx) {
    const existing = memoryRow(db, id, ctx);
    if (!existing) notFound("Memory");
    const writable = new Set([
      "text",
      "category",
      "enabled",
      "status",
      "valid_from",
      "valid_until",
    ]);
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [name, value] of Object.entries(data)) {
      if (!writable.has(name)) continue;
      if (name === "text" && (typeof value !== "string" || !value.trim())) {
        throw Object.assign(new Error("text required"), { status: 400 });
      }
      if (name === "status" && value !== "active" && value !== "pending") {
        throw Object.assign(new Error("status must be active or pending"), {
          status: 400,
        });
      }
      sets.push(`"${name}" = ?`);
      values.push(name === "enabled" ? (value ? 1 : 0) : value ?? null);
    }
    if (sets.length) {
      sets.push(`updated_at = datetime('now')`);
      const scope = agentClause(ctx);
      db.prepare(
        `UPDATE ai_memories SET ${sets.join(", ")}
         WHERE id = ? AND ${scope.sql}`
      ).run(...values, id, ...scope.params);
    }
    const row = memoryRow(db, id, ctx)!;
    if (row.status === "active" && Boolean(row.enabled)) {
      indexMemory(db, null, id, String(row.text));
    } else {
      removeMemoryFromIndex(db, id);
    }
    return memoryRecord(def, row);
  },
  delete(db, _def, id, ctx) {
    if (!memoryRow(db, id, ctx)) notFound("Memory");
    removeMemoryFromIndex(db, id);
    const scope = agentClause(ctx);
    db.prepare(`DELETE FROM ai_memories WHERE id = ? AND ${scope.sql}`).run(
      id,
      ...scope.params
    );
  },
  actions: {
    approve(db, def, id, _input, ctx) {
      return memoryServiceAdapter.update!(db, def, id, { status: "active" }, ctx);
    },
    reject(db, _def, id, _input, ctx) {
      const row = memoryRow(db, id, ctx);
      if (!row || row.status !== "pending") notFound("Pending memory");
      memoryServiceAdapter.delete!(db, _def, id, ctx);
      return { ok: true };
    },
  },
};

function ruleRecord(
  def: ObjectTypeDef,
  row: ReturnType<typeof listAiRules>[number]
): RecordRow {
  return record(def, row.id, {
    agent_id: row.agentId ?? "intelligence",
    description: row.description,
    body: row.body,
    always_apply: row.alwaysApply,
    globs_json: row.globs,
    departments_json: row.departments,
    priority: row.priority,
    enabled: row.enabled,
    status: row.status,
    version: row.version,
    updated_at: row.updatedAt,
  });
}

function findRule(db: AppDatabase, id: string, ctx: OperationContext) {
  return listAiRules(db, agentId(ctx)).find((row) => row.id === id);
}

function assertOwnedKnowledge(
  db: AppDatabase,
  table: "ai_rules" | "ai_skills",
  id: string,
  ctx: OperationContext,
  label: string
): void {
  const row = db
    .prepare(`SELECT agent_id, status FROM ${table} WHERE id = ?`)
    .get(id) as { agent_id: string | null; status: string } | undefined;
  if (!row || (row.agent_id ?? "intelligence") !== agentId(ctx)) {
    throw Object.assign(new Error(`${label} is shared or not owned by this agent`), {
      status: 403,
    });
  }
}

export const ruleServiceAdapter: RecordAdapter = {
  id: "rule_service",
  list(db, def, query, ctx) {
    const result = page(listAiRules(db, agentId(ctx)), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => ruleRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    const row = findRule(db, id, ctx);
    return row ? ruleRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    const description = requiredText(data, "description");
    const id = createRuleFile(
      db,
      agentId(ctx),
      {
        name:
          typeof data.id === "string" && data.id.trim()
            ? data.id
            : description,
        description,
        body: requiredText(data, "body"),
        globs: jsonArray(data.globs_json),
        departments: jsonArray(data.departments_json),
        alwaysApply:
          typeof data.always_apply === "boolean"
            ? data.always_apply
            : undefined,
        priority:
          typeof data.priority === "number" ? data.priority : undefined,
      },
      data.status === "active" ? "active" : "pending"
    );
    return ruleRecord(def, findRule(db, id, ctx)!);
  },
  update(db, def, id, data, ctx) {
    if (!findRule(db, id, ctx)) notFound("Rule");
    updateAiRuleState(db, agentId(ctx), id, {
      enabled:
        typeof data.enabled === "boolean" ? data.enabled : undefined,
      priorityOverride:
        typeof data.priority === "number" ? data.priority : undefined,
    });
    return ruleRecord(def, findRule(db, id, ctx)!);
  },
  delete(db, _def, id, ctx) {
    assertOwnedKnowledge(db, "ai_rules", id, ctx, "Rule");
    if (!deleteRuleFile(db, id)) notFound("Rule");
  },
  actions: {
    approve(db, def, id, _input, ctx) {
      if (!findRule(db, id, ctx)) notFound("Rule");
      setAiRuleStatus(db, agentId(ctx), id, "active");
      return ruleRecord(def, findRule(db, id, ctx)!);
    },
    reject(db, _def, id, _input, ctx) {
      assertOwnedKnowledge(db, "ai_rules", id, ctx, "Rule");
      const row = db
        .prepare(`SELECT status FROM ai_rules WHERE id = ?`)
        .get(id) as { status: string };
      if (row.status !== "pending") {
        throw Object.assign(new Error("Only pending rules can be rejected"), {
          status: 409,
        });
      }
      if (!deleteRuleFile(db, id)) notFound("Rule");
      return { ok: true };
    },
  },
};

function skillRecord(
  def: ObjectTypeDef,
  row: ReturnType<typeof listAiSkills>[number]
): RecordRow {
  return record(def, row.id, {
    agent_id: row.agentId ?? "intelligence",
    name: row.name,
    description: row.description,
    body: row.body,
    tools_json: row.tools,
    departments_json: row.departments,
    enabled: row.enabled,
    status: row.status,
    version: row.version,
    updated_at: row.updatedAt,
  });
}

function findSkill(db: AppDatabase, id: string, ctx: OperationContext) {
  return listAiSkills(db, true, agentId(ctx)).find((row) => row.id === id);
}

export const skillServiceAdapter: RecordAdapter = {
  id: "skill_service",
  list(db, def, query, ctx) {
    const result = page(listAiSkills(db, true, agentId(ctx)), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => skillRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    const row = findSkill(db, id, ctx);
    return row ? skillRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    const id = createSkillFile(
      db,
      agentId(ctx),
      {
        name: requiredText(data, "name"),
        description:
          typeof data.description === "string" ? data.description : "",
        body: requiredText(data, "body"),
        tools: jsonArray(data.tools_json),
        departments: jsonArray(data.departments_json),
      },
      data.status === "active" ? "active" : "pending"
    );
    return skillRecord(def, findSkill(db, id, ctx)!);
  },
  update(db, def, id, data, ctx) {
    if (!findSkill(db, id, ctx)) notFound("Skill");
    if (typeof data.enabled === "boolean") {
      updateAiSkillState(db, agentId(ctx), id, data.enabled);
    }
    return skillRecord(def, findSkill(db, id, ctx)!);
  },
  delete(db, _def, id, ctx) {
    assertOwnedKnowledge(db, "ai_skills", id, ctx, "Skill");
    if (!deleteSkillFile(db, id)) notFound("Skill");
  },
  actions: {
    approve(db, def, id, _input, ctx) {
      if (!findSkill(db, id, ctx)) notFound("Skill");
      setAiSkillStatus(db, agentId(ctx), id, "active");
      return skillRecord(def, findSkill(db, id, ctx)!);
    },
    reject(db, _def, id, _input, ctx) {
      assertOwnedKnowledge(db, "ai_skills", id, ctx, "Skill");
      const row = db
        .prepare(`SELECT status FROM ai_skills WHERE id = ?`)
        .get(id) as { status: string };
      if (row.status !== "pending") {
        throw Object.assign(new Error("Only pending skills can be rejected"), {
          status: 409,
        });
      }
      if (!deleteSkillFile(db, id)) notFound("Skill");
      return { ok: true };
    },
  },
};

function artifactRecord(
  def: ObjectTypeDef,
  row: NonNullable<ReturnType<typeof getArtifact>> & { has_content?: number }
): RecordRow {
  return record(def, row.id, {
    agent_id: row.agent_id,
    name: row.name,
    kind: row.kind,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    description: row.description,
    source: row.source,
    has_content: Boolean(row.has_content ?? row.size_bytes),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const artifactServiceAdapter: RecordAdapter = {
  id: "artifact_service",
  list(db, def, query, ctx) {
    const rows = listArtifacts(db, agentId(ctx), 500);
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => artifactRecord(def, row)),
      total: rows.length,
    };
  },
  get(db, def, id, ctx) {
    const row = getArtifact(db, agentId(ctx), id);
    return row ? artifactRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    return artifactRecord(
      def,
      saveArtifact(db, agentId(ctx), {
        name: requiredText(data, "name"),
        content: typeof data.content === "string" ? data.content : "",
        kind: typeof data.kind === "string" ? data.kind : undefined,
        mimeType:
          typeof data.mime_type === "string" ? data.mime_type : undefined,
        description:
          typeof data.description === "string" ? data.description : undefined,
        source: typeof data.source === "string" ? data.source : "manual",
      })
    );
  },
  update(db, def, id, data, ctx) {
    const existing = getArtifact(db, agentId(ctx), id);
    if (!existing) notFound("Artifact");
    if (typeof data.name === "string" && data.name !== existing.name) {
      throw Object.assign(new Error("Artifact name cannot be changed"), {
        status: 400,
      });
    }
    const content =
      typeof data.content === "string"
        ? data.content
        : readArtifact(db, agentId(ctx), id).content;
    return artifactRecord(
      def,
      saveArtifact(db, agentId(ctx), {
        name: existing.name,
        content,
        kind: typeof data.kind === "string" ? data.kind : existing.kind,
        mimeType:
          data.mime_type === null
            ? undefined
            : typeof data.mime_type === "string"
              ? data.mime_type
              : existing.mime_type ?? undefined,
        description:
          data.description === null
            ? undefined
            : typeof data.description === "string"
              ? data.description
              : existing.description ?? undefined,
        source:
          typeof data.source === "string" ? data.source : existing.source,
      })
    );
  },
  delete(db, _def, id, ctx) {
    if (!deleteArtifact(db, agentId(ctx), id)) notFound("Artifact");
  },
};

function wikiProposalRecord(
  def: ObjectTypeDef,
  row: WikiPageProposal
): RecordRow {
  return record(def, row.id, { ...row });
}

function wikiProposal(
  db: AppDatabase,
  id: string,
  ctx: OperationContext
): WikiPageProposal | undefined {
  if (!ctx.tenantId) return undefined;
  return listWikiProposals(
    { tenantId: ctx.tenantId, status: "all" },
    coreDb(db, ctx)
  ).find((row) => row.id === id);
}

export const wikiProposalServiceAdapter: RecordAdapter = {
  id: "wiki_proposal_service",
  list(db, def, query, ctx) {
    if (!ctx.tenantId) {
      throw Object.assign(new Error("Tenant required"), { status: 401 });
    }
    const status =
      query.filters?.status === "all" ||
      query.filters?.status === "pending" ||
      query.filters?.status === "approved" ||
      query.filters?.status === "rejected"
        ? (query.filters.status as WikiProposalStatus | "all")
        : "all";
    const rows = listWikiProposals(
      { tenantId: ctx.tenantId, status },
      coreDb(db, ctx)
    );
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => wikiProposalRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    const row = wikiProposal(db, id, ctx);
    return row ? wikiProposalRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    if (!ctx.tenantId) {
      throw Object.assign(new Error("Tenant required"), { status: 401 });
    }
    const action = data.action === "update" ? "update" : "create";
    if (action === "update" && typeof data.target_page_id !== "string") {
      throw Object.assign(new Error("target_page_id required for update"), {
        status: 400,
      });
    }
    return wikiProposalRecord(
      def,
      createWikiProposal(
        {
          tenantId: ctx.tenantId,
          action,
          title: requiredText(data, "title"),
          bodyMarkdown:
            typeof data.body_markdown === "string" ? data.body_markdown : "",
          space: data.space as string | null | undefined,
          slug: data.slug as string | null | undefined,
          targetPageId: data.target_page_id as string | null | undefined,
          reason: data.reason as string | null | undefined,
          source: typeof data.source === "string" ? data.source : "manual",
        },
        coreDb(db, ctx)
      )
    );
  },
  actions: {
    approve(db, _def, id, _input, ctx) {
      const row = wikiProposal(db, id, ctx);
      if (!row) notFound("Wiki proposal");
      if (!ctx.userId || !ctx.tenantId) {
        throw Object.assign(new Error("Tenant and user required"), {
          status: 401,
        });
      }
      const result = approveWikiProposal(
        id,
        {
          authorUserId: ctx.userId,
          scope: { tenantIds: [ctx.tenantId] },
        },
        coreDb(db, ctx)
      );
      if (!result.ok) {
        throw Object.assign(new Error(result.error ?? "Approval failed"), {
          status: 409,
        });
      }
      return result;
    },
    reject(db, _def, id, _input, ctx) {
      if (!wikiProposal(db, id, ctx)) notFound("Wiki proposal");
      if (!rejectWikiProposal(id, coreDb(db, ctx))) {
        throw Object.assign(new Error("Wiki proposal is not pending"), {
          status: 409,
        });
      }
      return { ok: true };
    },
  },
};

function reflectionRecord(
  def: ObjectTypeDef,
  row: ReflectionProposal
): RecordRow {
  return record(def, row.id, {
    agent_id: row.agent_id,
    kind: row.kind,
    target_id: row.target_id,
    action: row.action,
    payload_json: parseJson(row.payload_json),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function reflectionProposal(
  db: AppDatabase,
  id: string,
  ctx: OperationContext
): ReflectionProposal | undefined {
  return listReflectionProposals(db, agentId(ctx), "all").find(
    (row) => row.id === id
  );
}

export const reflectionProposalServiceAdapter: RecordAdapter = {
  id: "reflection_proposal_service",
  list(db, def, query, ctx) {
    const requested = query.filters?.status;
    const status =
      requested === "pending" ||
      requested === "approved" ||
      requested === "rejected" ||
      requested === "all"
        ? requested
        : "all";
    const rows = listReflectionProposals(db, agentId(ctx), status);
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => reflectionRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    const row = reflectionProposal(db, id, ctx);
    return row ? reflectionRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    const id = createReflectionProposal(db, {
      agentId: agentId(ctx),
      kind: requiredText(data, "kind") as never,
      targetId: requiredText(data, "target_id"),
      action: requiredText(data, "action") as never,
      payload:
        data.payload_json && typeof data.payload_json === "object"
          ? (data.payload_json as never)
          : undefined,
    });
    return reflectionRecord(def, reflectionProposal(db, id, ctx)!);
  },
  actions: {
    approve(db, _def, id, _input, ctx) {
      if (!reflectionProposal(db, id, ctx)) notFound("Reflection proposal");
      if (!approveReflectionProposal(db, id)) {
        throw Object.assign(new Error("Reflection proposal is not pending"), {
          status: 409,
        });
      }
      return { ok: true };
    },
    reject(db, _def, id, _input, ctx) {
      if (!reflectionProposal(db, id, ctx)) notFound("Reflection proposal");
      if (!rejectReflectionProposal(db, id)) {
        throw Object.assign(new Error("Reflection proposal is not pending"), {
          status: 409,
        });
      }
      return { ok: true };
    },
  },
};

function recipient(ctx: OperationContext): NotificationRecipient {
  if (ctx.source === "agent" || (!ctx.userId && ctx.agentId)) {
    if (!ctx.agentId) {
      throw Object.assign(new Error("Agent required"), { status: 401 });
    }
    return { kind: "agent", id: ctx.agentId };
  }
  if (!ctx.userId) {
    throw Object.assign(new Error("Authenticated user required"), {
      status: 401,
    });
  }
  return { kind: "user", id: ctx.userId };
}

type NotificationRow = ReturnType<typeof listNotificationsForUser>[number];

function notificationRecord(
  def: ObjectTypeDef,
  row: NotificationRow
): RecordRow {
  return record(def, row.id, {
    recipient_kind: row.recipient_kind,
    recipient_id: row.recipient_id,
    recipient_tenant_id: row.recipient_tenant_id,
    category: row.category,
    title: row.title,
    body: row.body,
    link: row.link,
    resource_kind: row.resource_kind,
    resource_id: row.resource_id,
    read_at: row.read_at,
    created_at: row.created_at,
  });
}

function notifications(
  db: AppDatabase,
  query: RecordQuery,
  ctx: OperationContext
): NotificationRow[] {
  const owner = recipient(ctx);
  const opts = {
    unreadOnly: query.filters?.unread === true,
    limit: 200,
  };
  return owner.kind === "user"
    ? listNotificationsForUser(owner.id, opts, coreDb(db, ctx))
    : listNotificationsForAgent(
        owner.id,
        ctx.tenantId ?? null,
        opts,
        coreDb(db, ctx)
      );
}

function notification(
  db: AppDatabase,
  id: string,
  ctx: OperationContext
): NotificationRow | undefined {
  const owner = recipient(ctx);
  const tenantGuard =
    owner.kind === "agent" && ctx.tenantId
      ? `AND (recipient_tenant_id = ? OR recipient_tenant_id IS NULL)`
      : "";
  const params =
    owner.kind === "agent" && ctx.tenantId
      ? [id, owner.kind, owner.id, ctx.tenantId]
      : [id, owner.kind, owner.id];
  return coreDb(db, ctx)
    .prepare(
      `SELECT * FROM notifications
       WHERE id = ? AND recipient_kind = ? AND recipient_id = ? ${tenantGuard}`
    )
    .get(...params) as NotificationRow | undefined;
}

export const notificationServiceAdapter: RecordAdapter = {
  id: "notification_service",
  list(db, def, query, ctx) {
    const rows = notifications(db, query, ctx);
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => notificationRecord(def, row)),
      total: rows.length,
    };
  },
  get(db, def, id, ctx) {
    const row = notification(db, id, ctx);
    return row ? notificationRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    const owner = recipient(ctx);
    return notificationRecord(
      def,
      createNotification(
        {
          recipientKind: owner.kind,
          recipientId: owner.id,
          recipientTenantId:
            owner.kind === "agent" ? ctx.tenantId ?? null : ctx.tenantId ?? null,
          category:
            typeof data.category === "string" ? data.category : undefined,
          title: requiredText(data, "title"),
          body: data.body as string | null | undefined,
          link: data.link as string | null | undefined,
          resourceKind: data.resource_kind as string | null | undefined,
          resourceId: data.resource_id as string | null | undefined,
        },
        coreDb(db, ctx)
      )
    );
  },
  delete(db, _def, id, ctx) {
    if (
      !deleteNotification(id, recipient(ctx), coreDb(db, ctx))
    ) {
      notFound("Notification");
    }
  },
  actions: {
    mark_read(db, def, id, _input, ctx) {
      if (!notification(db, id, ctx)) notFound("Notification");
      markRead([id], coreDb(db, ctx));
      return notificationRecord(def, notification(db, id, ctx)!);
    },
    mark_all_read(db, _def, _id, _input, ctx) {
      return {
        changed: markAllRead(recipient(ctx), coreDb(db, ctx)),
      };
    },
    clear(db, _def, _id, input, ctx) {
      return {
        deleted: clearNotifications(
          recipient(ctx),
          { readOnly: input.read_only !== false },
          coreDb(db, ctx)
        ),
      };
    },
  },
};
