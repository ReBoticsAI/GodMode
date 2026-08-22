import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  createDomainItemsAdapter,
  ensureDomainItemsTable,
} from "../../../data/scaffolds/plugin-domain/src/domain-sqlite-ot.js";

describe("domain SQLite ObjectType adapter (#654)", () => {
  it("supports create/list/get/update/delete against plugin SQLite", () => {
    const db = new Database(":memory:");
    ensureDomainItemsTable(db);

    const adapter = createDomainItemsAdapter({
      objectTypeName: "DemoDomainItem",
      openDb: () => db,
    });

    const ctx = {
      tenantId: "tenant-a",
      role: "owner" as const,
      source: "plugin" as const,
    };

    const created = adapter.create!({ title: "First", body: "hello" }, ctx);
    expect(created.id).toBeTruthy();
    expect(created.data.title).toBe("First");
    expect(created.objectType).toBe("DemoDomainItem");

    const listed = adapter.list!({ limit: 10 }, ctx);
    expect(listed.total).toBe(1);
    expect(listed.records[0]?.data.title).toBe("First");

    const got = adapter.get!(created.id, ctx);
    expect(got?.data.body).toBe("hello");

    const updated = adapter.update!(created.id, { body: "updated" }, ctx);
    expect(updated.data.body).toBe("updated");
    expect(updated.data.title).toBe("First");

    adapter.delete!(created.id, ctx);
    expect(adapter.get!(created.id, ctx)).toBeNull();
    expect(adapter.list!({}, ctx).total).toBe(0);

    db.close();
  });
});
