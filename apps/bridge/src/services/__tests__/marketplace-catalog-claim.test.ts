import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import type { AppDatabase } from "../../db.js";
import { acceptMarketplaceTos } from "../marketplace-commerce.js";
import { claimOwnedCommunityCatalogListings } from "../marketplace-listings.js";

function openClaimDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
    CREATE TABLE marketplace_bans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT,
      order_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE marketplace_tos_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tos_version TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, tos_version)
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
      verified_seller INTEGER NOT NULL DEFAULT 0,
      verified_frozen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE marketplace_listings (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT NOT NULL,
      seller_tenant_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      price_credits INTEGER NOT NULL DEFAULT 0,
      price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      seller_kind TEXT NOT NULL DEFAULT 'user',
      catalog_entry_id TEXT,
      bundle_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'active',
      delivery_mode TEXT NOT NULL DEFAULT 'clone',
      pricing_model TEXT NOT NULL DEFAULT 'one_time',
      price_period TEXT,
      meter_unit TEXT,
      meter_rate INTEGER,
      license TEXT,
      inference_endpoint_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX marketplace_listings_seller_catalog_uidx
      ON marketplace_listings(seller_user_id, catalog_entry_id)
      WHERE catalog_entry_id IS NOT NULL AND status != 'archived';
  `);
  db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u-alice", "alice@example.test");
  db.prepare(`INSERT INTO tenants (id) VALUES (?)`).run("t-alice");
  return db;
}

const ping = {
  id: "community-ping",
  title: "Community Ping",
  description: "health ping",
  author: "alice",
  pluginRepo: "https://github.com/alice/community-ping",
  priceCents: 0,
};

describe("claimOwnedCommunityCatalogListings", () => {
  it("claims an owned catalog plugin once and is idempotent", () => {
    const core = openClaimDb();
    acceptMarketplaceTos(core, "u-alice");
    const tenantDb = new Database(":memory:") as unknown as AppDatabase;
    const first = claimOwnedCommunityCatalogListings(core, tenantDb, {
      sellerUserId: "u-alice",
      sellerTenantId: "t-alice",
      githubLogin: "alice",
      entries: [ping],
    });
    expect(first).toEqual([]);
    const second = claimOwnedCommunityCatalogListings(core, tenantDb, {
      sellerUserId: "u-alice",
      sellerTenantId: "t-alice",
      githubLogin: "alice",
      entries: [ping],
    });
    expect(second).toEqual([]);
    const rows = core
      .prepare(
        `SELECT catalog_entry_id FROM marketplace_listings WHERE seller_user_id=? AND status != 'archived'`
      )
      .all("u-alice") as Array<{ catalog_entry_id: string }>;
    expect(rows).toEqual([{ catalog_entry_id: "community-ping" }]);
  });

  it("claims an owned catalog clone pack as a skill listing", () => {
    const core = openClaimDb();
    acceptMarketplaceTos(core, "u-alice");
    const tenantDb = new Database(":memory:") as unknown as AppDatabase;
    const orphans = claimOwnedCommunityCatalogListings(core, tenantDb, {
      sellerUserId: "u-alice",
      sellerTenantId: "t-alice",
      githubLogin: "alice",
      entries: [
        {
          id: "weekly-review-pack",
          title: "Weekly review",
          author: "alice",
          pluginRepo: "https://github.com/alice/weekly-review-pack",
          installType: "clone",
          kind: "skill",
          priceCents: 0,
        },
      ],
    });
    expect(orphans).toEqual([]);
    const row = core
      .prepare(
        `SELECT kind, catalog_entry_id, delivery_mode, status FROM marketplace_listings WHERE catalog_entry_id=?`
      )
      .get("weekly-review-pack") as {
      kind: string;
      catalog_entry_id: string;
      delivery_mode: string;
      status: string;
    };
    expect(row).toMatchObject({
      kind: "skill",
      catalog_entry_id: "weekly-review-pack",
      delivery_mode: "clone",
      status: "active",
    });
  });

  it("does not block seller listings when the seller has not accepted ToS", () => {
    const core = openClaimDb();
    const tenantDb = new Database(":memory:") as unknown as AppDatabase;
    const orphans = claimOwnedCommunityCatalogListings(core, tenantDb, {
      sellerUserId: "u-alice",
      sellerTenantId: "t-alice",
      githubLogin: "alice",
      entries: [ping],
    });
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.id).toBe("community-ping");
    const count = core
      .prepare(`SELECT COUNT(*) AS n FROM marketplace_listings`)
      .get() as { n: number };
    expect(count.n).toBe(0);
  });
});
