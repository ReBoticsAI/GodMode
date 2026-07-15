import Database from "better-sqlite3";
import type { ObjectTypeDef } from "@godmode/kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationContext } from "../adapter-registry.js";
import {
  CHAT_SESSION_ACTIONS,
  clearRuntimeAdapterServices,
  configureRuntimeAdapterServices,
  chatMessageRuntimeAdapter,
  chatSessionRuntimeAdapter,
  embeddingRuntimeAdapter,
  memoryMaintenanceRuntimeAdapter,
  modelAdapterRuntimeAdapter,
  modelRuntimeAdapter,
  promptQueueRuntimeAdapter,
  providerCredentialRuntimeAdapter,
  REQUIRED_RUNTIME_ADAPTER_SERVICE_KEYS,
  runtimeAdapterRegistrations,
  vaultSecretRuntimeAdapter,
  type RuntimeAdapterServices,
} from "../adapters/runtime.js";

function definition(name: string, adapterId: string): ObjectTypeDef {
  return {
    name,
    label: name,
    labelPlural: `${name}s`,
    module: "test",
    storage: { kind: "adapter", adapterId },
    fields: [
      { name: "id", label: "id", fieldType: "Data" },
      { name: "title", label: "title", fieldType: "Data" },
      { name: "chat_id", label: "chat_id", fieldType: "Data" },
      { name: "role", label: "role", fieldType: "Data" },
      { name: "content", label: "content", fieldType: "JSON" },
      { name: "created_at", label: "created_at", fieldType: "Data" },
      { name: "updated_at", label: "updated_at", fieldType: "Data" },
    ],
    permissions: [{ role: "owner", read: true }],
    operations: ["list", "get"],
    contractVersion: 1,
    schemaVersion: 1,
  };
}

const owner: OperationContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "owner",
  source: "http",
};

function fakeServices(overrides: Partial<RuntimeAdapterServices> = {}) {
  const llm = {
    getStatus: vi.fn(() => ({
      state: "running",
      healthOk: true,
      pid: 42,
      port: 8080,
      ctxSize: 8192,
      error: null,
      modelPath: "C:\\secret\\model.gguf",
    })),
    getSamplingParams: vi.fn(() => ({})),
    scanModels: vi.fn(() => []),
    start: vi.fn(async () => ({ state: "running" })),
    stop: vi.fn(async () => ({ state: "stopped" })),
    restart: vi.fn(async () => ({ state: "running" })),
    isReady: vi.fn(() => true),
    getServerBaseUrl: vi.fn(() => "http://127.0.0.1:8080"),
    getEnabledAdapterPaths: vi.fn(() => []),
    getSettings: vi.fn(() => ({
      systemPrompt: "test",
      enableThinking: false,
      thinkingEfficiency: "normal",
      nativeTools: true,
    })),
    updateSettings: vi.fn((_patch) => ({
      systemPrompt: "test",
      enableThinking: false,
      thinkingEfficiency: "normal",
      nativeTools: true,
    })),
  } as unknown as RuntimeAdapterServices["llm"];
  return {
    llm,
    queue: {
      enqueue: vi.fn(() => "queue-1"),
      hasPendingOrRunningWorkflow: vi.fn(() => false),
    },
    training: {
      listJobs: vi.fn(() => []),
      getJob: vi.fn(() => null),
      startJob: vi.fn(async () => "training-1"),
      cancelJob: vi.fn(() => false),
    },
    embeddings: {
      getStatus: vi.fn(() => ({
        enabled: true,
        enabledOverride: true,
        embedder: {
          state: "running",
          healthOk: true,
          pid: 84,
          port: 8081,
          error: null,
        },
      })),
      start: vi.fn(async () => ({ state: "running" })),
      stop: vi.fn(async () => ({ state: "stopped" })),
      setEnabled: vi.fn(async (enabled: boolean) => ({ enabled })),
      getEmbeddingClient: vi.fn(() => undefined),
    } as unknown as RuntimeAdapterServices["embeddings"],
    memoryMaintenance: {
      enqueueDistill: vi.fn(() => "distill-1"),
      enqueueWikiSynthesize: vi.fn(() => "wiki-1"),
    },
    syncIntegration: vi.fn(async () => ({ ok: true, queued: true })),
    shareChat: vi.fn(() => ({ ok: true, session: { id: "shared-1" } })),
    ...overrides,
  } satisfies RuntimeAdapterServices;
}

describe("runtime ObjectType actions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ai_chats (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, user_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
        content_json TEXT NOT NULL, user_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_prompt_queue (
        id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0, workflow_id TEXT, prompt TEXT,
        result_json TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT, finished_at TEXT
      );
      CREATE TABLE ai_adapters (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
        description TEXT, domain TEXT, enabled INTEGER NOT NULL DEFAULT 1,
        default_scale REAL NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_secrets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_agent_accounts (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, kind TEXT NOT NULL,
        provider TEXT, provider_user_id TEXT, email TEXT, display_name TEXT,
        avatar_url TEXT, access_token TEXT, refresh_token TEXT, scopes_json TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    configureRuntimeAdapterServices(fakeServices());
  });

  afterEach(() => {
    clearRuntimeAdapterServices();
    db.close();
  });

  it("exports exact adapter IDs, named actions, and execution modes", () => {
    expect(runtimeAdapterRegistrations.map((entry) => entry.adapterId)).toEqual([
      "chat_session_runtime",
      "chat_message_runtime",
      "model_adapter_runtime",
      "embedding_runtime",
      "capability_index_runtime",
      "intelligence_settings_runtime",
      "prompt_flow_runtime",
      "vault_secret_runtime",
      "provider_credential_runtime",
      "model_runtime",
      "prompt_queue_runtime",
      "dataset_runtime",
      "memory_maintenance_runtime",
      "autonomous_runtime",
      "training_job_runtime",
      "inference_runtime",
      "integration_runtime",
    ]);
    expect(CHAT_SESSION_ACTIONS.map(({ name, execution }) => [name, execution])).toEqual([
      ["share", "async"],
      ["confirm_tool", "sync"],
      ["truncate", "sync"],
      ["distill", "sync"],
    ]);
    const actionNames = runtimeAdapterRegistrations.flatMap((entry) =>
      entry.actions.map((action) => action.name)
    );
    expect(actionNames).toEqual([
      "share",
      "confirm_tool",
      "truncate",
      "distill",
      "start",
      "stop",
      "set_enabled",
      "rebuild",
      "select_model",
      "start",
      "stop",
      "restart",
      "enqueue",
      "cancel",
      "build_dataset",
      "import_dataset",
      "wiki_synthesize",
      "kick",
      "enqueue",
      "cancel",
      "run_inference",
      "sync",
    ]);
  });

  it("rejects production runtime wiring when any declared service is omitted", () => {
    const complete = fakeServices();
    expect(REQUIRED_RUNTIME_ADAPTER_SERVICE_KEYS).toEqual([
      "llm",
      "queue",
      "training",
      "embeddings",
      "memoryMaintenance",
      "syncIntegration",
      "shareChat",
    ]);
    for (const key of REQUIRED_RUNTIME_ADAPTER_SERVICE_KEYS) {
      const incomplete = { ...complete, [key]: undefined };
      expect(() =>
        configureRuntimeAdapterServices(incomplete as unknown as RuntimeAdapterServices)
      ).toThrow(`Runtime adapter service "${key}" is required`);
    }
    configureRuntimeAdapterServices(complete);
  });

  it("scopes chat sessions and messages to their authenticated owner", () => {
    db.prepare(
      `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
       VALUES ('chat-a', 'A', 'user-a', '1', '1'), ('chat-b', 'B', 'user-b', '1', '1')`
    ).run();
    db.prepare(
      `INSERT INTO ai_messages (id, chat_id, role, content_json, created_at)
       VALUES ('message-a', 'chat-a', 'user', '{"text":"a"}', '1'),
              ('message-b', 'chat-b', 'user', '{"text":"b"}', '1')`
    ).run();

    const chats = chatSessionRuntimeAdapter.list!(
      db,
      definition("ChatSession", "chat_session_runtime"),
      {},
      owner
    );
    const messages = chatMessageRuntimeAdapter.list!(
      db,
      definition("ChatMessage", "chat_message_runtime"),
      {},
      owner
    );
    expect(chats.records.map((row) => row.id)).toEqual(["chat-a"]);
    expect(messages.records.map((row) => row.id)).toEqual(["message-a"]);
    expect(
      chatSessionRuntimeAdapter.get!(
        db,
        definition("ChatSession", "chat_session_runtime"),
        "chat-b",
        owner
      )
    ).toBeNull();
  });

  it("persists streamed chat messages through owner-scoped CRUD", () => {
    db.prepare(
      `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
       VALUES ('chat-a', 'A', 'user-a', '1', '1'),
              ('chat-b', 'B', 'user-b', '1', '1')`
    ).run();
    const def = definition("ChatMessage", "chat_message_runtime");
    const created = chatMessageRuntimeAdapter.create!(
      db,
      def,
      {
        chat_id: "chat-a",
        role: "assistant",
        content: { content: "stream complete" },
      },
      owner
    );
    expect(created.data).toMatchObject({
      chat_id: "chat-a",
      role: "assistant",
      content: { content: "stream complete" },
    });
    expect(() =>
      chatMessageRuntimeAdapter.create!(
        db,
        def,
        { chat_id: "chat-b", role: "user", content: { text: "no" } },
        owner
      )
    ).toThrow(/chat session not found/i);
  });

  it("delegates chat share and distill to the configured production services", async () => {
    const active = fakeServices();
    configureRuntimeAdapterServices(active);
    db.prepare(
      `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
       VALUES ('chat-a', 'A', 'user-a', '1', '1')`
    ).run();
    const def = definition("ChatSession", "chat_session_runtime");

    await expect(
      chatSessionRuntimeAdapter.actions!.share(
        db,
        def,
        "chat-a",
        { agent_id: "agent-a" },
        owner
      )
    ).resolves.toMatchObject({ ok: true });
    expect(active.shareChat).toHaveBeenCalledWith({
      db,
      chatId: "chat-a",
      agentId: "agent-a",
      context: owner,
    });

    expect(
      chatSessionRuntimeAdapter.actions!.distill(
        db,
        def,
        "chat-a",
        { agent_id: "agent-a", force: true },
        owner
      )
    ).toEqual({ ok: true, jobId: "distill-1" });
    expect(active.memoryMaintenance.enqueueDistill).toHaveBeenCalledWith({
      chatId: "chat-a",
      agentId: "agent-a",
      tenantId: "tenant-a",
      force: true,
    });
  });

  it("uses the configured embedding and wiki-maintenance services", async () => {
    const active = fakeServices();
    configureRuntimeAdapterServices(active);
    const embeddingDef = definition("EmbeddingRuntime", "embedding_runtime");

    expect(
      embeddingRuntimeAdapter.list!(db, embeddingDef, {}, owner).records[0]?.data
    ).toMatchObject({
      id: "runtime",
      enabled: true,
      state: "running",
      health_ok: true,
    });
    expect(
      embeddingRuntimeAdapter.get!(db, embeddingDef, "runtime", owner)?.data
    ).toMatchObject({ enabled: true, port: 8081 });
    await expect(
      embeddingRuntimeAdapter.actions!.start(db, embeddingDef, "runtime", {}, owner)
    ).resolves.toEqual({ state: "running" });
    await expect(
      embeddingRuntimeAdapter.actions!.stop(db, embeddingDef, "runtime", {}, owner)
    ).resolves.toEqual({ state: "stopped" });
    await expect(
      embeddingRuntimeAdapter.actions!.set_enabled(
        db,
        embeddingDef,
        "runtime",
        { enabled: false },
        owner
      )
    ).resolves.toEqual({ enabled: false });

    expect(
      memoryMaintenanceRuntimeAdapter.actions!.wiki_synthesize(
        db,
        definition("MemoryMaintenance", "memory_maintenance_runtime"),
        "",
        { agent_id: "agent-a" },
        owner
      )
    ).toEqual({ ok: true, jobId: "wiki-1" });
    expect(active.memoryMaintenance.enqueueWikiSynthesize).toHaveBeenCalledWith(
      "tenant-a",
      "agent-a"
    );
  });

  it("truncates only messages after an owned chat anchor", () => {
    db.prepare(
      `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
       VALUES ('chat-a', 'A', 'user-a', '1', '1')`
    ).run();
    db.prepare(
      `INSERT INTO ai_messages (id, chat_id, role, content_json, created_at)
       VALUES ('m1', 'chat-a', 'user', '{}', '2026-01-01T00:00:00Z'),
              ('m2', 'chat-a', 'assistant', '{}', '2026-01-01T00:00:01Z')`
    ).run();

    expect(
      chatSessionRuntimeAdapter.actions!.truncate(
        db,
        definition("ChatSession", "chat_session_runtime"),
        "chat-a",
        { after_message_id: "m1" },
        owner
      )
    ).toEqual({ ok: true, deleted: 1 });
  });

  it("creates and deletes owned chats and individual messages", () => {
    const chatDef = definition("ChatSession", "chat_session_runtime");
    const messageDef = definition("ChatMessage", "chat_message_runtime");
    const created = chatSessionRuntimeAdapter.create!(
      db,
      chatDef,
      { title: "Lifecycle" },
      owner
    );
    db.prepare(
      `INSERT INTO ai_messages (id, chat_id, role, content_json, created_at)
       VALUES ('message-1', ?, 'user', '{}', '1')`
    ).run(created.id);
    chatMessageRuntimeAdapter.delete!(db, messageDef, "message-1", owner);
    expect(chatMessageRuntimeAdapter.get!(db, messageDef, "message-1", owner)).toBeNull();
    chatSessionRuntimeAdapter.delete!(db, chatDef, created.id, owner);
    expect(chatSessionRuntimeAdapter.get!(db, chatDef, created.id, owner)).toBeNull();
  });

  it("uses the model adapter service for CRUD", () => {
    const def = definition("ModelAdapter", "model_adapter_runtime");
    const created = modelAdapterRuntimeAdapter.create!(
      db,
      def,
      { name: "Finance", path: "C:\\models\\finance.gguf" },
      owner
    );
    expect(created.data).toMatchObject({ name: "Finance", enabled: true });
    expect(
      modelAdapterRuntimeAdapter.update!(
        db,
        def,
        created.id,
        { default_scale: 0.5 },
        owner
      ).data.default_scale
    ).toBe(0.5);
    modelAdapterRuntimeAdapter.delete!(db, def, created.id, owner);
    expect(modelAdapterRuntimeAdapter.get!(db, def, created.id, owner)).toBeNull();
  });

  it("never projects Vault secret values", () => {
    const def = definition("VaultSecret", "vault_secret_runtime");
    const created = vaultSecretRuntimeAdapter.create!(
      db,
      def,
      { name: "provider_key", value: "sk-super-secret-value" },
      owner
    );
    expect(created.data).not.toHaveProperty("value");
    expect(created.data.masked).toBeTruthy();
    expect(vaultSecretRuntimeAdapter.list!(db, def, {}, owner).records[0]?.data).not.toHaveProperty(
      "value"
    );
  });

  it("never projects provider credential material", () => {
    const def = definition("ProviderCredential", "provider_credential_runtime");
    const created = providerCredentialRuntimeAdapter.create!(
      db,
      def,
      {
        agent_id: "intelligence",
        provider: "openai",
        api_key: "sk-provider-secret",
      },
      owner
    );
    expect(created.data).not.toHaveProperty("api_key");
    expect(created.data).not.toHaveProperty("access_token");
    expect(created.data.masked_token).toBeTruthy();
    expect(
      providerCredentialRuntimeAdapter.list!(
        db,
        def,
        { filters: { agent_id: "intelligence" } },
        owner
      ).records[0]?.data
    ).not.toHaveProperty("access_token");
  });

  it("stores Cursor credentials under the fixed redacted ProviderCredential id", () => {
    const def = definition("ProviderCredential", "provider_credential_runtime");
    const created = providerCredentialRuntimeAdapter.create!(
      db,
      def,
      {
        agent_id: "intelligence",
        provider: "cursor",
        api_key: "cursor-super-secret",
      },
      owner
    );

    expect(created.id).toBe("cursor-api-key");
    expect(created.data).toMatchObject({
      provider: "cursor",
      status: "active",
    });
    expect(JSON.stringify(created)).not.toContain("cursor-super-secret");
    expect(providerCredentialRuntimeAdapter.get!(db, def, "cursor-api-key", owner)).not.toBeNull();

    providerCredentialRuntimeAdapter.delete!(db, def, "cursor-api-key", owner);
    expect(providerCredentialRuntimeAdapter.get!(db, def, "cursor-api-key", owner)).toBeNull();
    expect(() =>
      providerCredentialRuntimeAdapter.delete!(db, def, "cursor-api-key", owner)
    ).not.toThrow();
  });

  it("uses the live queue and rejects non-operator enqueue attempts", () => {
    const active = fakeServices();
    configureRuntimeAdapterServices(active);
    const def = definition("PromptQueueJob", "prompt_queue_runtime");
    expect(
      promptQueueRuntimeAdapter.actions!.enqueue(
        db,
        def,
        "",
        { prompt: "do work", priority: 3 },
        owner
      )
    ).toEqual({ ok: true, jobId: "queue-1" });
    expect(active.queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "do work",
        priority: 3,
        tenantId: "tenant-a",
      })
    );
    expect(() =>
      promptQueueRuntimeAdapter.actions!.enqueue(
        db,
        def,
        "",
        { prompt: "do work" },
        { ...owner, role: "editor" }
      )
    ).toThrow(/operator role required/i);
  });

  it("does not expose model filesystem paths and owner-gates lifecycle actions", () => {
    const def = definition("ModelRuntime", "model_runtime");
    const row = modelRuntimeAdapter.get!(db, def, "runtime", owner);
    expect(row?.data).not.toHaveProperty("modelPath");
    expect(row?.data).not.toHaveProperty("model_path");
    expect(() =>
      modelRuntimeAdapter.actions!.stop(
        db,
        def,
        "runtime",
        {},
        { ...owner, role: "editor" }
      )
    ).toThrow(/owner role required/i);
  });
});
