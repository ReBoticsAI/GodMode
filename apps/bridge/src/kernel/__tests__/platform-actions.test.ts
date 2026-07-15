import Database from "better-sqlite3";
import type { ObjectTypeDef } from "@godmode/kernel";
import { describe, expect, it } from "vitest";
import type { OperationContext } from "../adapter-registry.js";
import {
  bridgeConnectionAdapter,
  catalogSourceAdapter,
  financeConnectionAdapter,
  peerConnectionAdapter,
  platformActionAdapterRegistrations,
} from "../adapters/platform-actions.js";

function definition(name: string, fields: string[]): ObjectTypeDef {
  return {
    name,
    label: name,
    labelPlural: `${name}s`,
    module: "test",
    database: "core",
    storage: { kind: "adapter", adapterId: "test" },
    fields: fields.map((field) => ({
      name: field,
      label: field,
      fieldType: "Data",
    })),
    permissions: [{ role: "owner", read: true, create: true, delete: true }],
    operations: ["list", "get", "create", "delete"],
    contractVersion: 1,
    schemaVersion: 1,
  };
}

function context(
  core: Database.Database,
  overrides: Partial<OperationContext> = {}
): OperationContext {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    role: "owner",
    source: "http",
    data: {
      coreDb: core,
      tenantDb: core,
      declaredDatabase: "core",
    },
    ...overrides,
  };
}

describe("platform action adapters", () => {
  it("reports stable registration IDs and named actions", () => {
    expect(platformActionAdapterRegistrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapterId: "share_grant_read",
          actions: expect.arrayContaining(["grant", "revoke"]),
        }),
        expect.objectContaining({
          adapterId: "dm_message_read",
          actions: ["send"],
        }),
        expect.objectContaining({
          adapterId: "marketplace_listing_read",
          actions: expect.arrayContaining(["acquire_live", "publish", "archive"]),
        }),
        expect.objectContaining({
          adapterId: "finance_connection_service",
          actions: expect.arrayContaining(["add_manual", "connect_external"]),
        }),
      ])
    );
  });

  it("scopes catalog sources to the authenticated user", () => {
    const db = new Database(":memory:");
    const def = definition("CatalogSource", [
      "id",
      "user_id",
      "name",
      "url",
      "created_at",
    ]);
    const ctxA = context(db);
    const ctxB = context(db, { userId: "user-b" });

    const source = catalogSourceAdapter.create!(db, def, {
      name: "Private",
      url: "https://catalog.example/index.json",
    }, ctxA);

    expect(catalogSourceAdapter.list!(db, def, {}, ctxA).total).toBe(1);
    expect(catalogSourceAdapter.list!(db, def, {}, ctxB).total).toBe(0);
    expect(catalogSourceAdapter.get!(db, def, source.id, ctxB)).toBeNull();
    expect(() =>
      catalogSourceAdapter.actions!.remove(db, def, source.id, {}, ctxB)
    ).toThrow(/not found/i);
  });

  it("prevents cross-tenant bridge reads and mutations", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE bridge_connections (
        id TEXT PRIMARY KEY,
        owner_tenant_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        mode TEXT NOT NULL,
        remote_bridge_url TEXT,
        remote_bridge_token TEXT,
        status TEXT NOT NULL,
        last_seen_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const def = definition("BridgeConnection", [
      "id",
      "owner_tenant_id",
      "owner_user_id",
      "label",
      "mode",
      "remote_bridge_url",
      "status",
      "last_seen_at",
      "created_at",
      "updated_at",
    ]);
    const ctxA = context(db);
    const ctxB = context(db, { tenantId: "tenant-b", userId: "user-b" });

    const connection = bridgeConnectionAdapter.create!(db, def, {
      label: "Local",
      mode: "local",
    }, ctxA);

    expect(bridgeConnectionAdapter.get!(db, def, connection.id, ctxB)).toBeNull();
    expect(() =>
      bridgeConnectionAdapter.delete!(db, def, connection.id, ctxB)
    ).toThrow(/not found/i);
    expect(bridgeConnectionAdapter.get!(db, def, connection.id, ctxA)).not.toBeNull();
  });

  it("keeps peer network operations explicit and disabled", () => {
    const db = new Database(":memory:");
    expect(() =>
      peerConnectionAdapter.actions!.invite(
        db,
        definition("PeerConnection", ["id"]),
        "",
        {},
        context(db)
      )
    ).toThrow(/not available through the kernel/i);
  });

  it("supports only local manual finance connection operations", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE holdings_connections (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        currency TEXT NOT NULL,
        reference TEXT,
        status TEXT NOT NULL,
        external_id TEXT,
        balance REAL NOT NULL,
        balance_cad REAL NOT NULL,
        breakdown_json TEXT,
        last_synced_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE holdings_balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT NOT NULL,
        balance REAL NOT NULL,
        currency TEXT NOT NULL,
        balance_cad REAL NOT NULL,
        raw_json TEXT,
        as_of TEXT NOT NULL
      );
    `);
    const def = definition("FinanceConnection", [
      "id",
      "category",
      "provider",
      "label",
      "currency",
      "balance",
      "balance_cad",
      "status",
    ]);
    const ctx = context(db);

    const created = financeConnectionAdapter.actions!.add_manual(
      db,
      def,
      "",
      {
        category: "manual",
        provider: "manual",
        label: "Cash",
        currency: "CAD",
        balance: 25,
        balance_cad: 25,
      },
      ctx
    ) as { id: string };

    expect(financeConnectionAdapter.get!(db, def, created.id, ctx)?.data).toMatchObject({
      label: "Cash",
      balance: 25,
      balance_cad: 25,
    });
    expect(() =>
      financeConnectionAdapter.actions!.connect_external(db, def, "", {}, ctx)
    ).toThrow(/not available through the kernel/i);
  });
});
