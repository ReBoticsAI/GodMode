import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import { buildPublicListingsSql } from "../../routes/marketplace.js";
import {
  earnedVerifiedTier,
  ensureSellerAccount,
  isSellerVerified,
  listSellerAccountsForAdmin,
  resolveVerifiedTier,
  setSellerVerified,
  setSellerVerifiedFrozen,
} from "../marketplace-commerce.js";

function openSellerDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE marketplace_seller_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
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
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'active',
      delivery_mode TEXT,
      pricing_model TEXT,
      price_period TEXT,
      meter_unit TEXT,
      meter_rate INTEGER,
      license TEXT,
      inference_endpoint_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function insertListings(core: CoreDatabase, sellerUserId: string, count: number) {
  for (let i = 0; i < count; i++) {
    core
      .prepare(
        `INSERT INTO marketplace_listings
         (id, seller_user_id, seller_tenant_id, kind, resource_id, title, seller_kind, visibility, status)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 'public', 'active')`
      )
      .run(`l-${sellerUserId}-${i}`, sellerUserId, "t1", "skill", `r-${i}`, `Pack ${i}`);
  }
}

describe("Community verified tiers (#313)", () => {
  it("maps listing counts to earned tiers", () => {
    expect(earnedVerifiedTier(0)).toBe(0);
    expect(earnedVerifiedTier(2)).toBe(0);
    expect(earnedVerifiedTier(3)).toBe(1);
    expect(earnedVerifiedTier(4)).toBe(1);
    expect(earnedVerifiedTier(5)).toBe(2);
    expect(earnedVerifiedTier(9)).toBe(2);
    expect(earnedVerifiedTier(10)).toBe(3);
  });

  it("resolves freeze and admin floor", () => {
    expect(resolveVerifiedTier({ earned: 2, verifiedSeller: false })).toBe(2);
    expect(resolveVerifiedTier({ earned: 0, verifiedSeller: true })).toBe(1);
    expect(resolveVerifiedTier({ earned: 3, verifiedSeller: true })).toBe(3);
    expect(resolveVerifiedTier({ earned: 3, frozen: true, verifiedSeller: true })).toBe(0);
  });

  it("defaults new seller accounts to unverified", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u1", "a@example.com");
    const row = ensureSellerAccount(core, "u1");
    expect(row.verified_seller).toBe(0);
    expect(isSellerVerified(core, "u1")).toBe(false);
  });

  it("admin floor sets Verified I; freeze clears badge", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u2", "b@example.com");
    const on = setSellerVerified(core, { userId: "u2", verified: true });
    expect(on.verified_seller).toBe(1);
    expect(on.verified_frozen).toBe(0);
    expect(isSellerVerified(core, "u2")).toBe(true);

    setSellerVerifiedFrozen(core, { userId: "u2", frozen: true });
    expect(isSellerVerified(core, "u2")).toBe(false);

    setSellerVerifiedFrozen(core, { userId: "u2", frozen: false });
    expect(isSellerVerified(core, "u2")).toBe(true);

    const off = setSellerVerified(core, { userId: "u2", verified: false });
    expect(off.verified_seller).toBe(0);
    expect(isSellerVerified(core, "u2")).toBe(false);
  });

  it("earns tiers from gate-passing Community listings", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u3", "c@example.com");
    ensureSellerAccount(core, "u3");
    insertListings(core, "u3", 3);
    expect(isSellerVerified(core, "u3")).toBe(true);
    const sellers = listSellerAccountsForAdmin(core);
    expect(sellers[0]).toMatchObject({
      userId: "u3",
      earnedTier: 1,
      verifiedTier: 1,
      listingCount: 3,
      verifiedFrozen: false,
    });
  });

  it("lists seller accounts with tier fields for admin", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u4", "d@example.com");
    setSellerVerified(core, { userId: "u4", verified: true });
    const sellers = listSellerAccountsForAdmin(core);
    expect(sellers).toHaveLength(1);
    expect(sellers[0]).toMatchObject({
      userId: "u4",
      email: "d@example.com",
      verifiedSeller: true,
      verifiedTier: 1,
      earnedTier: 0,
    });
  });

  it("public listings SQL joins verified_tier from listing count and seller flags", () => {
    const { sql } = buildPublicListingsSql({ sellerKind: "user" });
    expect(sql).toContain("verified_publisher");
    expect(sql).toContain("verified_tier");
    expect(sql).toContain("marketplace_seller_accounts");
    expect(sql).toContain("LEFT JOIN");

    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u5", "e@example.com");
    ensureSellerAccount(core, "u5");
    insertListings(core, "u5", 5);
    core
      .prepare(
        `INSERT INTO marketplace_listings
         (id, seller_user_id, seller_tenant_id, kind, resource_id, title, seller_kind, visibility, status)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 'public', 'active')`
      )
      .run("l-lonely", "u-missing", "t1", "skill", "r-x", "Unverified Pack");

    const { sql: browseSql, params } = buildPublicListingsSql({});
    const rows = core.prepare(browseSql).all(...params) as Array<{
      id: string;
      verified_publisher: number;
      verified_tier: number;
    }>;
    const earned = rows.filter((r) => r.id.startsWith("l-u5-"));
    expect(earned.length).toBe(5);
    expect(earned.every((r) => r.verified_tier === 2)).toBe(true);
    expect(earned.every((r) => r.verified_publisher === 1)).toBe(true);
    expect(rows.find((r) => r.id === "l-lonely")?.verified_tier).toBe(0);
    expect(rows.find((r) => r.id === "l-lonely")?.verified_publisher).toBe(0);
  });

  it("frozen seller shows no badge even with enough listings", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u6", "f@example.com");
    ensureSellerAccount(core, "u6");
    insertListings(core, "u6", 10);
    setSellerVerifiedFrozen(core, { userId: "u6", frozen: true });

    const { sql: browseSql, params } = buildPublicListingsSql({});
    const rows = core.prepare(browseSql).all(...params) as Array<{
      verified_tier: number;
      verified_publisher: number;
    }>;
    expect(rows.every((r) => r.verified_tier === 0)).toBe(true);
    expect(rows.every((r) => r.verified_publisher === 0)).toBe(true);
  });
});
