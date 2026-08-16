import Database from "better-sqlite3";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";
import {
  registerRecordAdapter,
  unregisterRecordAdapter,
} from "../adapter-registry.js";
import { registerCoreObjectTypes } from "../core-object-types.js";
import {
  executeCollectionAction,
  getRecord,
  KernelError,
  listRecords,
  processClaimedOperationRun,
} from "../record-api.js";
import {
  claimOperationRun,
  ensureOperationRunTables,
} from "../operation-run-worker.js";
import { registerObjectType, unregisterObjectType } from "../registry.js";

const owner = {
  tenantId: "tenant-receipt",
  userId: "user-receipt",
  role: "owner" as const,
  source: "http" as const,
};

const cloudInstall: ObjectTypeDef = {
  name: "CloudAsyncInstall",
  label: "Cloud Async Install",
  database: "cloud",
  contractVersion: 1,
  storage: { kind: "adapter", adapterId: "cloud_async_install_test" },
  fields: [{ name: "id", label: "Id", fieldType: "Data" }],
  operations: ["list", "get"],
  permissions: [{ role: "owner", read: true }],
  actions: [
    {
      name: "install_entry",
      label: "Install Entry",
      target: "collection",
      effect: "external",
      execution: "async",
      cancellable: false,
      roles: ["owner"],
      idempotency: { required: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { entry_id: { type: "string" } },
        required: ["entry_id"],
      },
    },
  ],
};

describe("async OperationRun receipts", () => {
  beforeAll(() => registerCoreObjectTypes());

  afterEach(() => {
    unregisterObjectType(cloudInstall.name);
    unregisterRecordAdapter("cloud_async_install_test");
  });

  it("queues cloud-scoped async actions on the tenant OperationRun database", async () => {
    const tenant = new Database(":memory:");
    const core = new Database(":memory:");
    ensureOperationRunTables(tenant);
    ensureOperationRunTables(core);
    unregisterRecordAdapter("cloud_async_install_test");
    registerRecordAdapter({
      id: "cloud_async_install_test",
      actions: {
        install_entry() {
          return { ok: true, pluginId: "workspace-pulse" };
        },
      },
    });
    registerObjectType(cloudInstall);

    const accepted = (await executeCollectionAction(
      tenant,
      cloudInstall.name,
      "install_entry",
      { entry_id: "workspace-pulse" },
      {
        ...owner,
        idempotencyKey: "install-pulse",
        data: { tenantDb: tenant, cloudDb: core, declaredDatabase: "cloud" },
      }
    )) as { status: string; operationRunId: string };

    expect(accepted.status).toBe("accepted");
    expect(
      core.prepare(`SELECT count(*) AS n FROM kernel_operation_runs`).get()
    ).toEqual({ n: 0 });
    expect(
      tenant
        .prepare(
          `SELECT id, object_type, tenant_id FROM kernel_operation_runs WHERE id=?`
        )
        .get(accepted.operationRunId)
    ).toEqual({
      id: accepted.operationRunId,
      object_type: "CloudAsyncInstall",
      tenant_id: owner.tenantId,
    });

    const row = getRecord(tenant, "OperationRun", accepted.operationRunId, {
      ...owner,
      data: { tenantDb: tenant, cloudDb: core },
    });
    expect(row.id).toBe(accepted.operationRunId);
    expect(row.data.object_type).toBe("CloudAsyncInstall");

    const run = claimOperationRun(tenant, "receipt-worker");
    expect(run?.id).toBe(accepted.operationRunId);
    await processClaimedOperationRun(tenant, run!, "receipt-worker");
    expect(
      tenant
        .prepare(`SELECT status FROM kernel_operation_runs WHERE id=?`)
        .get(accepted.operationRunId)
    ).toEqual({ status: "succeeded" });

    const waited = getRecord(tenant, "OperationRun", accepted.operationRunId, {
      ...owner,
      data: { tenantDb: tenant, cloudDb: core },
    });
    expect(waited.data.status).toBe("succeeded");
    tenant.close();
    core.close();
  });

  it("scopes OperationRun list/get to the caller tenant, including Intelligence", () => {
    const db = new Database(":memory:");
    ensureOperationRunTables(db);
    db.prepare(
      `INSERT INTO kernel_operation_runs
         (id, tenant_id, actor_id, object_type, action_name, status)
       VALUES (?, ?, 'user', 'CatalogInstall', 'install_entry', 'pending')`
    ).run("run-a", "tenant-receipt");
    db.prepare(
      `INSERT INTO kernel_operation_runs
         (id, tenant_id, actor_id, object_type, action_name, status)
       VALUES (?, ?, 'user', 'CatalogInstall', 'install_entry', 'pending')`
    ).run("run-b", "other-tenant");

    const listed = listRecords(
      db,
      "OperationRun",
      {},
      {
        ...owner,
        role: "intelligence",
        data: { tenantDb: db },
      }
    );
    expect(listed.records.map((row) => row.id).sort()).toEqual(["run-a"]);

    expect(
      getRecord(db, "OperationRun", "run-a", {
        ...owner,
        role: "intelligence",
        data: { tenantDb: db },
      }).id
    ).toBe("run-a");
    expect(() =>
      getRecord(db, "OperationRun", "run-b", {
        ...owner,
        role: "intelligence",
        data: { tenantDb: db },
      })
    ).toThrow(KernelError);
    db.close();
  });
});
