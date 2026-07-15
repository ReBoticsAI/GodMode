import Database from "better-sqlite3";
import type { ObjectTypeDef } from "@godmode/kernel";
import { describe, expect, it } from "vitest";
import type { OperationContext } from "../adapter-registry.js";
import {
  bridgeConnectionAdapter,
  catalogSourceAdapter,
  financeConnectionAdapter,
  marketplaceListingAdapter,
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
    expect(platformActionAdapterRegistrations).toEqual([
      {
        objectType: "ShareGrant",
        adapterId: "share_grant_read",
        actions: ["grant", "revoke", "share_model", "clone_shared"],
      },
      {
        objectType: "FederatedShareInvite",
        adapterId: "federated_share_invite_service",
        actions: ["accept"],
      },
      {
        objectType: "DirectConversation",
        adapterId: "dm_conversation_read",
        actions: ["start", "mark_read", "add_member", "remove_member", "share"],
      },
      {
        objectType: "DirectMessage",
        adapterId: "dm_message_read",
        actions: ["send"],
      },
      {
        objectType: "DmBlob",
        adapterId: "dm_blob_service",
        actions: ["upload"],
      },
      {
        objectType: "SupportTicket",
        adapterId: "support_ticket_read",
        actions: ["open", "reply", "set_status"],
      },
      {
        objectType: "SupportMessage",
        adapterId: "support_message_read",
        actions: ["reply"],
      },
      {
        objectType: "CatalogSource",
        adapterId: "catalog_source_read",
        actions: ["add", "remove", "fetch_external"],
      },
      {
        objectType: "CatalogInstall",
        adapterId: "catalog_install_read",
        actions: [
          "activate_plugin_path",
          "install_entry",
          "install_plugin",
          "register_local_plugin",
          "unregister_local_plugin",
          "uninstall_plugin",
          "load_runtime",
          "reconcile_runtime",
        ],
      },
      {
        objectType: "MarketplaceListing",
        adapterId: "marketplace_listing_read",
        actions: [
          "acquire",
          "acquire_live",
          "publish",
          "archive",
          "export_portable",
          "import_portable",
        ],
      },
      {
        objectType: "MarketplaceEntitlement",
        adapterId: "marketplace_entitlement_read",
        actions: ["cancel"],
      },
      {
        objectType: "BridgeConnection",
        adapterId: "bridge_connection_read",
        actions: ["register", "touch", "probe_remote"],
      },
      {
        objectType: "PeerConnection",
        adapterId: "peer_connection_read",
        actions: ["enable_tailscale", "invite", "accept", "refresh_health"],
      },
      {
        objectType: "InferenceEndpoint",
        adapterId: "inference_endpoint_read",
        actions: ["publish", "run_remote"],
      },
      {
        objectType: "FinanceConnection",
        adapterId: "finance_connection_service",
        actions: [
          "configure_moralis",
          "configure_paypal",
          "preview_crypto",
          "add_manual",
          "disconnect",
          "connect_external",
          "refresh_external",
        ],
      },
      {
        objectType: "PlatformGroup",
        adapterId: "platform_group_service",
        actions: [],
      },
      {
        objectType: "PlatformGroupMember",
        adapterId: "platform_group_member_service",
        actions: ["add", "remove"],
      },
    ]);
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

  it("publishes and archives tenant-owned live listings", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE marketplace_listings (
        id TEXT PRIMARY KEY, seller_user_id TEXT NOT NULL, seller_tenant_id TEXT NOT NULL,
        kind TEXT NOT NULL, resource_id TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, price_credits INTEGER NOT NULL, bundle_json TEXT NOT NULL,
        visibility TEXT NOT NULL, status TEXT NOT NULL, delivery_mode TEXT,
        pricing_model TEXT, price_period TEXT, meter_unit TEXT, meter_rate REAL,
        license TEXT, inference_endpoint_id TEXT, created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const def = definition("MarketplaceListing", [
      "id",
      "seller_user_id",
      "seller_tenant_id",
      "kind",
      "resource_id",
      "title",
      "delivery_mode",
      "status",
    ]);
    const ctx = context(db);
    const listing = marketplaceListingAdapter.actions!.publish(
      db,
      def,
      "",
      {
        kind: "agent",
        resource_id: "agent-live",
        title: "Live Agent",
        delivery_mode: "live",
      },
      ctx
    ) as { id: string; data: Record<string, unknown> };

    expect(listing.data).toMatchObject({
      seller_user_id: "user-a",
      seller_tenant_id: "tenant-a",
      status: "active",
    });
    const archived = marketplaceListingAdapter.actions!.archive(
      db,
      def,
      listing.id,
      {},
      ctx
    ) as { data: Record<string, unknown> };
    expect(archived.data.status).toBe("archived");
  });

  it("validates peer invitation input instead of returning 501", () => {
    const db = new Database(":memory:");
    expect(() =>
      peerConnectionAdapter.actions!.invite(
        db,
        definition("PeerConnection", ["id"]),
        "",
        {},
        context(db)
      )
    ).toThrow(/email required/i);
  });

  it("supports manual finance and validates external provider input", async () => {
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
    await expect(
      financeConnectionAdapter.actions!.connect_external(db, def, "", {}, ctx)
    ).rejects.toThrow(/provider required/i);
  });
});
