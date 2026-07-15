import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";
import { validateObjectTypeDef } from "@godmode/kernel";
import {
  getRecordAdapter,
  type RecordOperation,
} from "../adapter-registry.js";
import {
  assertCoreObjectTypeBootstrapComplete,
  CORE_OBJECT_TYPE_NAMES,
  registerCoreObjectTypes,
} from "../core-object-types.js";
import { createSqlReadAdapter } from "../adapters/sql-read.js";
import { listObjectTypes } from "../registry.js";

const RECORD_OPERATIONS: RecordOperation[] = [
  "list",
  "get",
  "create",
  "update",
  "delete",
];

describe("production core ObjectType bootstrap", () => {
  it("registers the exact complete core declaration set", () => {
    registerCoreObjectTypes();
    expect(assertCoreObjectTypeBootstrapComplete).not.toThrow();
    expect(
      listObjectTypes()
        .filter((def) => !def.pluginId)
        .map((def) => def.name)
        .sort()
    ).toEqual(["StructureNode", ...CORE_OBJECT_TYPE_NAMES].sort());
  });

  it("has exact declaration-handler parity and valid schemas", () => {
    registerCoreObjectTypes();
    for (const def of listObjectTypes().filter((candidate) => !candidate.pluginId)) {
      expect(validateObjectTypeDef(def), def.name).toEqual([]);
      expect(def.database ?? "tenant", `${def.name} database ownership`).toMatch(
        /^(tenant|core)$/
      );
      expect(def.accessPolicy, `${def.name} access policy`).toBeTruthy();
      for (const action of def.actions ?? []) {
        expect(action.roles.length, `${def.name}.${action.name} authorization`).toBeGreaterThan(0);
        expect(action.inputSchema, `${def.name}.${action.name} input schema`).toMatchObject({
          type: "object",
        });
      }
      expect(def.storage.kind, def.name).toBe("adapter");
      if (def.storage.kind !== "adapter") continue;

      const adapter = getRecordAdapter(def.storage.adapterId);
      expect(adapter, `${def.name} production adapter`).toBeDefined();
      expect(
        RECORD_OPERATIONS.filter(
          (operation) => typeof adapter?.[operation] === "function"
        ).sort(),
        `${def.name} CRUD handlers`
      ).toEqual([...(def.operations ?? [])].sort());
      expect(
        Object.keys(adapter?.actions ?? {}).sort(),
        `${def.name} action handlers`
      ).toEqual((def.actions ?? []).map((action) => action.name).sort());
    }
  });

  it("uses the database handle selected by declared ownership", () => {
    const selectedCore = new Database(":memory:");
    selectedCore.exec(`
      CREATE TABLE owned_rows (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO owned_rows VALUES ('core-row', 'authoritative');
    `);
    const def: ObjectTypeDef = {
      name: "OwnershipProbe",
      label: "Ownership Probe",
      database: "core",
      accessPolicy: "platform-admin",
      storage: { kind: "adapter", adapterId: "ownership_probe" },
      fields: [
        { name: "id", label: "Id", fieldType: "Data" },
        { name: "value", label: "Value", fieldType: "Data" },
      ],
      operations: ["list", "get"],
      permissions: [{ role: "owner", read: true }],
    };
    const adapter = createSqlReadAdapter({
      id: "ownership_probe",
      table: "owned_rows",
      database: "core",
    });

    expect(
      adapter.get!(
        selectedCore,
        def,
        "core-row",
        { role: "owner", source: "system" }
      )?.data.value
    ).toBe("authoritative");
    selectedCore.close();
  });
});
