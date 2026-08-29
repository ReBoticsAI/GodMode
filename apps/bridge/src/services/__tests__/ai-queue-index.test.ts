/**
 * Cloud ai_queue_index discovery (#737): dual-write + no poll-all on hot path.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsDir, cloudDbPath } = vi.hoisted(() => {
  const f = require("node:fs") as typeof import("node:fs");
  const o = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const root = f.mkdtempSync(p.join(o.tmpdir(), "gm-ai-queue-index-"));
  return {
    tmpRoot: root,
    tenantsDir: p.join(root, "tenants"),
    cloudDbPath: p.join(root, "core.sqlite"),
  };
});

vi.mock("../../config.js", async () => {
  const actual = await vi.importActual<typeof import("../../config.js")>(
    "../../config.js"
  );
  return {
    ...actual,
    config: {
      ...actual.config,
      dataDir: tmpRoot,
      tenantsDir,
      cloudDbPath,
      ai: {
        ...actual.config.ai,
        queueStaleRunningMinutes: 30,
      },
    },
  };
});

import { getCloudDb } from "../../core-db.js";
import {
  closeAllTenantDbs,
  evictTenantDb,
  getTenantDb,
} from "../../tenant-registry.js";
import type { LlmManager } from "../llm-manager.js";
import { AiQueueWorker } from "../ai-queue-worker.js";
import {
  AI_QUEUE_WAKE_EVENT,
  backfillAiQueueIndexFromTenants,
  hasPendingOrRunningIndex,
  hasPendingOrRunningWorkflowIndex,
  markAiQueueIndexDone,
  nextPendingIndexRow,
  upsertAiQueueIndex,
} from "../ai-queue-index.js";

function seedUser(userId: string): void {
  getCloudDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, is_admin)
       VALUES (?, ?, ?, 0)`
    )
    .run(userId, `${userId}@example.com`, userId);
}

function seedTenant(tenantId: string, ownerUserId: string): void {
  getCloudDb()
    .prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, is_operator, owner_user_id)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(tenantId, tenantId, `${tenantId}-slug`, ownerUserId);
  getTenantDb(tenantId);
}

function stubLlm(): LlmManager {
  return {
    isReady: () => false,
    getSamplingParams: () => ({
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      minP: 0,
      repeatPenalty: 1.1,
      maxTokens: 0,
    }),
    getEnabledAdapterPaths: () => [],
    getServerBaseUrl: () => "http://127.0.0.1:9",
  } as unknown as LlmManager;
}

describe("ai_queue_index", () => {
  const tenantIds: string[] = [];

  beforeEach(() => {
    fs.mkdirSync(tenantsDir, { recursive: true });
    // Ensure Cloud schema (incl. ai_queue_index v22) exists.
    getCloudDb();
  });

  afterEach(() => {
    closeAllTenantDbs();
    for (const id of tenantIds.splice(0)) {
      try {
        evictTenantDb(id);
      } catch {
        /* ignore */
      }
    }
    try {
      getCloudDb().prepare(`DELETE FROM ai_queue_index`).run();
    } catch {
      /* ignore */
    }
  });

  it("discovers the highest-priority pending index row without scanning tenants", () => {
    upsertAiQueueIndex({
      jobId: "low",
      tenantId: "t-a",
      status: "pending",
      priority: 1,
    });
    upsertAiQueueIndex({
      jobId: "high",
      tenantId: "t-b",
      status: "pending",
      priority: 5,
      workflowId: "wf-1",
    });
    const next = nextPendingIndexRow();
    expect(next?.job_id).toBe("high");
    expect(next?.tenant_id).toBe("t-b");
    expect(hasPendingOrRunningIndex()).toBe(true);
    expect(hasPendingOrRunningWorkflowIndex("wf-1")).toBe(true);
    expect(hasPendingOrRunningWorkflowIndex("missing")).toBe(false);
  });

  it("stops reporting pending after mark done", () => {
    upsertAiQueueIndex({
      jobId: "j1",
      tenantId: "t1",
      status: "pending",
      priority: 0,
    });
    markAiQueueIndexDone("j1");
    expect(nextPendingIndexRow()).toBeNull();
    expect(hasPendingOrRunningIndex()).toBe(false);
  });

  it("enqueue dual-writes workspace + Cloud index and emits wake", () => {
    const owner = "owner-user";
    seedUser(owner);
    const tenantId = "tenant-job";
    tenantIds.push(tenantId);
    seedTenant(tenantId, owner);

    const bus = new EventEmitter();
    let wakes = 0;
    bus.on(AI_QUEUE_WAKE_EVENT, () => {
      wakes += 1;
    });

    const worker = new AiQueueWorker(getTenantDb(tenantId), stubLlm(), { bus });
    const jobId = worker.enqueue({
      prompt: "hello",
      priority: 3,
      tenantId,
      workflowId: "demo-wf",
    });

    const workspace = getTenantDb(tenantId)
      .prepare(`SELECT id, status, priority, tenant_id FROM ai_prompt_queue WHERE id = ?`)
      .get(jobId) as {
      id: string;
      status: string;
      priority: number;
      tenant_id: string;
    };
    expect(workspace.status).toBe("pending");
    expect(workspace.priority).toBe(3);
    expect(workspace.tenant_id).toBe(tenantId);

    const index = getCloudDb()
      .prepare(
        `SELECT job_id, tenant_id, status, priority, workflow_id FROM ai_queue_index WHERE job_id = ?`
      )
      .get(jobId) as {
      job_id: string;
      tenant_id: string;
      status: string;
      priority: number;
      workflow_id: string;
    };
    expect(index.tenant_id).toBe(tenantId);
    expect(index.status).toBe("pending");
    expect(index.priority).toBe(3);
    expect(index.workflow_id).toBe("demo-wf");
    expect(wakes).toBe(1);
    expect(worker.hasPendingOrRunning()).toBe(true);
    expect(worker.hasPendingOrRunningWorkflow("demo-wf")).toBe(true);
  });

  it("backfill copies pending workspace rows into Cloud index", () => {
    const owner = "owner-user";
    seedUser(owner);
    for (let i = 0; i < 9; i += 1) {
      const id = `tenant-empty-${i}`;
      tenantIds.push(id);
      seedTenant(id, owner);
    }
    const active = "tenant-active";
    tenantIds.push(active);
    seedTenant(active, owner);

    const jobId = "orphan-pending";
    getTenantDb(active)
      .prepare(
        `INSERT INTO ai_prompt_queue
           (id, status, priority, workflow_id, adapter_ids_json, prompt, context_json, tenant_id)
         VALUES (?, 'pending', 2, NULL, NULL, 'x', NULL, ?)`
      )
      .run(jobId, active);

    expect(nextPendingIndexRow()).toBeNull();

    const { upserted } = backfillAiQueueIndexFromTenants(
      tenantIds.map((tenantId) => ({ tenantId, db: getTenantDb(tenantId) }))
    );
    expect(upserted).toBe(1);
    const next = nextPendingIndexRow();
    expect(next?.job_id).toBe(jobId);
    expect(next?.tenant_id).toBe(active);
  });
});
