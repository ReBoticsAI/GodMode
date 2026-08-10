/**
 * Embed queue fairness (#69 track C).
 */
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Database(":memory:");

vi.mock("../../../config.js", () => ({
  config: {
    isSaas: true,
    embeddings: {
      queueEnabled: true,
      queuePollMs: 750,
      queueRps: 8,
      queueStaleMinutes: 15,
    },
  },
}));

vi.mock("../../../core-db.js", async () => {
  const actual = await vi.importActual<typeof import("../../../core-db.js")>(
    "../../../core-db.js"
  );
  return {
    ...actual,
    getCloudDb: () => mem,
  };
});

const {
  enqueueEmbedJob,
  claimNextEmbedJob,
  completeEmbedJob,
  resetEmbedQueueFairness,
  isEmbedQueueEnabled,
} = await import("../embed-queue.js");

beforeEach(() => {
  mem.exec(`
    DROP TABLE IF EXISTS embed_queue;
    CREATE TABLE embed_queue (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      profile TEXT NOT NULL DEFAULT 'memory',
      lane TEXT NOT NULL DEFAULT 'backfill',
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );
  `);
  resetEmbedQueueFairness();
});

describe("embed-queue fairness", () => {
  it("reports queue enabled under SaaS mock", () => {
    expect(isEmbedQueueEnabled()).toBe(true);
  });

  it("prefers interactive over backfill for the same tenant", () => {
    enqueueEmbedJob({
      tenantId: "t1",
      lane: "backfill",
      targetKind: "memory",
      targetId: "m-back",
      text: "backfill text",
    });
    enqueueEmbedJob({
      tenantId: "t1",
      lane: "interactive",
      targetKind: "memory",
      targetId: "m-int",
      text: "interactive text",
    });
    const job = claimNextEmbedJob();
    expect(job?.target_id).toBe("m-int");
    expect(job?.lane).toBe("interactive");
  });

  it("round-robins tenants so a flood does not starve the other", () => {
    for (let i = 0; i < 5; i++) {
      enqueueEmbedJob({
        tenantId: "tenant-a",
        lane: "backfill",
        targetKind: "memory",
        targetId: `a-${i}`,
        text: `a ${i}`,
      });
    }
    enqueueEmbedJob({
      tenantId: "tenant-b",
      lane: "backfill",
      targetKind: "memory",
      targetId: "b-0",
      text: "b 0",
    });

    const first = claimNextEmbedJob();
    completeEmbedJob(first!.id);
    const second = claimNextEmbedJob();
    const tenants = new Set([first!.tenant_id, second!.tenant_id]);
    expect(tenants.has("tenant-a")).toBe(true);
    expect(tenants.has("tenant-b")).toBe(true);
  });
});
