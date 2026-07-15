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
  modelRuntimeAdapter,
  promptQueueRuntimeAdapter,
  runtimeAdapterRegistrations,
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
  } as unknown as RuntimeAdapterServices["llm"];
  return {
    llm,
    queue: { enqueue: vi.fn(() => "queue-1") },
    training: {
      listJobs: vi.fn(() => []),
      getJob: vi.fn(() => null),
      startJob: vi.fn(async () => "training-1"),
      cancelJob: vi.fn(() => false),
    },
    sendMessage: vi.fn(async () => ({ ok: true, messageId: "assistant-1" })),
    syncIntegration: vi.fn(async () => ({ ok: true, queued: true })),
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
        content_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE ai_prompt_queue (
        id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0, workflow_id TEXT, prompt TEXT,
        result_json TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT, finished_at TEXT
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
      "model_runtime",
      "prompt_queue_runtime",
      "dataset_runtime",
      "training_job_runtime",
      "inference_runtime",
      "integration_runtime",
    ]);
    expect(CHAT_SESSION_ACTIONS.map(({ name, execution }) => [name, execution])).toEqual([
      ["send_message", "async"],
      ["confirm_tool", "sync"],
      ["truncate", "sync"],
    ]);
    const actionNames = runtimeAdapterRegistrations.flatMap((entry) =>
      entry.actions.map((action) => action.name)
    );
    expect(actionNames).toEqual(
      expect.arrayContaining([
        "select_model",
        "start",
        "stop",
        "restart",
        "enqueue",
        "cancel",
        "build_dataset",
        "run_inference",
        "sync",
      ])
    );
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

  it("delegates chat sends to the configured policy runtime", async () => {
    const active = fakeServices();
    configureRuntimeAdapterServices(active);
    db.prepare(
      `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
       VALUES ('chat-a', 'A', 'user-a', '1', '1')`
    ).run();

    await expect(
      chatSessionRuntimeAdapter.actions!.send_message(
        db,
        definition("ChatSession", "chat_session_runtime"),
        "chat-a",
        { content: "hello", agent_id: "intelligence" },
        owner
      )
    ).resolves.toMatchObject({ ok: true });
    expect(active.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        chatId: "chat-a",
        content: "hello",
        agentId: "intelligence",
        context: owner,
      })
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
