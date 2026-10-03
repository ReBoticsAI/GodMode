import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const mem = new Database(":memory:");
mem.pragma("foreign_keys = ON");

vi.mock("../../core-db.js", () => ({
  getCloudDb: () => mem,
}));

vi.mock("../../config.js", () => ({
  config: {
    isSaas: true,
    isHub: true,
  },
}));

import {
  assertHandleAvailable,
  claimUserHandle,
  ensurePublicAgentHandles,
  ensurePublicHandlesSchema,
  extractMentionHandles,
  isReservedForUserClaim,
  normalizeHandle,
  PublicHandleError,
  resolveHandle,
  resolveMentionsInText,
} from "../public-handles.js";

function seedUsers(): void {
  mem.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      username TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_temporary INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensurePublicHandlesSchema(mem);
  mem.exec(
    `INSERT OR REPLACE INTO users (id, email, display_name, username)
     VALUES ('u1', 'a@example.com', 'Alpha', NULL),
            ('u2', 'b@example.com', 'Beta', NULL)`
  );
}

describe("public-handles", () => {
  beforeEach(() => {
    mem.exec(`
      DROP TABLE IF EXISTS public_handles;
      DROP TABLE IF EXISTS users;
    `);
    seedUsers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes and validates handles", () => {
    expect(normalizeHandle("@Dane_01")).toBe("dane_01");
    expect(assertHandleAvailable("qa_alpha")).toBe("qa_alpha");
    expect(() => assertHandleAvailable("ab")).toThrow(PublicHandleError);
    expect(isReservedForUserClaim("intelligence")).toBe(true);
    expect(isReservedForUserClaim("general")).toBe(true);
    expect(isReservedForUserClaim("channel-foo")).toBe(true);
  });

  it("claims uniquely for users and collides with agents", () => {
    expect(claimUserHandle("u1", "qa_alpha")).toBe("qa_alpha");
    expect(resolveHandle("qa_alpha")).toMatchObject({
      kind: "user",
      userId: "u1",
    });
    const row = mem
      .prepare(`SELECT username FROM users WHERE id='u1'`)
      .get() as { username: string };
    expect(row.username).toBe("qa_alpha");

    expect(() => claimUserHandle("u2", "qa_alpha")).toThrow(/taken/i);

    ensurePublicAgentHandles("tenant-op", mem);
    expect(() => claimUserHandle("u2", "general")).toThrow(/reserved/i);
    expect(resolveHandle("intelligence")).toMatchObject({
      kind: "agent",
      agentId: "intelligence",
    });
    expect(resolveHandle("local")).toMatchObject({
      kind: "agent",
      agentId: "channel-local",
    });
  });

  it("extracts and resolves mentions", () => {
    claimUserHandle("u1", "qa_alpha");
    ensurePublicAgentHandles("tenant-op", mem);
    expect(extractMentionHandles("hi @qa_alpha and @general")).toEqual([
      "qa_alpha",
      "general",
    ]);
    const mentions = resolveMentionsInText("ping @qa_alpha @general @nope");
    expect(mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          handle: "qa_alpha",
          subjectKind: "user",
          subjectId: "u1",
        }),
        expect.objectContaining({
          handle: "general",
          subjectKind: "agent",
          subjectId: "channel-general",
        }),
      ])
    );
    expect(mentions.find((m) => m.handle === "nope")).toBeUndefined();
  });

  it("allows reclaim / rename for the same user", () => {
    claimUserHandle("u1", "first_name");
    claimUserHandle("u1", "second_name");
    expect(resolveHandle("first_name")).toBeNull();
    expect(resolveHandle("second_name")).toMatchObject({ userId: "u1" });
  });
});
