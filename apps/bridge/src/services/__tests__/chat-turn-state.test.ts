/**
 * Durable Intelligence turn_state and boot resume (#556).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import {
  appendChatTurnCheckpoint,
  buildContinueMessage,
  markChatTurnIdle,
  markChatTurnRunning,
  parseChatTurnState,
  readChatTurnState,
  resumeInterruptedChatTurns,
  shouldKeepInterruptedTurnRunning,
  writeChatTurnState,
  type ChatTurnState,
} from "../chat-turn-state.js";
import {
  clearAiChatTurnHandlersForTests,
  setAiChatTurnHandlers,
} from "../ai-chat-turn.js";

vi.mock("../active-work-run-card.js", () => ({
  completeActiveWorkRunCard: vi.fn(),
}));

function makeDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_chats (
      id TEXT PRIMARY KEY,
      title TEXT,
      user_id TEXT,
      turn_state_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function seedChat(
  db: AppDatabase,
  args: { chatId: string; userMessageId: string; status: ChatTurnState["status"] }
): void {
  db.prepare(
    `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
     VALUES (?, 'Chat', 'user-1', datetime('now'), datetime('now'))`
  ).run(args.chatId);
  db.prepare(
    `INSERT INTO ai_messages (id, chat_id, role, content_json)
     VALUES (?, ?, 'user', '{"text":"Ship the resume path"}')`
  ).run(args.userMessageId, args.chatId);
  writeChatTurnState(db, args.chatId, {
    status: args.status,
    userMessageId: args.userMessageId,
    agentId: "intelligence",
    userId: "user-1",
    generation: "boot-old",
    checkpoint: [{ name: "edit_file", preview: "updated ai.ts" }],
  });
}

afterEach(() => {
  clearAiChatTurnHandlersForTests();
});

describe("parseChatTurnState", () => {
  it("round-trips a running checkpoint blob", () => {
    const raw = JSON.stringify({
      status: "running",
      userMessageId: "msg-1",
      agentId: "intelligence",
      userId: "user-1",
      generation: "g1",
      checkpoint: [{ name: "git_commit", preview: "ok" }],
    });
    expect(parseChatTurnState(raw)).toMatchObject({
      status: "running",
      userMessageId: "msg-1",
      checkpoint: [{ name: "git_commit", preview: "ok" }],
    });
    expect(parseChatTurnState("not-json")).toBeNull();
    expect(parseChatTurnState({ status: "nope" })).toBeNull();
  });
});

describe("shouldKeepInterruptedTurnRunning", () => {
  it("leaves running on disconnect abort, idle on user Stop", () => {
    expect(
      shouldKeepInterruptedTurnRunning({
        aborted: true,
        transportClosed: true,
      })
    ).toBe(true);
    expect(
      shouldKeepInterruptedTurnRunning({
        aborted: true,
        transportClosed: false,
      })
    ).toBe(false);
    expect(
      shouldKeepInterruptedTurnRunning({
        aborted: false,
        transportClosed: true,
      })
    ).toBe(false);
  });
});

describe("markChatTurnRunning", () => {
  it("sets running on prepare and idle on done", () => {
    const db = makeDb();
    seedChat(db, {
      chatId: "c1",
      userMessageId: "m1",
      status: "idle",
    });
    const running = markChatTurnRunning(db, {
      chatId: "c1",
      userMessageId: "m1",
      agentId: "intelligence",
      userId: "user-1",
    });
    expect(running.status).toBe("running");
    expect(readChatTurnState(db, "c1")?.status).toBe("running");
    markChatTurnIdle(db, "c1");
    expect(readChatTurnState(db, "c1")?.status).toBe("idle");
  });

  it("keeps resuming through prepare so a crash mid-resume fail-closes", () => {
    const db = makeDb();
    seedChat(db, {
      chatId: "c1",
      userMessageId: "m1",
      status: "resuming",
    });
    const next = markChatTurnRunning(db, {
      chatId: "c1",
      userMessageId: "m1",
      agentId: "intelligence",
      userId: "user-1",
    });
    expect(next.status).toBe("resuming");
    expect(next.checkpoint[0]?.name).toBe("edit_file");
  });

  it("appends tool checkpoints while running", () => {
    const db = makeDb();
    seedChat(db, {
      chatId: "c1",
      userMessageId: "m1",
      status: "idle",
    });
    markChatTurnRunning(db, {
      chatId: "c1",
      userMessageId: "m1",
      agentId: "intelligence",
      userId: "user-1",
    });
    appendChatTurnCheckpoint(db, "c1", {
      name: "edit_file",
      preview: "ok",
    });
    expect(readChatTurnState(db, "c1")?.checkpoint).toEqual([
      { name: "edit_file", preview: "ok", isError: false },
    ]);
  });
});

describe("buildContinueMessage", () => {
  it("asks the model not to redo completed tools", () => {
    const text = buildContinueMessage({
      originalUserText: "Ship the resume path",
      checkpoint: [{ name: "edit_file", preview: "updated ai.ts" }],
    });
    expect(text).toContain("Do not redo file or git work");
    expect(text).toContain("edit_file");
    expect(text).toContain("Ship the resume path");
  });
});

describe("resumeInterruptedChatTurns", () => {
  it("continues a running chat once without a second user message", async () => {
    const db = makeDb();
    seedChat(db, {
      chatId: "chat-run",
      userMessageId: "msg-run",
      status: "running",
    });
    const prepare = vi.fn(async (_auth, body) => {
      expect(body.resumeInterrupted).toBe(true);
      expect(body.chatId).toBe("chat-run");
      markChatTurnRunning(db, {
        chatId: "chat-run",
        userMessageId: "msg-run",
        agentId: "intelligence",
        userId: "user-1",
      });
      return { ok: true as const, prepared: { activeChatId: "chat-run" } as never };
    });
    const run = vi.fn(async () => {
      markChatTurnIdle(db, "chat-run");
    });
    setAiChatTurnHandlers({ prepare, run });

    const result = await resumeInterruptedChatTurns({
      tenants: [{ tenantId: "t1", db }],
    });
    expect(result).toEqual({ resumed: 1, failedClosed: 0 });
    expect(prepare).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(readChatTurnState(db, "chat-run")?.status).toBe("idle");
    const userCount = db
      .prepare(`SELECT COUNT(*) AS n FROM ai_messages WHERE chat_id = ? AND role = 'user'`)
      .get("chat-run") as { n: number };
    expect(userCount.n).toBe(1);
  });

  it("fail-closes leftover resuming from a previous generation", async () => {
    const db = makeDb();
    seedChat(db, {
      chatId: "chat-loop",
      userMessageId: "msg-loop",
      status: "resuming",
    });
    const prepare = vi.fn();
    const run = vi.fn();
    setAiChatTurnHandlers({ prepare, run });

    const result = await resumeInterruptedChatTurns({
      tenants: [{ tenantId: "t1", db }],
    });
    expect(result).toEqual({ resumed: 0, failedClosed: 1 });
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(readChatTurnState(db, "chat-loop")?.status).toBe("interrupted_failed");
  });
});
