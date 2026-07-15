import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";
import {
  createRecord,
  deleteRecord,
  getRecord,
  KernelError,
  listRecords,
  seedRecords,
  updateRecord,
} from "../record-api.js";
import { registerObjectType } from "../registry.js";
import { setKernelEventBus } from "../adapter-registry.js";

const def: ObjectTypeDef = {
  name: "KernelTestItem",
  label: "Kernel Test Item",
  pluginId: "kernel-test-plugin",
  storage: { kind: "native" },
  operations: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "id", label: "Id", fieldType: "Data", required: true },
    { name: "title", label: "Title", fieldType: "Data", required: true },
    {
      name: "status",
      label: "Status",
      fieldType: "Select",
      options: ["open", "done"],
      default: "open",
    },
    { name: "checked", label: "Checked", fieldType: "Check" },
    { name: "meta", label: "Metadata", fieldType: "JSON" },
  ],
  permissions: [
    { role: "viewer", read: true },
    {
      role: "owner",
      read: true,
      create: true,
      update: true,
      delete: true,
    },
  ],
};

const owner = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "owner" as const,
  source: "http" as const,
  installedPluginIds: new Set(["kernel-test-plugin"]),
};

describe("record API", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    registerObjectType(def);
  });

  it("supports native CRUD, pagination, defaults, and JSON/Check round trips", () => {
    const created = createRecord(
      db,
      def.name,
      { id: "one", title: "One", checked: true, meta: { answer: 42 } },
      owner
    );
    expect(created.data.status).toBe("open");
    expect(getRecord(db, def.name, "one", owner).data).toMatchObject({
      checked: true,
      meta: { answer: 42 },
    });
    expect(created.version).toBe("1");
    const updated = updateRecord(
      db,
      def.name,
      "one",
      { status: "done" },
      { ...owner, expectedVersion: created.version }
    );
    expect(updated.version).toBe("2");
    expect(() =>
      updateRecord(
        db,
        def.name,
        "one",
        { status: "open" },
        { ...owner, expectedVersion: created.version }
      )
    ).toThrowError(/version conflict/);
    createRecord(db, def.name, { id: "two", title: "Two" }, owner);
    expect(
      listRecords(
        db,
        def.name,
        { limit: 1, offset: 1, sort: "id", direction: "desc" },
        owner
      )
    ).toMatchObject({
      total: 2,
      records: [{ id: "one" }],
    });
    deleteRecord(db, def.name, "one", owner);
    expect(() => getRecord(db, def.name, "one", owner)).toThrowError(KernelError);
  });

  it("enforces visibility, permissions, fields, and Select values", () => {
    expect(() =>
      listRecords(db, def.name, {}, { ...owner, installedPluginIds: new Set() })
    ).toThrowError(/Unknown ObjectType/);
    expect(() =>
      createRecord(db, def.name, { id: "x", title: "X" }, {
        ...owner,
        role: "viewer",
      })
    ).toThrowError(/cannot create/);
    expect(() =>
      createRecord(db, def.name, { id: "x", title: "X", unknown: true }, owner)
    ).toThrowError(/Unknown field/);
    expect(() =>
      createRecord(db, def.name, { id: "x", title: "X", status: "invalid" }, owner)
    ).toThrowError(/Invalid Status/);
  });

  it("applies seeds transactionally and idempotently", () => {
    const seeds = [{ objectType: def.name, data: { id: "seed", title: "First" } }];
    seedRecords(db, seeds, owner);
    seedRecords(db, [{ ...seeds[0], data: { id: "seed", title: "Updated" } }], owner);
    expect(getRecord(db, def.name, "seed", owner).data.title).toBe("Updated");
  });

  it("reconciles additive native schema changes", () => {
    createRecord(db, def.name, { id: "before", title: "Before" }, owner);
    registerObjectType({
      ...def,
      schemaVersion: 2,
      fields: [
        ...def.fields,
        {
          name: "priority",
          label: "Priority",
          fieldType: "Int",
          required: true,
          default: 1,
        },
      ],
    });
    createRecord(
      db,
      def.name,
      { id: "after", title: "After", priority: 2 },
      owner
    );
    expect(getRecord(db, def.name, "after", owner).data.priority).toBe(2);
  });

  it("propagates Structure mutation events", () => {
    db.exec(`
      CREATE TABLE structure_nodes (
        id TEXT PRIMARY KEY, parent_id TEXT, label TEXT NOT NULL, icon TEXT NOT NULL,
        segment TEXT NOT NULL, kind TEXT NOT NULL, object_type TEXT, right_sidebar TEXT,
        agent_id TEXT, built_in INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0, tabs_json TEXT
      )
    `);
    const bus = new EventEmitter();
    const seen: unknown[] = [];
    bus.on("structure.node.created", (event) => seen.push(event));
    setKernelEventBus(bus);
    createRecord(
      db,
      "StructureNode",
      {
        id: "test-page",
        label: "Test Page",
        icon: "folder",
        kind: "placeholder",
      },
      owner
    );
    expect(seen).toEqual([{ nodeId: "test-page" }]);
  });

  it("propagates generic mutation reconciliation events", () => {
    const bus = new EventEmitter();
    const seen: unknown[] = [];
    bus.on("object.record.created", (event) => seen.push(event));
    createRecord(
      db,
      def.name,
      { id: "event-row", title: "Event Row" },
      { ...owner, bus, userId: "user-a" }
    );
    expect(seen).toEqual([
      expect.objectContaining({
        objectType: def.name,
        recordId: "event-row",
        tenantId: "tenant-a",
        actorId: "user-a",
        source: "http",
      }),
    ]);
  });
});
