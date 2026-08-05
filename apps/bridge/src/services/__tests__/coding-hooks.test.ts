import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCodingHooksAllow,
  codingHookExecutionEnabled,
} from "../coding/coding-hooks.js";
import type { CoreDatabase } from "../../core-db.js";

const prev = process.env.CODING_HOOK_EXECUTION;

afterEach(() => {
  if (prev === undefined) delete process.env.CODING_HOOK_EXECUTION;
  else process.env.CODING_HOOK_EXECUTION = prev;
});

function memoryHooksDb(): CoreDatabase {
  const db = new Database(":memory:") as CoreDatabase;
  db.exec(`
    CREATE TABLE hooks (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_tenant_id TEXT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_kind TEXT NOT NULL,
      event_type TEXT,
      schedule_cron TEXT,
      condition_json TEXT,
      action_kind TEXT NOT NULL,
      action_config_json TEXT,
      rate_limit_per_hour INTEGER,
      require_approval INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fired_at TEXT
    );
    CREATE TABLE hook_runs (
      id TEXT PRIMARY KEY,
      hook_id TEXT NOT NULL,
      event_id TEXT,
      status TEXT NOT NULL,
      detail TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("coding hooks (#448)", () => {
  it("honors CODING_HOOK_EXECUTION=off", () => {
    process.env.CODING_HOOK_EXECUTION = "off";
    expect(codingHookExecutionEnabled()).toBe(false);
  });

  it("blocks coding.file.before when a gate hook matches", async () => {
    process.env.CODING_HOOK_EXECUTION = "on";
    const db = memoryHooksDb();
    db.prepare(
      `INSERT INTO hooks (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
        trigger_kind, event_type, action_kind, action_config_json, require_approval)
       VALUES ('h1', 'user', 'u1', 'tenant-a', 'Block writes', 1,
        'event', 'coding.file.before', 'gate', '{"message":"no writes"}', 0)`
    ).run();
    await expect(
      assertCodingHooksAllow({
        eventType: "coding.file.before",
        tenantId: "tenant-a",
        actorKind: "user",
        actorId: "u1",
        payload: { path: "a.ts", tool: "write_file" },
        db,
      })
    ).rejects.toThrow(/Blocked by automation/i);
  });

  it("allows coding when execution is off even if a gate exists", async () => {
    process.env.CODING_HOOK_EXECUTION = "off";
    const db = memoryHooksDb();
    db.prepare(
      `INSERT INTO hooks (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
        trigger_kind, event_type, action_kind, require_approval)
       VALUES ('h1', 'user', 'u1', 'tenant-a', 'Block writes', 1,
        'event', 'coding.file.before', 'gate', 0)`
    ).run();
    await expect(
      assertCodingHooksAllow({
        eventType: "coding.file.before",
        tenantId: "tenant-a",
        actorKind: "user",
        actorId: "u1",
        db,
      })
    ).resolves.toBeUndefined();
  });
});
