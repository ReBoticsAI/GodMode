/**
 * Bounded subagent runs (#70 / #118): timeout + structured status + queue stale recovery.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import {
  DELEGATE_DEFAULT_TIMEOUT_MS,
  DELEGATE_MAX_TIMEOUT_MS,
  runBoundedSubagentDelegation,
} from "../agents/subagent-bounds.js";
import { recoverStaleQueueJobs } from "../ai-queue-worker.js";

describe("runBoundedSubagentDelegation", () => {
  it("returns status ok with answer on success", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "reviewer",
      timeoutMs: 5_000,
      run: async () => "reviewed OK",
    });
    expect(result).toMatchObject({
      agentId: "reviewer",
      status: "ok",
      answer: "reviewed OK",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns status timeout when the run exceeds the cap", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "slow",
      timeoutMs: 30,
      run: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("too late"), 500);
        }),
    });
    expect(result.status).toBe("timeout");
    expect(result.agentId).toBe("slow");
    expect(result.answer).toBeUndefined();
    expect(result.error).toMatch(/timed out after 30ms/i);
    expect(result.durationMs).toBeGreaterThanOrEqual(25);
  });

  it("returns status error when the run throws", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "broken",
      timeoutMs: 5_000,
      run: async () => {
        throw new Error("backend exploded");
      },
    });
    expect(result).toMatchObject({
      agentId: "broken",
      status: "error",
      error: "backend exploded",
    });
    expect(result.answer).toBeUndefined();
  });

  it("caps timeoutMs at DELEGATE_MAX_TIMEOUT_MS", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "capped",
      timeoutMs: DELEGATE_MAX_TIMEOUT_MS + 50_000,
      run: async () => "ok",
    });
    expect(result.status).toBe("ok");
    expect(DELEGATE_DEFAULT_TIMEOUT_MS).toBe(120_000);
    expect(DELEGATE_MAX_TIMEOUT_MS).toBe(300_000);
  });
});

describe("recoverStaleQueueJobs", () => {
  it("marks old running jobs as error and leaves fresh running alone", () => {
    const db = new Database(":memory:") as unknown as AppDatabase;
    db.exec(`
      CREATE TABLE ai_prompt_queue (
        id TEXT PRIMARY KEY,
        status TEXT,
        error TEXT,
        started_at TEXT,
        finished_at TEXT
      );
    `);
    db.prepare(
      `INSERT INTO ai_prompt_queue (id, status, error, started_at, finished_at)
       VALUES (?, 'running', NULL, datetime('now', '-120 minutes'), NULL)`
    ).run("stale-1");
    db.prepare(
      `INSERT INTO ai_prompt_queue (id, status, error, started_at, finished_at)
       VALUES (?, 'running', NULL, datetime('now', '-1 minutes'), NULL)`
    ).run("fresh-1");
    db.prepare(
      `INSERT INTO ai_prompt_queue (id, status, error, started_at, finished_at)
       VALUES (?, 'pending', NULL, NULL, NULL)`
    ).run("pending-1");

    const changed = recoverStaleQueueJobs(db, 60);
    expect(changed).toBe(1);

    const stale = db
      .prepare(`SELECT status, error FROM ai_prompt_queue WHERE id = ?`)
      .get("stale-1") as { status: string; error: string };
    expect(stale.status).toBe("error");
    expect(stale.error).toMatch(/stale running/i);

    const fresh = db
      .prepare(`SELECT status FROM ai_prompt_queue WHERE id = ?`)
      .get("fresh-1") as { status: string };
    expect(fresh.status).toBe("running");

    const pending = db
      .prepare(`SELECT status FROM ai_prompt_queue WHERE id = ?`)
      .get("pending-1") as { status: string };
    expect(pending.status).toBe("pending");
  });
});
