import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OperationContext } from "../../../kernel/adapter-registry.js";
import { registerCoreObjectTypes } from "../../../kernel/core-object-types.js";
import {
  getRecord,
  getRecordDirect,
  KernelError,
  listRecords,
  listRecordsDirect,
} from "../../../kernel/record-api.js";
import {
  dataRouterRead,
  isDataRouterChatReadsEnabled,
  toDigestList,
  toDigestRecord,
} from "../index.js";

const owner: OperationContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "owner",
  source: "http",
};

function assertNotDatabase(value: unknown): void {
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  expect(value as { prepare?: unknown }).not.toHaveProperty("prepare");
  expect(value as { exec?: unknown }).not.toHaveProperty("exec");
  expect(typeof (value as { prepare?: unknown }).prepare).not.toBe("function");
}

describe("Data Router chat reads (#778)", () => {
  let db: Database.Database;
  let prevFlag: string | undefined;

  beforeEach(() => {
    prevFlag = process.env.DATA_ROUTER_CHAT_READS;
    process.env.DATA_ROUTER_CHAT_READS = "1";
    registerCoreObjectTypes();
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ai_chats (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, user_id TEXT,
        turn_state_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
        content_json TEXT NOT NULL, user_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      `INSERT INTO ai_chats (id, title, user_id, created_at, updated_at)
       VALUES ('chat-a', 'A', 'user-a', '1', '2'),
              ('chat-b', 'B', 'user-b', '1', '1')`
    ).run();
    db.prepare(
      `INSERT INTO ai_messages (id, chat_id, role, content_json, created_at)
       VALUES ('message-a', 'chat-a', 'user', '{"text":"hello"}', '1'),
              ('message-b', 'chat-b', 'user', '{"text":"other"}', '1')`
    ).run();
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.DATA_ROUTER_CHAT_READS;
    else process.env.DATA_ROUTER_CHAT_READS = prevFlag;
    db.close();
  });

  it("enables chat reads by default and when DATA_ROUTER_CHAT_READS=1", () => {
    expect(isDataRouterChatReadsEnabled()).toBe(true);
  });

  it("lists and gets ChatSession digests without a DB handle", () => {
    const listed = listRecords(db, "ChatSession", {}, owner);
    assertNotDatabase(listed);
    expect(listed.records.map((row) => row.id)).toEqual(["chat-a"]);
    expect(listed.records[0]?.objectType).toBe("ChatSession");
    expect(listed.records[0]?.data.title).toBe("A");

    const got = getRecord(db, "ChatSession", "chat-a", owner);
    assertNotDatabase(got);
    expect(got.id).toBe("chat-a");
    expect(got.data.title).toBe("A");
  });

  it("lists and gets ChatMessage digests scoped to the owner", () => {
    const listed = listRecords(
      db,
      "ChatMessage",
      { parentId: "chat-a" },
      owner
    );
    assertNotDatabase(listed);
    expect(listed.records.map((row) => row.id)).toEqual(["message-a"]);
    expect(listed.records[0]?.data).toMatchObject({
      chat_id: "chat-a",
      role: "user",
    });

    const got = getRecord(db, "ChatMessage", "message-a", owner);
    assertNotDatabase(got);
    expect(got.id).toBe("message-a");
  });

  it("fail-closes get for another user's chat", () => {
    expect(() => getRecord(db, "ChatSession", "chat-b", owner)).toThrowError(
      KernelError
    );
  });

  it("flag off uses direct path with matching shapes", () => {
    process.env.DATA_ROUTER_CHAT_READS = "0";
    expect(isDataRouterChatReadsEnabled()).toBe(false);

    const viaPublic = listRecords(db, "ChatSession", {}, owner);
    const viaDirect = listRecordsDirect(db, "ChatSession", {}, owner);
    expect(viaPublic.records.map((r) => r.id)).toEqual(
      viaDirect.records.map((r) => r.id)
    );

    const routed = dataRouterRead(
      { objectType: "ChatSession", op: "list", db, ctx: owner },
      { listRecordsDirect, getRecordDirect }
    );
    expect(routed).toBeNull();
  });

  it("toDigest* strips non-JSON values", () => {
    const row = toDigestRecord({
      id: "x",
      objectType: "ChatSession",
      data: { title: "t" },
      version: "1",
    });
    assertNotDatabase(row);
    const list = toDigestList({
      objectType: "ChatSession",
      records: [row],
      total: 1,
    });
    assertNotDatabase(list);
  });
});
