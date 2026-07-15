import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";
import {
  registerRecordAdapter,
  unregisterRecordAdapter,
} from "../adapter-registry.js";
import { registerObjectType } from "../registry.js";
import {
  executeRecordAction,
  KernelError,
} from "../record-api.js";

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
      idempotency: { required: true },
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
  ],
};

const owner = {
  tenantId: "tenant-action",
  userId: "user-action",
  role: "owner" as const,
  source: "http" as const,
  installedPluginIds: new Set(["action-contract-tests"]),
};

function setup() {
  const db = new Database(":memory:");
  unregisterRecordAdapter("action_contract_test_adapter");
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
    },
  });
  registerObjectType(definition);
  return db;
}

describe("ObjectType action contract", () => {
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
  });

  it("returns a durable OperationRun for asynchronous actions", async () => {
    const db = setup();
    const accepted = (await executeRecordAction(
      db,
      definition.name,
      "one",
      "rebuild",
      {},
      owner
    )) as { operationRunId: string };
    expect(accepted.operationRunId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const row = db
      .prepare(`SELECT status FROM kernel_operation_runs WHERE id=?`)
      .get(accepted.operationRunId) as { status: string };
    expect(row.status).toBe("succeeded");
  });
});
