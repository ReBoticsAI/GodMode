import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../../db.js";
import { getCoreDb } from "../../core-db.js";
import {
  resolveToolConfirmation,
  type AgentMessage,
  type AgentSampling,
} from "../../services/ai-agent.js";
import {
  AiDatasetBuilder,
  type DatasetExample,
  type DatasetSource,
} from "../../services/ai-dataset-builder.js";
import type { AiQueueWorker, EnqueueInput } from "../../services/ai-queue-worker.js";
import { AUTONOMOUS_RUNNER_ID } from "../../services/ai-queue-worker.js";
import type {
  AiTrainingManager,
  TrainingJobConfig,
} from "../../services/ai-training-manager.js";
import {
  listModelCatalog,
  selectIntelligenceModel,
} from "../../services/model-catalog.js";
import { runRemoteInference } from "../../services/inference-service.js";
import type { LlmManager } from "../../services/llm-manager.js";
import {
  createAdapter,
  deleteAdapter,
  getAdapter,
  listAdapters,
  updateAdapter,
  type AiAdapter,
} from "../../services/ai-adapters.js";
import {
  createSecret,
  deleteSecret,
  listSecrets,
} from "../../services/agents/agents-db.js";
import {
  createAgentApiKeyAccount,
  getAgentAccount,
  listAgentAccounts,
  revokeAgentAccount,
  type AgentAccount,
} from "../../services/agents/agent-accounts.js";
import {
  countCapabilityIndex,
  rebuildAllAgentCapabilityIndexes,
} from "../../services/capability-index.js";
import type { EmbeddingManager } from "../../services/embeddings/embedding-manager.js";
import type { MemoryMaintenanceService } from "../../services/memory-maintenance.js";
import {
  assemblePrompt,
  loadPromptFlowConfig,
  savePromptFlowConfig,
  type PromptFlowConfig,
} from "../../services/prompt-assembler.js";
import { getAgent } from "../../services/agents/agents-db.js";
import {
  CURSOR_API_KEY_SECRET_ID,
  getCursorAuthStatus,
  removeCursorApiKey,
  upsertCursorApiKey,
} from "../../services/cursor-subscription.js";
import type {
  OperationContext,
  RecordAdapter,
  RecordQuery,
} from "../adapter-registry.js";

type IntegrationKind = "calendar" | "email";

export interface RuntimeAdapterServices {
  llm: Pick<
    LlmManager,
    | "getStatus"
    | "getSamplingParams"
    | "scanModels"
    | "start"
    | "stop"
    | "restart"
    | "isReady"
    | "getServerBaseUrl"
    | "getEnabledAdapterPaths"
    | "getSettings"
    | "updateSettings"
  >;
  queue: Pick<AiQueueWorker, "enqueue" | "hasPendingOrRunningWorkflow">;
  training: Pick<AiTrainingManager, "listJobs" | "getJob" | "startJob" | "cancelJob">;
  embeddings: Pick<
    EmbeddingManager,
    | "getStatus"
    | "start"
    | "stop"
    | "setEnabled"
    | "getEmbeddingClient"
  >;
  memoryMaintenance: Pick<
    MemoryMaintenanceService,
    "enqueueDistill" | "enqueueWikiSynthesize"
  >;
  /** Must enqueue through the configured provider connector/scheduler. */
  syncIntegration(input: {
    db: AppDatabase;
    kind: IntegrationKind;
    context: OperationContext;
  }): Promise<unknown>;
  /**
   * Promote an owned chat through the same share/access service used by the
   * protocol route.
   */
  shareChat(input: {
    db: AppDatabase;
    chatId: string;
    agentId: string;
    context: OperationContext;
  }): Promise<unknown> | unknown;
}

let services: RuntimeAdapterServices | undefined;

export const REQUIRED_RUNTIME_ADAPTER_SERVICE_KEYS = [
  "llm",
  "queue",
  "training",
  "embeddings",
  "memoryMaintenance",
  "syncIntegration",
  "shareChat",
] as const satisfies ReadonlyArray<keyof RuntimeAdapterServices>;

/** Wire the already-running Bridge singletons; do not construct parallel managers. */
export function configureRuntimeAdapterServices(next: RuntimeAdapterServices): void {
  for (const key of REQUIRED_RUNTIME_ADAPTER_SERVICE_KEYS) {
    if (!next[key]) {
      throw new Error(`Runtime adapter service "${key}" is required`);
    }
  }
  services = next;
}

/** Test/shutdown helper. */
export function clearRuntimeAdapterServices(): void {
  services = undefined;
}

export function assertRuntimeAdapterServicesConfigured(): RuntimeAdapterServices {
  if (!services) {
    throw new Error("Runtime ObjectType services are not configured");
  }
  for (const key of REQUIRED_RUNTIME_ADAPTER_SERVICE_KEYS) {
    if (!services[key]) {
      throw new Error(`Runtime adapter service "${key}" is required`);
    }
  }
  return services;
}

function runtime(): RuntimeAdapterServices {
  return assertRuntimeAdapterServicesConfigured();
}

/** Reuse the boot-injected LLM singleton for non-runtime domain adapters. */
export function runConfiguredRemoteInference(input: {
  core: AppDatabase;
  endpointId: string;
  buyerUserId: string;
  buyerTenantId: string;
  messages: AgentMessage[];
  sampling?: Partial<AgentSampling>;
  priority?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const active = runtime();
  return runRemoteInference(input.core, active.llm as LlmManager, {
    endpointId: input.endpointId,
    buyerUserId: input.buyerUserId,
    buyerTenantId: input.buyerTenantId,
    messages: input.messages,
    sampling: {
      ...active.llm.getSamplingParams(),
      ...(input.sampling ?? {}),
    } as AgentSampling,
    priority: input.priority,
  });
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function requiredText(data: RecordData, name: string): string {
  const value = data[name];
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${name} required`);
  }
  return value.trim();
}

function requiredUser(ctx: OperationContext): string {
  if (!ctx.userId) throw httpError(401, "Authenticated user required");
  return ctx.userId;
}

function ownerOnly(ctx: OperationContext): void {
  requiredUser(ctx);
  if (ctx.role !== "owner") throw httpError(403, "Owner role required");
}

function runtimeOperator(ctx: OperationContext): void {
  requiredUser(ctx);
  if (ctx.role !== "owner" && ctx.role !== "intelligence") {
    throw httpError(403, "Runtime operator role required");
  }
}

function record(def: ObjectTypeDef, id: string, data: RecordData): RecordRow {
  return { id, objectType: def.name, data: { id, ...data } };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function page<T>(rows: T[], query: RecordQuery): { rows: T[]; total: number } {
  const offset = Math.max(Number(query.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

function chatRow(
  db: AppDatabase,
  id: string,
  userId: string
): Record<string, unknown> | undefined {
  return db
    .prepare(
      `SELECT id, title, user_id, created_at, updated_at
       FROM ai_chats
       WHERE id = ? AND (user_id IS NULL OR user_id = ?)`
    )
    .get(id, userId) as Record<string, unknown> | undefined;
}

function requireChat(db: AppDatabase, id: string, ctx: OperationContext) {
  const row = chatRow(db, id, requiredUser(ctx));
  if (!row) throw httpError(404, "Chat session not found");
  return row;
}

export const CHAT_SESSION_ACTIONS: ActionDef[] = [
  {
    name: "share",
    label: "Share session",
    description: "Promote an owned chat through the configured sharing service.",
    target: "record",
    effect: "external",
    execution: "async",
    cancellable: false,
    roles: ["editor", "owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent_id: { type: "string", minLength: 1 },
      },
    },
    idempotency: { required: true, ttlSeconds: 300 },
  },
  {
    name: "confirm_tool",
    label: "Confirm tool",
    description: "Resolve a pending tool confirmation for this authenticated chat actor.",
    target: "record",
    effect: "write",
    execution: "sync",
    roles: ["editor", "owner"],
    confirmation: { required: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["tool_call_id", "approved"],
      properties: {
        tool_call_id: { type: "string", minLength: 1 },
        approved: { type: "boolean" },
      },
    },
  },
  {
    name: "truncate",
    label: "Truncate history",
    description: "Delete chat messages after the selected anchor message.",
    target: "record",
    effect: "destructive",
    execution: "sync",
    roles: ["editor", "owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["after_message_id"],
      properties: {
        after_message_id: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "distill",
    label: "Distill memory",
    description: "Enqueue episodic memory distillation for this chat.",
    target: "record",
    effect: "external",
    execution: "sync",
    roles: ["owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent_id: { type: "string", minLength: 1 },
        force: { type: "boolean" },
      },
    },
    idempotency: { required: true, ttlSeconds: 300 },
  },
];

export const chatSessionRuntimeAdapter: RecordAdapter = {
  id: "chat_session_runtime",
  policy: {
    authorize(_operation, _def, ctx) {
      requiredUser(ctx);
    },
  },
  list(db, def, query, ctx) {
    const userId = requiredUser(ctx);
    const rows = db
      .prepare(
        `SELECT id, title, user_id, created_at, updated_at
         FROM ai_chats
         WHERE user_id IS NULL OR user_id = ?
         ORDER BY updated_at DESC`
      )
      .all(userId) as Array<Record<string, unknown>>;
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) =>
        record(def, String(row.id), {
          title: row.title,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
      ),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    const row = chatRow(db, id, requiredUser(ctx));
    return row
      ? record(def, id, {
          title: row.title,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
      : null;
  },
  create(db, def, data, ctx) {
    const id = uuidv4();
    const title =
      typeof data.title === "string" && data.title.trim()
        ? data.title.trim().slice(0, 120)
        : "New chat";
    db.prepare(
      `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`
    ).run(id, title, requiredUser(ctx));
    const row = db
      .prepare(`SELECT created_at, updated_at FROM ai_chats WHERE id = ?`)
      .get(id) as { created_at: string; updated_at: string };
    return record(def, id, {
      title,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  },
  delete(db, _def, id, ctx) {
    requireChat(db, id, ctx);
    db.transaction(() => {
      db.prepare(`DELETE FROM ai_messages WHERE chat_id = ?`).run(id);
      const result = db
        .prepare(
          `DELETE FROM ai_chats
           WHERE id = ? AND (user_id IS NULL OR user_id = ?)`
        )
        .run(id, requiredUser(ctx));
      if (!result.changes) throw httpError(404, "Chat session not found");
    })();
  },
  actions: {
    async share(db, _def, id, input, ctx) {
      requireChat(db, id, ctx);
      const shareChat = runtime().shareChat;
      return shareChat({
        db,
        chatId: id,
        agentId:
          typeof input.agent_id === "string" && input.agent_id.trim()
            ? input.agent_id.trim()
            : ctx.agentId ?? "intelligence",
        context: ctx,
      });
    },
    confirm_tool(db, _def, id, input, ctx) {
      requireChat(db, id, ctx);
      return {
        ok: resolveToolConfirmation(
          requiredText(input, "tool_call_id"),
          input.approved === true
        ),
      };
    },
    truncate(db, _def, id, input, ctx) {
      requireChat(db, id, ctx);
      const anchorId = requiredText(input, "after_message_id");
      const anchor = db
        .prepare(
          `SELECT created_at FROM ai_messages WHERE id = ? AND chat_id = ?`
        )
        .get(anchorId, id) as { created_at: string } | undefined;
      if (!anchor) throw httpError(404, "Message not found");
      const deleted = db
        .prepare(`DELETE FROM ai_messages WHERE chat_id = ? AND created_at > ?`)
        .run(id, anchor.created_at).changes;
      return { ok: true, deleted };
    },
    distill(db, _def, id, input, ctx) {
      requireChat(db, id, ctx);
      const maintenance = runtime().memoryMaintenance;
      return {
        ok: true,
        jobId: maintenance.enqueueDistill({
          chatId: id,
          agentId:
            typeof input.agent_id === "string"
              ? input.agent_id
              : ctx.agentId ?? "intelligence",
          tenantId: ctx.tenantId,
          force: input.force === true,
        }),
      };
    },
  },
};

export const chatMessageRuntimeAdapter: RecordAdapter = {
  id: "chat_message_runtime",
  policy: {
    authorize(_operation, _def, ctx) {
      requiredUser(ctx);
    },
  },
  list(db, def, query, ctx) {
    const userId = requiredUser(ctx);
    const chatId =
      typeof query.filters?.chat_id === "string"
        ? query.filters.chat_id
        : query.parentId;
    const rows = db
      .prepare(
        `SELECT m.id, m.chat_id, m.role, m.content_json, m.created_at
         FROM ai_messages m
         JOIN ai_chats c ON c.id = m.chat_id
         WHERE (c.user_id IS NULL OR c.user_id = ?)
           AND (? IS NULL OR m.chat_id = ?)
         ORDER BY m.created_at ASC`
      )
      .all(userId, chatId ?? null, chatId ?? null) as Array<Record<string, unknown>>;
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) =>
        record(def, String(row.id), {
          chat_id: row.chat_id,
          role: row.role,
          content: parseJson(row.content_json),
          created_at: row.created_at,
        })
      ),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    const row = db
      .prepare(
        `SELECT m.id, m.chat_id, m.role, m.content_json, m.created_at
         FROM ai_messages m
         JOIN ai_chats c ON c.id = m.chat_id
         WHERE m.id = ? AND (c.user_id IS NULL OR c.user_id = ?)`
      )
      .get(id, requiredUser(ctx)) as Record<string, unknown> | undefined;
    return row
      ? record(def, id, {
          chat_id: row.chat_id,
          role: row.role,
          content: parseJson(row.content_json),
          created_at: row.created_at,
        })
      : null;
  },
  create(db, def, data, ctx) {
    const chatId = requiredText(data, "chat_id");
    requireChat(db, chatId, ctx);
    const role = requiredText(data, "role");
    if (role !== "user" && role !== "assistant") {
      throw httpError(400, "Chat message role must be user or assistant");
    }
    const id = uuidv4();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO ai_messages (id, chat_id, role, content_json, user_id)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        id,
        chatId,
        role,
        JSON.stringify(data.content ?? {}),
        role === "user" ? requiredUser(ctx) : null
      );
      db.prepare(
        `UPDATE ai_chats SET updated_at=datetime('now') WHERE id=?`
      ).run(chatId);
    })();
    return chatMessageRuntimeAdapter.get!(db, def, id, ctx)!;
  },
  delete(db, _def, id, ctx) {
    const result = db
      .prepare(
        `DELETE FROM ai_messages
         WHERE id = ? AND chat_id IN (
           SELECT id FROM ai_chats WHERE user_id IS NULL OR user_id = ?
         )`
      )
      .run(id, requiredUser(ctx));
    if (!result.changes) throw httpError(404, "Chat message not found");
  },
};

function modelAdapterRecord(def: ObjectTypeDef, row: AiAdapter): RecordRow {
  return record(def, row.id, {
    name: row.name,
    path: row.path,
    description: row.description,
    domain: row.domain,
    enabled: Boolean(row.enabled),
    default_scale: row.default_scale,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const modelAdapterRuntimeAdapter: RecordAdapter = {
  id: "model_adapter_runtime",
  list(db, def, query) {
    const result = page(listAdapters(db), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => modelAdapterRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id) {
    const row = getAdapter(db, id);
    return row ? modelAdapterRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    ownerOnly(ctx);
    return modelAdapterRecord(
      def,
      createAdapter(db, {
        name: requiredText(data, "name"),
        path: requiredText(data, "path"),
        description:
          data.description == null ? null : String(data.description),
        domain: data.domain == null ? null : String(data.domain),
        enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
        defaultScale:
          typeof data.default_scale === "number" ? data.default_scale : undefined,
      })
    );
  },
  update(db, def, id, data, ctx) {
    ownerOnly(ctx);
    const row = updateAdapter(db, id, {
      name: typeof data.name === "string" ? data.name : undefined,
      description:
        data.description === undefined ? undefined : (data.description as string | null),
      domain: data.domain === undefined ? undefined : (data.domain as string | null),
      enabled: data.enabled === undefined ? undefined : Boolean(data.enabled),
      defaultScale:
        typeof data.default_scale === "number" ? data.default_scale : undefined,
    });
    if (!row) throw httpError(404, "Model adapter not found");
    return modelAdapterRecord(def, row);
  },
  delete(db, _def, id, ctx) {
    ownerOnly(ctx);
    if (!deleteAdapter(db, id)) throw httpError(404, "Model adapter not found");
  },
};

export const EMBEDDING_RUNTIME_ACTIONS: ActionDef[] = [
  ...(["start", "stop"] as const).map(
    (name): ActionDef => ({
      name,
      label: `${name === "start" ? "Start" : "Stop"} embeddings`,
      target: "record",
      effect: name === "stop" ? "destructive" : "external",
      execution: "async",
      cancellable: false,
      roles: ["owner"],
      confirmation: { required: true, ttlSeconds: 300 },
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    })
  ),
  {
    name: "set_enabled",
    label: "Set embedding engine enabled",
    target: "record",
    effect: "external",
    execution: "async",
    cancellable: false,
    roles: ["owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["enabled"],
      properties: { enabled: { type: "boolean" } },
    },
  },
];

function embeddingStatus(def: ObjectTypeDef): RecordRow {
  const embeddings = runtime().embeddings;
  const status = embeddings.getStatus();
  return record(def, "runtime", {
    enabled: status.enabled,
    enabled_override: status.enabledOverride,
    state: status.embedder.state,
    health_ok: status.embedder.healthOk,
    pid: status.embedder.pid,
    port: status.embedder.port,
    error: status.embedder.error,
  });
}

export const embeddingRuntimeAdapter: RecordAdapter = {
  id: "embedding_runtime",
  list(_db, def, query) {
    const result = page([embeddingStatus(def)], query);
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(_db, def, id) {
    return id === "runtime" ? embeddingStatus(def) : null;
  },
  actions: {
    start() {
      const embeddings = runtime().embeddings;
      return embeddings.start();
    },
    stop() {
      const embeddings = runtime().embeddings;
      return embeddings.stop();
    },
    set_enabled(_db, _def, _id, input) {
      const embeddings = runtime().embeddings;
      return embeddings.setEnabled(input.enabled === true);
    },
  },
};

export const CAPABILITY_INDEX_ACTIONS: ActionDef[] = [
  {
    name: "rebuild",
    label: "Rebuild capability index",
    target: "record",
    effect: "external",
    execution: "async",
    cancellable: true,
    roles: ["owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];

function capabilityIndexRecord(
  db: AppDatabase,
  def: ObjectTypeDef
): RecordRow {
  return record(def, "default", { index_rows: countCapabilityIndex(db) });
}

export const capabilityIndexRuntimeAdapter: RecordAdapter = {
  id: "capability_index_runtime",
  list(db, def, query) {
    const result = page([capabilityIndexRecord(db, def)], query);
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(db, def, id) {
    return id === "default" ? capabilityIndexRecord(db, def) : null;
  },
  actions: {
    async rebuild(db, _def, _id, _input, ctx) {
      runtimeOperator(ctx);
      const embeddings = runtime().embeddings;
      const count = await rebuildAllAgentCapabilityIndexes(
        db,
        embeddings?.getEmbeddingClient()
      );
      return { ok: true, count, indexRows: countCapabilityIndex(db) };
    },
  },
};

const SETTINGS_FIELD_MAP = {
  active_model_path: "activeModelPath",
  ctx_size: "ctxSize",
  gpu_layers: "gpuLayers",
  flash_attn: "flashAttn",
  batch_size: "batchSize",
  ubatch_size: "ubatchSize",
  extra_args: "extraArgs",
  auto_start: "autoStart",
  top_p: "topP",
  top_k: "topK",
  min_p: "minP",
  repeat_penalty: "repeatPenalty",
  presence_penalty: "presencePenalty",
  frequency_penalty: "frequencyPenalty",
  max_tokens: "maxTokens",
  system_prompt: "systemPrompt",
  enable_thinking: "enableThinking",
  thinking_efficiency: "thinkingEfficiency",
  native_tools: "nativeTools",
  memory_mode: "memoryMode",
} as const;

function projectSettings(settings: Record<string, unknown>): RecordData {
  const projected = { ...settings } as Record<string, unknown>;
  for (const [external, internal] of Object.entries(SETTINGS_FIELD_MAP)) {
    projected[external] = settings[internal];
    delete projected[internal];
  }
  return projected;
}

function internalSettings(data: RecordData): RecordData {
  const projected = { ...data };
  for (const [external, internal] of Object.entries(SETTINGS_FIELD_MAP)) {
    if (external in data) projected[internal] = data[external];
    delete projected[external];
  }
  return projected;
}

function settingsRecord(
  db: AppDatabase,
  def: ObjectTypeDef,
  settings = runtime().llm.getSettings(db)
): RecordRow {
  return record(
    def,
    "default",
    projectSettings(settings as unknown as Record<string, unknown>)
  );
}

export const intelligenceSettingsRuntimeAdapter: RecordAdapter = {
  id: "intelligence_settings_runtime",
  list(db, def, query) {
    const result = page([settingsRecord(db, def)], query);
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(db, def, id) {
    return id === "default" ? settingsRecord(db, def) : null;
  },
  update(db, def, id, data, ctx) {
    ownerOnly(ctx);
    if (id !== "default") throw httpError(404, "Intelligence settings not found");
    return settingsRecord(
      db,
      def,
      runtime().llm.updateSettings(internalSettings(data), db)
    );
  },
};

function promptFlowRecord(
  db: AppDatabase,
  def: ObjectTypeDef,
  agentId: string,
  flowConfig = loadPromptFlowConfig(db)
): RecordRow {
  const settings = runtime().llm.getSettings(db);
  const agent = getAgent(db, agentId);
  const assembled = assemblePrompt(db, {
    basePrompt: agent?.systemPrompt ?? settings.systemPrompt,
    flowConfig,
    enableThinking: agent?.thinking.enableThinking ?? settings.enableThinking,
    thinkingEfficiency:
      agent?.thinking.thinkingEfficiency ?? settings.thinkingEfficiency,
    nativeTools: agent?.thinking.nativeTools ?? settings.nativeTools,
    agentId,
  });
  return record(def, "default", {
    agent_id: agentId,
    config: flowConfig,
    assembled,
  });
}

export const promptFlowRuntimeAdapter: RecordAdapter = {
  id: "prompt_flow_runtime",
  list(db, def, query, ctx) {
    const result = page(
      [promptFlowRecord(db, def, ctx.agentId ?? "intelligence")],
      query
    );
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(db, def, id, ctx) {
    return id === "default"
      ? promptFlowRecord(db, def, ctx.agentId ?? "intelligence")
      : null;
  },
  update(db, def, id, data, ctx) {
    ownerOnly(ctx);
    if (id !== "default") throw httpError(404, "Prompt flow not found");
    const flowConfig = (data.config ?? data) as unknown as PromptFlowConfig;
    if (!Array.isArray(flowConfig.sections) || flowConfig.sections.length === 0) {
      throw httpError(400, "Invalid prompt flow config");
    }
    savePromptFlowConfig(db, flowConfig);
    return promptFlowRecord(
      db,
      def,
      typeof data.agent_id === "string"
        ? data.agent_id
        : ctx.agentId ?? "intelligence",
      flowConfig
    );
  },
};

function vaultSecretRecord(
  def: ObjectTypeDef,
  row: ReturnType<typeof listSecrets>[number]
): RecordRow {
  return record(def, row.id, {
    name: row.name,
    masked: row.masked,
    created_at: row.createdAt,
  });
}

export const vaultSecretRuntimeAdapter: RecordAdapter = {
  id: "vault_secret_runtime",
  list(db, def, query, ctx) {
    ownerOnly(ctx);
    const rows = listSecrets(db).filter(
      (secret) =>
        secret.id !== "cursor-api-key" &&
        secret.name.toLowerCase() !== "cursor_api_key" &&
        secret.name.toLowerCase() !== "cursor-api-key"
    );
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => vaultSecretRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    ownerOnly(ctx);
    const row = listSecrets(db).find(
      (secret) =>
        secret.id === id &&
        secret.id !== "cursor-api-key" &&
        secret.name.toLowerCase() !== "cursor_api_key" &&
        secret.name.toLowerCase() !== "cursor-api-key"
    );
    return row ? vaultSecretRecord(def, row) : null;
  },
  create(db, def, data, ctx) {
    ownerOnly(ctx);
    const name = requiredText(data, "name");
    if (
      name.toLowerCase() === "cursor_api_key" ||
      name.toLowerCase() === "cursor-api-key"
    ) {
      throw httpError(400, "Cursor API keys must use the Cursor credential flow");
    }
    const created = createSecret(db, name, requiredText(data, "value"));
    const row = listSecrets(db).find((secret) => secret.id === created.id);
    if (!row) throw httpError(500, "Created Vault secret could not be loaded");
    return vaultSecretRecord(def, row);
  },
  delete(db, _def, id, ctx) {
    ownerOnly(ctx);
    if (!deleteSecret(db, id)) throw httpError(404, "Vault secret not found");
  },
};

function providerCredentialRecord(
  def: ObjectTypeDef,
  account: AgentAccount
): RecordRow {
  return record(def, account.id, {
    agent_id: account.agentId,
    kind: account.kind,
    provider: account.provider,
    display_name: account.displayName,
    email: account.email,
    scopes: account.scopes,
    status: account.status,
    masked_token: account.maskedToken,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  });
}

export const providerCredentialRuntimeAdapter: RecordAdapter = {
  id: "provider_credential_runtime",
  list(db, def, query, ctx) {
    ownerOnly(ctx);
    const agentId =
      typeof query.filters?.agent_id === "string"
        ? query.filters.agent_id
        : ctx.agentId ?? "intelligence";
    const result = page(listAgentAccounts(db, agentId), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => providerCredentialRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id, ctx) {
    ownerOnly(ctx);
    if (id === CURSOR_API_KEY_SECRET_ID) {
      const status = getCursorAuthStatus(db);
      return status.connected
        ? record(def, CURSOR_API_KEY_SECRET_ID, {
            agent_id: "intelligence",
            kind: "api_key",
            provider: "cursor",
            display_name: "Cursor subscription",
            status: "active",
            masked_token: status.masked ?? "****",
          })
        : null;
    }
    const account = getAgentAccount(db, id);
    return account ? providerCredentialRecord(def, account) : null;
  },
  create(db, def, data, ctx) {
    ownerOnly(ctx);
    if (requiredText(data, "provider").toLowerCase() === "cursor") {
      upsertCursorApiKey(db, requiredText(data, "api_key"));
      const status = getCursorAuthStatus(db);
      return record(def, CURSOR_API_KEY_SECRET_ID, {
        agent_id: "intelligence",
        kind: "api_key",
        provider: "cursor",
        display_name: "Cursor subscription",
        status: "active",
        masked_token: status.masked ?? "****",
      });
    }
    return providerCredentialRecord(
      def,
      createAgentApiKeyAccount(db, {
        agentId:
          typeof data.agent_id === "string"
            ? data.agent_id
            : ctx.agentId ?? "intelligence",
        provider: requiredText(data, "provider"),
        label: typeof data.label === "string" ? data.label : undefined,
        apiKey: requiredText(data, "api_key"),
      })
    );
  },
  delete(db, _def, id, ctx) {
    ownerOnly(ctx);
    if (id === CURSOR_API_KEY_SECRET_ID) {
      removeCursorApiKey(db);
      return;
    }
    const account = getAgentAccount(db, id);
    if (!account) throw httpError(404, "Provider credential not found");
    if (!revokeAgentAccount(db, id, account.agentId)) {
      throw httpError(404, "Provider credential not found");
    }
  },
};

function safeModelStatus(status: ReturnType<LlmManager["getStatus"]>): RecordData {
  return {
    state: status.state,
    health_ok: status.healthOk,
    pid: status.pid,
    port: status.port,
    ctx_size: status.ctxSize,
    error: status.error,
  };
}

export const MODEL_RUNTIME_ACTIONS: ActionDef[] = [
  {
    name: "select_model",
    label: "Select model",
    description: "Select a model already present in the authorized model catalog.",
    target: "record",
    effect: "external",
    execution: "async",
    roles: ["owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["model_id"],
      properties: { model_id: { type: "string", minLength: 1 } },
    },
    timeoutMs: 180_000,
    cancellable: false,
  },
  ...(["start", "stop", "restart"] as const).map(
    (name): ActionDef => ({
      name,
      label: `${name[0]!.toUpperCase()}${name.slice(1)} model runtime`,
      description: `${name} the configured local model process.`,
      target: "record",
      effect: name === "stop" ? "destructive" : "external",
      execution: "async",
      roles: ["owner"],
      confirmation: { required: true, ttlSeconds: 300 },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      timeoutMs: 180_000,
      cancellable: false,
    })
  ),
];

export const modelRuntimeAdapter: RecordAdapter = {
  id: "model_runtime",
  policy: {
    authorize(operation, _def, ctx) {
      if (operation === "action") ownerOnly(ctx);
      else requiredUser(ctx);
    },
  },
  list(_db, def, query) {
    const rows = [record(def, "runtime", safeModelStatus(runtime().llm.getStatus()))];
    const result = page(rows, query);
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(_db, def, id) {
    return id === "runtime"
      ? record(def, id, safeModelStatus(runtime().llm.getStatus()))
      : null;
  },
  actions: {
    async select_model(db, _def, _id, input, ctx) {
      ownerOnly(ctx);
      const active = runtime();
      const modelId = requiredText(input, "model_id");
      const catalog = await listModelCatalog(
        db,
        active.llm as LlmManager,
        getCoreDb(),
        requiredUser(ctx)
      );
      const selected = catalog.models.find((model) => model.id === modelId);
      if (!selected) throw httpError(404, "Model is not in the authorized catalog");
      return selectIntelligenceModel(db, active.llm as LlmManager, {
        source: selected.source,
        path: selected.path,
        model: selected.model,
        provider: selected.provider,
        endpointId: selected.endpointId,
      });
    },
    start(_db, _def, _id, _input, ctx) {
      ownerOnly(ctx);
      return runtime().llm.start();
    },
    stop(_db, _def, _id, _input, ctx) {
      ownerOnly(ctx);
      return runtime().llm.stop();
    },
    restart(_db, _def, _id, _input, ctx) {
      ownerOnly(ctx);
      return runtime().llm.restart();
    },
  },
};

export const PROMPT_QUEUE_ACTIONS: ActionDef[] = [
  {
    name: "enqueue",
    label: "Enqueue prompt",
    description: "Submit work through the live durable prompt queue.",
    target: "collection",
    effect: "external",
    execution: "sync",
    roles: ["owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", minLength: 1 },
        workflow_id: { type: "string", minLength: 1 },
        adapter_ids: { type: "array", items: { type: "string", minLength: 1 } },
        context: { type: "object" },
        priority: { type: "integer", minimum: -100, maximum: 100 },
      },
      anyOf: [{ required: ["prompt"] }, { required: ["workflow_id"] }],
    },
    idempotency: { required: true, ttlSeconds: 86_400 },
  },
  {
    name: "cancel",
    label: "Cancel queued prompt",
    target: "record",
    effect: "destructive",
    execution: "sync",
    roles: ["owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
];

function queueRecord(def: ObjectTypeDef, row: Record<string, unknown>): RecordRow {
  return record(def, String(row.id), {
    status: row.status,
    priority: row.priority,
    workflow_id: row.workflow_id,
    prompt: row.prompt,
    error: row.error,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  });
}

export const promptQueueRuntimeAdapter: RecordAdapter = {
  id: "prompt_queue_runtime",
  policy: {
    authorize(_operation, _def, ctx) {
      runtimeOperator(ctx);
    },
  },
  list(db, def, query) {
    const rows = db
      .prepare(
        `SELECT id, status, priority, workflow_id, prompt, error,
                created_at, started_at, finished_at
         FROM ai_prompt_queue
         ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                  priority DESC, created_at ASC`
      )
      .all() as Array<Record<string, unknown>>;
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => queueRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id) {
    const row = db
      .prepare(
        `SELECT id, status, priority, workflow_id, prompt, error,
                created_at, started_at, finished_at
         FROM ai_prompt_queue WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? queueRecord(def, row) : null;
  },
  actions: {
    enqueue(_db, _def, _id, input, ctx) {
      runtimeOperator(ctx);
      const enqueueInput: EnqueueInput = {
        prompt: typeof input.prompt === "string" ? input.prompt : undefined,
        workflowId:
          typeof input.workflow_id === "string" ? input.workflow_id : undefined,
        adapterIds: Array.isArray(input.adapter_ids)
          ? input.adapter_ids.filter(
              (value): value is string => typeof value === "string"
            )
          : undefined,
        context:
          input.context && typeof input.context === "object"
            ? (input.context as Record<string, unknown>)
            : undefined,
        priority:
          typeof input.priority === "number" ? input.priority : undefined,
        tenantId: ctx.tenantId,
      };
      return { ok: true, jobId: runtime().queue.enqueue(enqueueInput) };
    },
    cancel(db, _def, id, _input, ctx) {
      runtimeOperator(ctx);
      const current = db
        .prepare(`SELECT status FROM ai_prompt_queue WHERE id = ?`)
        .get(id) as { status: string } | undefined;
      if (!current) throw httpError(404, "Prompt queue job not found");
      const changed = db
        .prepare(
          `UPDATE ai_prompt_queue
           SET status = 'cancelled', finished_at = datetime('now')
           WHERE id = ? AND status IN ('pending', 'running')`
        )
        .run(id).changes;
      if (!changed) throw httpError(409, `Job cannot be cancelled (status=${current.status})`);
      return { ok: true };
    },
  },
};

export const DATASET_ACTIONS: ActionDef[] = [
  {
    name: "build_dataset",
    label: "Build dataset",
    description: "Build a managed dataset from authorized platform records.",
    target: "collection",
    effect: "write",
    execution: "sync",
    roles: ["owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "source"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        domain: { type: "string", maxLength: 120 },
        source: {
          type: "string",
          enum: ["chats", "workflows", "queue", "comments"],
        },
        chat_ids: { type: "array", items: { type: "string", minLength: 1 } },
        limit: { type: "integer", minimum: 1, maximum: 100_000 },
      },
    },
    idempotency: { required: true, ttlSeconds: 86_400 },
  },
  {
    name: "import_dataset",
    label: "Import dataset",
    description: "Validate examples and import them into managed JSONL storage.",
    target: "collection",
    effect: "write",
    execution: "sync",
    roles: ["owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "examples"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        domain: { type: "string", maxLength: 120 },
        examples: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["messages"],
            properties: {
              messages: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  required: ["role", "content"],
                  properties: {
                    role: { type: "string", minLength: 1 },
                    content: { type: "string", minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
      },
    },
    idempotency: { required: true, ttlSeconds: 86_400 },
  },
];

function datasetRecord(def: ObjectTypeDef, row: Record<string, unknown>): RecordRow {
  return record(def, String(row.id), {
    name: row.name,
    domain: row.domain,
    row_count: row.row_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const datasetRuntimeAdapter: RecordAdapter = {
  id: "dataset_runtime",
  policy: {
    authorize(operation, _def, ctx) {
      if (operation === "action") ownerOnly(ctx);
      else requiredUser(ctx);
    },
  },
  list(db, def, query) {
    const rows = db
      .prepare(
        `SELECT id, name, domain, row_count, created_at, updated_at
         FROM ai_datasets ORDER BY updated_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => datasetRecord(def, row)),
      total: result.total,
    };
  },
  get(db, def, id) {
    const row = db
      .prepare(
        `SELECT id, name, domain, row_count, created_at, updated_at
         FROM ai_datasets WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? datasetRecord(def, row) : null;
  },
  actions: {
    build_dataset(db, def, _id, input, ctx) {
      ownerOnly(ctx);
      const row = new AiDatasetBuilder(db).buildDataset({
        name: requiredText(input, "name"),
        domain: typeof input.domain === "string" ? input.domain : undefined,
        source: requiredText(input, "source") as DatasetSource,
        chatIds: Array.isArray(input.chat_ids)
          ? input.chat_ids.filter(
              (value): value is string => typeof value === "string"
            )
          : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      });
      return datasetRecord(def, row as unknown as Record<string, unknown>);
    },
    import_dataset(db, def, _id, input, ctx) {
      ownerOnly(ctx);
      const row = new AiDatasetBuilder(db).importDataset({
        name: requiredText(input, "name"),
        domain: typeof input.domain === "string" ? input.domain : undefined,
        examples: input.examples as unknown as DatasetExample[],
      });
      return datasetRecord(def, row as unknown as Record<string, unknown>);
    },
  },
};

export const MEMORY_MAINTENANCE_ACTIONS: ActionDef[] = [
  {
    name: "wiki_synthesize",
    label: "Synthesize wiki memory",
    target: "collection",
    effect: "external",
    execution: "sync",
    roles: ["owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { agent_id: { type: "string", minLength: 1 } },
    },
    idempotency: { required: true, ttlSeconds: 300 },
  },
];

export const memoryMaintenanceRuntimeAdapter: RecordAdapter = {
  id: "memory_maintenance_runtime",
  policy: {
    authorize(_operation, _def, ctx) {
      runtimeOperator(ctx);
    },
  },
  actions: {
    wiki_synthesize(_db, _def, _id, input, ctx) {
      const maintenance = runtime().memoryMaintenance;
      return {
        ok: true,
        jobId: maintenance.enqueueWikiSynthesize(
          ctx.tenantId ?? "",
          typeof input.agent_id === "string"
            ? input.agent_id
            : ctx.agentId ?? "intelligence"
        ),
      };
    },
  },
};

export const AUTONOMOUS_RUNTIME_ACTIONS: ActionDef[] = [
  {
    name: "kick",
    label: "Kick autonomous runner",
    target: "collection",
    effect: "external",
    execution: "sync",
    roles: ["owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    idempotency: { required: true, ttlSeconds: 60 },
  },
];

export const autonomousRuntimeAdapter: RecordAdapter = {
  id: "autonomous_runtime",
  policy: {
    authorize(_operation, _def, ctx) {
      runtimeOperator(ctx);
    },
  },
  actions: {
    kick(_db, _def, _id, _input, ctx) {
      const queue = runtime().queue;
      if (queue.hasPendingOrRunningWorkflow(AUTONOMOUS_RUNNER_ID)) {
        return { ok: true, alreadyRunning: true };
      }
      return {
        ok: true,
        jobId: queue.enqueue({
          workflowId: AUTONOMOUS_RUNNER_ID,
          context: { autonomousTick: true, autoChainTick: 0 },
          priority: 1,
          tenantId: ctx.tenantId,
        }),
      };
    },
  },
};

export const TRAINING_JOB_ACTIONS: ActionDef[] = [
  {
    name: "enqueue",
    label: "Enqueue training",
    description: "Start a managed training job through the live trainer.",
    target: "collection",
    effect: "external",
    execution: "async",
    roles: ["owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["adapter_name", "dataset_id"],
      properties: {
        adapter_name: { type: "string", minLength: 1, maxLength: 120 },
        dataset_id: { type: "string", minLength: 1 },
        domain: { type: "string", maxLength: 120 },
        description: { type: "string", maxLength: 1000 },
        base_model: { type: "string", minLength: 1 },
        epochs: { type: "integer", minimum: 1, maximum: 100 },
        learning_rate: { type: "number", exclusiveMinimum: 0 },
        lora_rank: { type: "integer", minimum: 1, maximum: 1024 },
      },
    },
    idempotency: { required: true, ttlSeconds: 86_400 },
    timeoutMs: 30_000,
    cancellable: false,
  },
  {
    name: "cancel",
    label: "Cancel training",
    target: "record",
    effect: "destructive",
    execution: "sync",
    roles: ["owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
];

function trainingRecord(def: ObjectTypeDef, row: Record<string, unknown>): RecordRow {
  return record(def, String(row.id), {
    adapter_id: row.adapter_id,
    status: row.status,
    progress: row.progress,
    error: row.error,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  });
}

export const trainingJobRuntimeAdapter: RecordAdapter = {
  id: "training_job_runtime",
  policy: {
    authorize(operation, _def, ctx) {
      if (operation === "action") ownerOnly(ctx);
      else requiredUser(ctx);
    },
  },
  list(_db, def, query) {
    const result = page(runtime().training.listJobs(500), query);
    return {
      objectType: def.name,
      records: result.rows.map((row) =>
        trainingRecord(def, row as unknown as Record<string, unknown>)
      ),
      total: result.total,
    };
  },
  get(_db, def, id) {
    const row = runtime().training.getJob(id);
    return row
      ? trainingRecord(def, row as unknown as Record<string, unknown>)
      : null;
  },
  actions: {
    async enqueue(_db, _def, _id, input, ctx) {
      ownerOnly(ctx);
      const config: TrainingJobConfig = {
        adapterName: requiredText(input, "adapter_name"),
        datasetId: requiredText(input, "dataset_id"),
        domain: typeof input.domain === "string" ? input.domain : undefined,
        description:
          typeof input.description === "string" ? input.description : undefined,
        baseModel:
          typeof input.base_model === "string" ? input.base_model : undefined,
        epochs: typeof input.epochs === "number" ? input.epochs : undefined,
        learningRate:
          typeof input.learning_rate === "number"
            ? input.learning_rate
            : undefined,
        loraRank:
          typeof input.lora_rank === "number" ? input.lora_rank : undefined,
      };
      return { ok: true, jobId: await runtime().training.startJob(config) };
    },
    cancel(_db, _def, id, _input, ctx) {
      ownerOnly(ctx);
      const current = runtime().training.getJob(id);
      if (!current) throw httpError(404, "Training job not found");
      if (current.status !== "pending" && current.status !== "running") {
        throw httpError(409, `Training job cannot be cancelled (status=${current.status})`);
      }
      if (!runtime().training.cancelJob()) {
        throw httpError(409, "Training job is not the active trainer job");
      }
      return { ok: true };
    },
  },
};

export const INFERENCE_RUNTIME_ACTIONS: ActionDef[] = [
  {
    name: "run_inference",
    label: "Run inference",
    description: "Run metered inference through endpoint admission and credit policy.",
    target: "collection",
    effect: "external",
    execution: "async",
    roles: ["owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["endpoint_id", "messages"],
      properties: {
        endpoint_id: { type: "string", minLength: 1 },
        messages: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "content"],
            properties: {
              role: {
                type: "string",
                enum: ["system", "user", "assistant", "tool"],
              },
              content: { type: "string" },
            },
          },
        },
        sampling: { type: "object" },
        priority: { type: "integer", minimum: -100, maximum: 100 },
      },
    },
    timeoutMs: 300_000,
    cancellable: true,
  },
];

export const inferenceRuntimeAdapter: RecordAdapter = {
  id: "inference_runtime",
  policy: {
    authorize(_operation, _def, ctx) {
      runtimeOperator(ctx);
    },
  },
  actions: {
    run_inference(_db, _def, _id, input, ctx) {
      runtimeOperator(ctx);
      const active = runtime();
      const base = active.llm.getSamplingParams();
      const sampling: AgentSampling = {
        ...base,
        ...(input.sampling && typeof input.sampling === "object"
          ? input.sampling
          : {}),
      } as AgentSampling;
      const rawMessages = Array.isArray(input.messages) ? input.messages : [];
      const messages: AgentMessage[] = rawMessages.map((value) => {
        const item = value as Record<string, unknown>;
        return {
          role: item.role as AgentMessage["role"],
          content: String(item.content ?? ""),
        };
      });
      return runRemoteInference(getCoreDb(), active.llm as LlmManager, {
        endpointId: requiredText(input, "endpoint_id"),
        buyerUserId: requiredUser(ctx),
        buyerTenantId:
          ctx.tenantId ?? (() => { throw httpError(401, "Tenant required"); })(),
        messages,
        sampling,
        priority: typeof input.priority === "number" ? input.priority : undefined,
      }).then((content) => ({ ok: true, content }));
    },
  },
};

export const INTEGRATION_RUNTIME_ACTIONS: ActionDef[] = [
  {
    name: "sync",
    label: "Sync integration",
    description: "Request a sync through the configured provider connector.",
    target: "record",
    effect: "external",
    execution: "async",
    roles: ["owner"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    idempotency: { required: true, ttlSeconds: 300 },
    timeoutMs: 60_000,
    cancellable: false,
  },
];

function integrationStatus(
  db: AppDatabase,
  kind: IntegrationKind
): { connected: boolean; lastSyncAt: string | null } {
  const names =
    kind === "calendar"
      ? ["google_calendar_oauth"]
      : ["gmail_oauth", "imap_credentials"];
  const placeholders = names.map(() => "?").join(",");
  try {
    const row = db
      .prepare(
        `SELECT created_at FROM ai_secrets
         WHERE name IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`
      )
      .get(...names) as { created_at: string } | undefined;
    return { connected: Boolean(row), lastSyncAt: row?.created_at ?? null };
  } catch {
    return { connected: false, lastSyncAt: null };
  }
}

export const integrationRuntimeAdapter: RecordAdapter = {
  id: "integration_runtime",
  policy: {
    authorize(operation, _def, ctx) {
      if (operation === "action") ownerOnly(ctx);
      else requiredUser(ctx);
    },
  },
  list(db, def, query) {
    const rows = (["calendar", "email"] as const).map((kind) => {
      const status = integrationStatus(db, kind);
      return record(def, kind, {
        kind,
        connected: status.connected,
        last_sync_at: status.lastSyncAt,
      });
    });
    const result = page(rows, query);
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(db, def, id) {
    if (id !== "calendar" && id !== "email") return null;
    const status = integrationStatus(db, id);
    return record(def, id, {
      kind: id,
      connected: status.connected,
      last_sync_at: status.lastSyncAt,
    });
  },
  actions: {
    async sync(db, _def, id, _input, ctx) {
      ownerOnly(ctx);
      if (id !== "calendar" && id !== "email") {
        throw httpError(404, "Integration not found");
      }
      const status = integrationStatus(db, id);
      if (!status.connected) throw httpError(400, `${id} integration is not connected`);
      return runtime().syncIntegration({ db, kind: id, context: ctx });
    },
  },
};

export const runtimeAdapters = [
  chatSessionRuntimeAdapter,
  chatMessageRuntimeAdapter,
  modelAdapterRuntimeAdapter,
  embeddingRuntimeAdapter,
  capabilityIndexRuntimeAdapter,
  intelligenceSettingsRuntimeAdapter,
  promptFlowRuntimeAdapter,
  vaultSecretRuntimeAdapter,
  providerCredentialRuntimeAdapter,
  modelRuntimeAdapter,
  promptQueueRuntimeAdapter,
  datasetRuntimeAdapter,
  memoryMaintenanceRuntimeAdapter,
  autonomousRuntimeAdapter,
  trainingJobRuntimeAdapter,
  inferenceRuntimeAdapter,
  integrationRuntimeAdapter,
] as const;

export const runtimeAdapterRegistrations = [
  {
    objectType: "ChatSession",
    adapterId: "chat_session_runtime",
    database: "tenant",
    operations: ["list", "get", "create", "delete"],
    fields: ["id", "title", "created_at", "updated_at"],
    // Chat turn streaming remains on the authorized SSE protocol endpoint and
    // is not declared as a Record action.
    actions: CHAT_SESSION_ACTIONS,
  },
  {
    objectType: "ChatMessage",
    adapterId: "chat_message_runtime",
    database: "tenant",
    operations: ["list", "get", "create", "delete"],
    fields: ["id", "chat_id", "role", "content", "created_at"],
    actions: [],
  },
  {
    objectType: "ModelAdapter",
    adapterId: "model_adapter_runtime",
    database: "tenant",
    operations: ["list", "get", "create", "update", "delete"],
    fields: [
      "id",
      "name",
      "path",
      "description",
      "domain",
      "enabled",
      "default_scale",
      "created_at",
      "updated_at",
    ],
    actions: [],
  },
  {
    objectType: "EmbeddingRuntime",
    adapterId: "embedding_runtime",
    database: "tenant",
    operations: ["list", "get"],
    fields: [
      "id",
      "enabled",
      "enabled_override",
      "state",
      "health_ok",
      "pid",
      "port",
      "error",
    ],
    actions: EMBEDDING_RUNTIME_ACTIONS,
  },
  {
    objectType: "CapabilityIndex",
    adapterId: "capability_index_runtime",
    database: "tenant",
    operations: ["list", "get"],
    fields: ["id", "index_rows"],
    actions: CAPABILITY_INDEX_ACTIONS,
  },
  {
    objectType: "IntelligenceSettings",
    adapterId: "intelligence_settings_runtime",
    database: "tenant",
    operations: ["list", "get", "update"],
    fields: [
      "id",
      "active_model_path",
      "ctx_size",
      "gpu_layers",
      "port",
      "flash_attn",
      "threads",
      "batch_size",
      "ubatch_size",
      "parallel",
      "jinja",
      "extra_args",
      "auto_start",
      "temperature",
      "top_p",
      "top_k",
      "min_p",
      "repeat_penalty",
      "presence_penalty",
      "frequency_penalty",
      "max_tokens",
      "seed",
      "system_prompt",
      "enable_thinking",
      "thinking_efficiency",
      "native_tools",
      "memory_mode",
    ],
    actions: [],
  },
  {
    objectType: "PromptFlow",
    adapterId: "prompt_flow_runtime",
    database: "tenant",
    operations: ["list", "get", "update"],
    fields: ["id", "agent_id", "config", "assembled"],
    actions: [],
  },
  {
    objectType: "VaultSecret",
    adapterId: "vault_secret_runtime",
    database: "tenant",
    operations: ["list", "get", "create", "delete"],
    fields: ["id", "name", "value", "masked", "created_at"],
    actions: [],
  },
  {
    objectType: "ProviderCredential",
    adapterId: "provider_credential_runtime",
    database: "tenant",
    operations: ["list", "get", "create", "delete"],
    fields: [
      "id",
      "agent_id",
      "kind",
      "provider",
      "label",
      "api_key",
      "display_name",
      "email",
      "scopes",
      "status",
      "masked_token",
      "created_at",
      "updated_at",
    ],
    actions: [],
  },
  {
    objectType: "ModelRuntime",
    adapterId: "model_runtime",
    database: "tenant",
    operations: ["list", "get"],
    fields: ["id", "state", "health_ok", "pid", "port", "ctx_size", "error"],
    actions: MODEL_RUNTIME_ACTIONS,
  },
  {
    objectType: "PromptQueueJob",
    adapterId: "prompt_queue_runtime",
    database: "tenant",
    operations: ["list", "get"],
    fields: [
      "id",
      "status",
      "priority",
      "workflow_id",
      "prompt",
      "error",
      "created_at",
      "started_at",
      "finished_at",
    ],
    actions: PROMPT_QUEUE_ACTIONS,
  },
  {
    objectType: "Dataset",
    adapterId: "dataset_runtime",
    database: "tenant",
    operations: ["list", "get"],
    fields: ["id", "name", "domain", "row_count", "created_at", "updated_at"],
    actions: DATASET_ACTIONS,
  },
  {
    objectType: "MemoryMaintenance",
    adapterId: "memory_maintenance_runtime",
    database: "tenant",
    operations: [],
    fields: ["id"],
    actions: MEMORY_MAINTENANCE_ACTIONS,
  },
  {
    objectType: "AutonomousRuntime",
    adapterId: "autonomous_runtime",
    database: "tenant",
    operations: [],
    fields: ["id"],
    actions: AUTONOMOUS_RUNTIME_ACTIONS,
  },
  {
    objectType: "TrainingJob",
    adapterId: "training_job_runtime",
    database: "tenant",
    operations: ["list", "get"],
    fields: [
      "id",
      "adapter_id",
      "status",
      "progress",
      "error",
      "created_at",
      "started_at",
      "finished_at",
    ],
    actions: TRAINING_JOB_ACTIONS,
  },
  {
    objectType: "InferenceRuntime",
    adapterId: "inference_runtime",
    database: "core",
    operations: [],
    fields: ["id"],
    actions: INFERENCE_RUNTIME_ACTIONS,
  },
  {
    objectType: "IntegrationRuntime",
    adapterId: "integration_runtime",
    database: "tenant",
    operations: ["list", "get"],
    fields: ["id", "kind", "connected", "last_sync_at"],
    actions: INTEGRATION_RUNTIME_ACTIONS,
  },
] as const;
