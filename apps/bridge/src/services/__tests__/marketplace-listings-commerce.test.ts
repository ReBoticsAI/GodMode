import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptMarketplaceTos } from "../marketplace-commerce.js";
import {
  listingCommerceMapForCatalogEntries,
  publishMarketplaceListing,
} from "../marketplace-listings.js";

function createCore(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
    CREATE TABLE marketplace_listings (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT,
      seller_tenant_id TEXT,
      kind TEXT,
      resource_id TEXT,
      title TEXT,
      description TEXT,
      price_credits INTEGER DEFAULT 0,
      price_cents INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'usd',
      seller_kind TEXT DEFAULT 'user',
      catalog_entry_id TEXT,
      bundle_json TEXT DEFAULT '{}',
      visibility TEXT DEFAULT 'public',
      status TEXT DEFAULT 'active',
      delivery_mode TEXT DEFAULT 'clone',
      pricing_model TEXT DEFAULT 'one_time',
      price_period TEXT,
      meter_unit TEXT,
      meter_rate REAL,
      license TEXT,
      inference_endpoint_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE marketplace_seller_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      stripe_connect_account_id TEXT,
      paypal_merchant_id TEXT,
      metamask_address TEXT,
      payout_preference TEXT,
      onboarding_status TEXT NOT NULL DEFAULT 'pending',
      tos_accepted_version TEXT,
      tos_accepted_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE marketplace_tos_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tos_version TEXT NOT NULL,
      accepted_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, tos_version)
    );
    CREATE TABLE marketplace_bans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      order_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO users (id) VALUES ('seller');
    INSERT INTO tenants (id) VALUES ('t1');
  `);
  return db;
}

function createTenantDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE structure_nodes (id TEXT PRIMARY KEY, title TEXT);`);
  return db;
}

describe("listingCommerceMapForCatalogEntries", () => {
  it("returns listing id, price, currency, and status per catalog entry", () => {
    const core = createCore();
    core.prepare(
      `INSERT INTO marketplace_listings
         (id, seller_user_id, seller_tenant_id, kind, resource_id, title, catalog_entry_id,
          price_cents, currency, status)
       VALUES ('lst-1', 'seller', 't1', 'plugin', 'pack-a', 'Pack A', 'pack-a', 499, 'usd', 'active')`
    ).run();

    const map = listingCommerceMapForCatalogEntries(core as never, ["pack-a", "missing"]);
    expect(map.get("pack-a")).toEqual({
      id: "lst-1",
      priceCents: 499,
      currency: "usd",
      status: "active",
    });
    expect(map.has("missing")).toBe(false);
  });
});

describe("publishMarketplaceListing catalog republish upsert", () => {
  let core: Database.Database;

  beforeEach(() => {
    core = createCore();
    acceptMarketplaceTos(core as never, "seller");
  });

  it("updates an existing catalog-backed plugin listing instead of inserting a duplicate", () => {
    const tenantDb = createTenantDb();
    const first = publishMarketplaceListing(core as never, tenantDb as never, {
      sellerUserId: "seller",
      sellerTenantId: "t1",
      kind: "plugin",
      catalogEntryId: "workspace-pulse",
      title: "Pulse v1",
      priceCents: 0,
    });
    const second = publishMarketplaceListing(core as never, tenantDb as never, {
      sellerUserId: "seller",
      sellerTenantId: "t1",
      kind: "plugin",
      catalogEntryId: "workspace-pulse",
      title: "Pulse v2",
      description: "Updated copy",
      priceCents: 299,
    });

    expect(second.id).toBe(first.id);
    expect(
      core.prepare("SELECT COUNT(*) AS c FROM marketplace_listings WHERE catalog_entry_id=?").get(
        "workspace-pulse"
      )
    ).toEqual({ c: 1 });
    const row = core
      .prepare("SELECT title, description, price_cents FROM marketplace_listings WHERE id=?")
      .get(first.id as string) as { title: string; description: string; price_cents: number };
    expect(row.title).toBe("Pulse v2");
    expect(row.description).toBe("Updated copy");
    expect(row.price_cents).toBe(299);
  });

  it("upserts catalog-backed clone packs the same way", () => {
    const tenantDb = createTenantDb();
    const first = publishMarketplaceListing(core as never, tenantDb as never, {
      sellerUserId: "seller",
      sellerTenantId: "t1",
      kind: "agent",
      catalogEntryId: "weekly-review-pack",
      title: "Review pack",
      priceCents: 0,
    });
    const second = publishMarketplaceListing(core as never, tenantDb as never, {
      sellerUserId: "seller",
      sellerTenantId: "t1",
      kind: "agent",
      catalogEntryId: "weekly-review-pack",
      title: "Review pack pro",
      priceCents: 199,
    });

    expect(second.id).toBe(first.id);
    expect(
      core.prepare("SELECT COUNT(*) AS c FROM marketplace_listings").get()
    ).toEqual({ c: 1 });
  });
});
