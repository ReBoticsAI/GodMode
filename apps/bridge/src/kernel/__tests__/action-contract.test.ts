import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";
import {
  registerRecordAdapter,
  unregisterRecordAdapter,
} from "../adapter-registry.js";
import { registerObjectType } from "../registry.js";
import {
  cancelOperationRun,
  executeCollectionAction,
  executeRecordAction,
  KernelError,
  processClaimedOperationRun,
  recoverInterruptedOperationRuns,
} from "../record-api.js";
import {
  claimOperationRun,
  OperationRunWorker,
} from "../operation-run-worker.js";

const definition: ObjectTypeDef = {
  name: "ActionContractItem",
  label: "Action Contract Item",
  pluginId: "action-contract-tests",
  contractVersion: 1,
  storage: { kind: "adapter", adapterId: "action_contract_test_adapter" },
  fields: [
    { name: "id", label: "Id", fieldType: "Data" },
    { name: "updated_at", label: "Updated At", fieldType: "ReadOnly" },
  ],
  operations: ["list", "get"],
  permissions: [
    { role: "viewer", read: true },
    { role: "owner", read: true },
  ],
  actions: [
    {
      name: "publish",
      label: "Publish",
      target: "record",
      effect: "external",
      execution: "sync",
      roles: ["owner"],
      confirmation: { required: true, ttlSeconds: 60 },
      idempotency: { required: true, ttlSeconds: 60 },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string", minLength: 1 } },
        required: ["title"],
      },
      outputSchema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          token: { type: "string" },
        },
        required: ["ok", "token"],
      },
      sensitiveOutputPaths: ["token"],
    },
    {
      name: "rebuild",
      label: "Rebuild",
      target: "record",
      effect: "write",
      execution: "async",
      cancellable: true,
      roles: ["owner"],
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "reindex",
      label: "Reindex",
      target: "collection",
      effect: "write",
      execution: "sync",
      roles: ["owner"],
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "refresh",
      label: "Refresh",
      target: "record",
      effect: "write",
      execution: "async",
      cancellable: false,
      roles: ["owner"],
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "durable",
      label: "Durable",
      target: "record",
      effect: "external",
      execution: "async",
      cancellable: true,
      roles: ["owner"],
      idempotency: { required: true, ttlSeconds: 60 },
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "fails",
      label: "Fails",
      target: "record",
      effect: "write",
      execution: "async",
      cancellable: true,
      roles: ["owner"],
      idempotency: { required: true },
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "flaky",
      label: "Flaky",
      target: "record",
      effect: "write",
      execution: "async",
      cancellable: true,
      roles: ["owner"],
      retry: {
        maxAttempts: 2,
        backoffMs: 0,
        retryableErrorCodes: ["TEST_RETRY"],
      },
      idempotency: { required: true },
      errorSchema: {
        type: "object",
        required: ["code", "message", "retryable"],
      },
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "times_out",
      label: "Times Out",
      target: "record",
      effect: "write",
      execution: "async",
      cancellable: true,
      roles: ["owner"],
      idempotency: { required: true },
      timeoutMs: 1,
      inputSchema: { type: "object", additionalProperties: false },
    },
  ],
};

const owner = {
  tenantId: "tenant-action",
  userId: "user-action",
  role: "owner" as const,
  source: "http" as const,
  installedPluginIds: new Set(["action-contract-tests"]),
};
let flakyAttempts = 0;
let durableAttempts = 0;

function setup() {
  const db = new Database(":memory:");
  unregisterRecordAdapter("action_contract_test_adapter");
  flakyAttempts = 0;
  durableAttempts = 0;
  registerRecordAdapter({
    id: "action_contract_test_adapter",
    get(_db, def, id) {
      return {
        objectType: def.name,
        id,
        data: { id, updated_at: "v1" },
      };
    },
    actions: {
      publish() {
        return { ok: true, token: "do-not-expose" };
      },
      async rebuild() {
        await Promise.resolve();
        return { ok: true };
      },
      reindex() {
        return { ok: true };
      },
      refresh() {
        return { ok: true };
      },
      durable() {
        durableAttempts += 1;
        return { ok: true, attempt: durableAttempts };
      },
      fails() {
        throw new KernelError(422, "expected failure", {
          code: "TEST_FAILURE",
        });
      },
      flaky() {
        flakyAttempts += 1;
        if (flakyAttempts === 1) {
          throw new KernelError(503, "retry me", {
            code: "TEST_RETRY",
          });
        }
        return { ok: true };
      },
      async times_out() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true };
      },
    },
  });
  registerObjectType(definition);
  return db;
}

describe("ObjectType action contract", () => {
  it("rejects unsupported bulk adapter registration", () => {
    expect(() =>
      registerRecordAdapter({
        id: "unsupported_bulk_adapter",
        bulk() {
          return [];
        },
      } as never)
    ).toThrowError(/unsupported bulk operations/);
  });

  it("validates input, denies absent roles, binds confirmation, and redacts output", async () => {
    const db = setup();
    await expect(
      executeRecordAction(db, definition.name, "one", "publish", {}, {
        ...owner,
        idempotencyKey: "publish-one",
      })
    ).rejects.toMatchObject({ code: "KERNEL_SCHEMA_INVALID" });

    await expect(
      executeRecordAction(
        db,
        definition.name,
        "one",
        "publish",
        { title: "Ready" },
        { ...owner, role: "viewer", idempotencyKey: "publish-one" }
      )
    ).rejects.toMatchObject({ code: "KERNEL_ACTION_FORBIDDEN" });

    let confirmationId = "";
    try {
      await executeRecordAction(
        db,
        definition.name,
        "one",
        "publish",
        { title: "Ready" },
        { ...owner, idempotencyKey: "publish-one" }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(KernelError);
      expect(error).toMatchObject({ code: "KERNEL_CONFIRMATION_REQUIRED" });
      confirmationId = String(
        (error as KernelError).details &&
          ((error as KernelError).details as { confirmationId: string })
            .confirmationId
      );
    }
    await expect(
      executeRecordAction(
        db,
        definition.name,
        "one",
        "publish",
        { title: "Ready" },
        { ...owner, idempotencyKey: "publish-one", confirmationId }
      )
    ).resolves.toEqual({ ok: true, token: "[REDACTED]" });
    db.prepare(
      `UPDATE kernel_action_idempotency
       SET expires_at=datetime('now', '-1 second')`
    ).run();
    await expect(
      executeRecordAction(
        db,
        definition.name,
        "one",
        "publish",
        { title: "Ready" },
        { ...owner, idempotencyKey: "publish-one" }
      )
    ).rejects.toMatchObject({ code: "KERNEL_CONFIRMATION_REQUIRED" });
  });

  it("keeps async idempotency pending until successful worker commit", async () => {
    const db = setup();
    const accepted = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "durable",
      {},
      { ...owner, idempotencyKey: "durable-success" }
    )) as { operationRunId: string };
    expect(accepted.operationRunId).toBeTruthy();
    expect(
      db
        .prepare(
          `SELECT status, result_json, expires_at FROM kernel_action_idempotency
           WHERE key='durable-success'`
        )
        .get()
    ).toEqual({
      status: "pending",
      result_json: JSON.stringify({
        status: "accepted",
        operationRunId: accepted.operationRunId,
      }),
      expires_at: null,
    });
    await expect(
      executeRecordAction(db, definition.name, "one", "durable", {}, {
        ...owner,
        idempotencyKey: "durable-success",
      })
    ).resolves.toEqual(accepted);
    const run = claimOperationRun(db, "test-worker");
    expect(run?.id).toBe(accepted.operationRunId);
    await expect(
      executeRecordAction(db, definition.name, "one", "durable", {}, {
        ...owner,
        idempotencyKey: "durable-success",
      })
    ).resolves.toEqual(accepted);
    await processClaimedOperationRun(db, run!, "test-worker");
    const row = db
      .prepare(
        `SELECT status, result_json FROM kernel_operation_runs WHERE id=?`
      )
      .get(accepted.operationRunId);
    expect(row).toEqual({
      status: "succeeded",
      result_json: JSON.stringify({ ok: true, attempt: 1 }),
    });
    expect(
      db
        .prepare(
          `SELECT status, result_json, error_json, expires_at IS NOT NULL AS has_expiry
           FROM kernel_action_idempotency WHERE key='durable-success'`
        )
        .get()
    ).toEqual({
      status: "succeeded",
      result_json: JSON.stringify({ ok: true, attempt: 1 }),
      error_json: null,
      has_expiry: 1,
    });
    expect(durableAttempts).toBe(1);
  });

  it("reclaims interrupted runs through the durable worker", async () => {
    const db = setup();
    const accepted = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "durable",
      {},
      { ...owner, idempotencyKey: "restart-safe" }
    )) as { operationRunId: string };
    expect(claimOperationRun(db, "dead-worker")?.id).toBe(
      accepted.operationRunId
    );
    expect(recoverInterruptedOperationRuns(db)).toBe(1);
    const worker = new OperationRunWorker(
      () => [{ tenantId: owner.tenantId, db }],
      processClaimedOperationRun
    );
    expect(await worker.drainOnce()).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT status FROM kernel_operation_runs WHERE id=?`)
          .get(accepted.operationRunId) as { status: string }
      ).status
    ).toBe("succeeded");
    expect(
      (
        db
          .prepare(
            `SELECT status FROM kernel_action_idempotency
             WHERE key='restart-safe'`
          )
          .get() as { status: string }
      ).status
    ).toBe("succeeded");

    const unsafe = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "rebuild",
      {},
      { ...owner, idempotencyKey: "unsafe-restart" }
    )) as { operationRunId: string };
    expect(claimOperationRun(db, "dead-unsafe-worker")?.id).toBe(
      unsafe.operationRunId
    );
    expect(recoverInterruptedOperationRuns(db)).toBe(1);
    expect(
      db
        .prepare(
          `SELECT status, error_code FROM kernel_operation_runs WHERE id=?`
        )
        .get(unsafe.operationRunId)
    ).toEqual({ status: "failed", error_code: "KERNEL_REPLAY_UNSAFE" });
    expect(
      (
        db
          .prepare(
            `SELECT status FROM kernel_action_idempotency
             WHERE key='unsafe-restart'`
          )
          .get() as { status: string }
      ).status
    ).toBe("failed");
  });

  it("enforces action targets and cancellation declarations", async () => {
    const db = setup();
    await expect(
      executeRecordAction(db, definition.name, "one", "reindex", {}, owner)
    ).rejects.toMatchObject({ code: "KERNEL_ACTION_TARGET_MISMATCH" });
    await expect(
      executeCollectionAction(db, definition.name, "rebuild", {}, owner)
    ).rejects.toMatchObject({ code: "KERNEL_ACTION_TARGET_MISMATCH" });

    const accepted = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "refresh",
      {},
      owner
    )) as { operationRunId: string };
    expect(() =>
      cancelOperationRun(db, accepted.operationRunId, owner)
    ).toThrowError(/not cancellable/);

    const cancellable = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "durable",
      {},
      { ...owner, idempotencyKey: "cancel-durable" }
    )) as { operationRunId: string };
    expect(cancelOperationRun(db, cancellable.operationRunId, owner)).toBe(true);
    expect(
      db
        .prepare(
          `SELECT status FROM kernel_action_idempotency
           WHERE key='cancel-durable'`
        )
        .get()
    ).toEqual({ status: "cancelled" });
    await expect(
      executeRecordAction(db, definition.name, "one", "durable", {}, {
        ...owner,
        idempotencyKey: "cancel-durable",
      })
    ).rejects.toMatchObject({
      code: "KERNEL_IDEMPOTENT_ACTION_CANCELLED",
    });
  });

  it("tenant-binds confirmation and idempotency records", async () => {
    const db = setup();
    let confirmationId = "";
    try {
      await executeRecordAction(
        db,
        definition.name,
        "one",
        "publish",
        { title: "Ready" },
        { ...owner, idempotencyKey: "tenant-key" }
      );
    } catch (error) {
      confirmationId = String(
        (error as KernelError).details &&
          ((error as KernelError).details as { confirmationId: string })
            .confirmationId
      );
    }
    await expect(
      executeRecordAction(
        db,
        definition.name,
        "one",
        "publish",
        { title: "Ready" },
        {
          ...owner,
          tenantId: "other-tenant",
          idempotencyKey: "tenant-key",
          confirmationId,
        }
      )
    ).rejects.toMatchObject({ code: "KERNEL_CONFIRMATION_REQUIRED" });
  });

  it("finalizes idempotency when an async worker fails", async () => {
    const db = setup();
    const accepted = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "fails",
      {},
      { ...owner, idempotencyKey: "failed-run" }
    )) as { operationRunId: string };
    const run = claimOperationRun(db, "failure-worker");
    await processClaimedOperationRun(db, run!, "failure-worker");
    expect(
      db
        .prepare(
          `SELECT status, error_code FROM kernel_operation_runs WHERE id=?`
        )
        .get(accepted.operationRunId)
    ).toEqual({ status: "failed", error_code: "TEST_FAILURE" });
    expect(
      db
        .prepare(
          `SELECT status, error_json FROM kernel_action_idempotency
           WHERE key='failed-run'`
        )
        .get()
    ).toEqual({
      status: "failed",
      error_json: expect.stringContaining("TEST_FAILURE"),
    });
  });

  it("enforces retries, timeout, and terminal failure state", async () => {
    const db = setup();
    const flaky = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "flaky",
      {},
      { ...owner, idempotencyKey: "flaky-run" }
    )) as { operationRunId: string };
    const first = claimOperationRun(db, "retry-worker");
    await processClaimedOperationRun(db, first!, "retry-worker");
    expect(
      (
        db
          .prepare(`SELECT status FROM kernel_operation_runs WHERE id=?`)
          .get(flaky.operationRunId) as { status: string }
      ).status
    ).toBe("retrying");
    expect(
      (
        db
          .prepare(
            `SELECT status FROM kernel_action_idempotency WHERE key='flaky-run'`
          )
          .get() as { status: string }
      ).status
    ).toBe("pending");
    const second = claimOperationRun(db, "retry-worker");
    await processClaimedOperationRun(db, second!, "retry-worker");
    expect(
      (
        db
          .prepare(`SELECT status, attempt FROM kernel_operation_runs WHERE id=?`)
          .get(flaky.operationRunId) as { status: string; attempt: number }
      )
    ).toEqual({ status: "succeeded", attempt: 2 });
    expect(
      (
        db
          .prepare(
            `SELECT status FROM kernel_action_idempotency WHERE key='flaky-run'`
          )
          .get() as { status: string }
      ).status
    ).toBe("succeeded");

    const timed = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "times_out",
      {},
      { ...owner, idempotencyKey: "timeout-run" }
    )) as { operationRunId: string };
    const timeoutRun = claimOperationRun(db, "timeout-worker");
    await processClaimedOperationRun(db, timeoutRun!, "timeout-worker");
    expect(
      db
        .prepare(
          `SELECT status, error_code FROM kernel_operation_runs WHERE id=?`
        )
        .get(timed.operationRunId)
    ).toEqual({ status: "failed", error_code: "KERNEL_ACTION_TIMEOUT" });
    expect(
      db
        .prepare(
          `SELECT status, error_json FROM kernel_action_idempotency
           WHERE key='timeout-run'`
        )
        .get()
    ).toEqual({
      status: "failed",
      error_json: expect.stringContaining("KERNEL_ACTION_TIMEOUT"),
    });
  });

  it("commits core adapter writes with core audit and outbox ownership", async () => {
    const tenant = new Database(":memory:");
    const core = new Database(":memory:");
    core.exec(`
      CREATE TABLE core_owned_items (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      INSERT INTO core_owned_items VALUES ('one', 'ready');
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT,
        tenant_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const coreDefinition: ObjectTypeDef = {
      name: "CoreOwnedActionItem",
      label: "Core Owned Action Item",
      pluginId: "action-contract-tests",
      database: "core",
      storage: { kind: "adapter", adapterId: "core_owned_action_test" },
      fields: [{ name: "id", label: "Id", fieldType: "Data" }],
      operations: ["get"],
      permissions: [{ role: "owner", read: true }],
      actions: [
        {
          name: "activate",
          label: "Activate",
          target: "record",
          effect: "write",
          execution: "sync",
          roles: ["owner"],
          inputSchema: { type: "object", additionalProperties: false },
        },
      ],
    };
    unregisterRecordAdapter("core_owned_action_test");
    registerRecordAdapter({
      id: "core_owned_action_test",
      get(db, def, id) {
        const row = db.prepare(`SELECT * FROM core_owned_items WHERE id=?`).get(id) as
          | { id: string; state: string }
          | undefined;
        return row
          ? { id, objectType: def.name, data: { id, state: row.state } }
          : null;
      },
      actions: {
        activate(db, _def, id) {
          db.prepare(`UPDATE core_owned_items SET state='active' WHERE id=?`).run(id);
          return { ok: true };
        },
      },
    });
    registerObjectType(coreDefinition);

    await executeRecordAction(tenant, coreDefinition.name, "one", "activate", {}, {
      ...owner,
      data: { tenantDb: tenant, coreDb: core, declaredDatabase: "core" },
    });

    expect(core.prepare(`SELECT state FROM core_owned_items WHERE id='one'`).get()).toEqual({
      state: "active",
    });
    expect(core.prepare(`SELECT count(*) AS n FROM platform_action_log`).get()).toEqual({
      n: 1,
    });
    expect(core.prepare(`SELECT count(*) AS n FROM events`).get()).toEqual({ n: 1 });
    expect(
      tenant
        .prepare(
          `SELECT count(*) AS n FROM sqlite_master
           WHERE type='table' AND name IN ('platform_action_log', 'events')`
        )
        .get()
    ).toEqual({ n: 0 });
  });
});
