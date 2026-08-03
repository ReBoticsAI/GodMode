import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import { buildPublicListingsSql } from "../../routes/marketplace.js";
import {
  ensureSellerAccount,
  isSellerVerified,
  listSellerAccountsForAdmin,
  setSellerVerified,
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

describe("Community verified seller (#311)", () => {
  it("defaults new seller accounts to unverified", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u1", "a@example.com");
    const row = ensureSellerAccount(core, "u1");
    expect(row.verified_seller).toBe(0);
    expect(isSellerVerified(core, "u1")).toBe(false);
  });

  it("admin can set and clear verified_seller", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u2", "b@example.com");
    const on = setSellerVerified(core, { userId: "u2", verified: true });
    expect(on.verified_seller).toBe(1);
    expect(isSellerVerified(core, "u2")).toBe(true);

    const off = setSellerVerified(core, { userId: "u2", verified: false });
    expect(off.verified_seller).toBe(0);
    expect(isSellerVerified(core, "u2")).toBe(false);
  });

  it("lists seller accounts with verifiedSeller for admin", () => {
    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u3", "c@example.com");
    setSellerVerified(core, { userId: "u3", verified: true });
    const sellers = listSellerAccountsForAdmin(core);
    expect(sellers).toHaveLength(1);
    expect(sellers[0]).toMatchObject({
      userId: "u3",
      email: "c@example.com",
      verifiedSeller: true,
    });
  });

  it("public listings SQL joins verified_publisher from seller account", () => {
    const { sql } = buildPublicListingsSql({ sellerKind: "user" });
    expect(sql).toContain("verified_publisher");
    expect(sql).toContain("marketplace_seller_accounts");
    expect(sql).toContain("LEFT JOIN");

    const core = openSellerDb();
    core.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u4", "d@example.com");
    setSellerVerified(core, { userId: "u4", verified: true });
    core
      .prepare(
        `INSERT INTO marketplace_listings
         (id, seller_user_id, seller_tenant_id, kind, resource_id, title, seller_kind, visibility, status)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 'public', 'active')`
      )
      .run("l1", "u4", "t1", "skill", "r1", "Verified Pack");
    core
      .prepare(
        `INSERT INTO marketplace_listings
         (id, seller_user_id, seller_tenant_id, kind, resource_id, title, seller_kind, visibility, status)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 'public', 'active')`
      )
      .run("l2", "u-missing", "t1", "skill", "r2", "Unverified Pack");

    const { sql: browseSql, params } = buildPublicListingsSql({});
    const rows = core.prepare(browseSql).all(...params) as Array<{
      id: string;
      verified_publisher: number;
    }>;
    expect(rows.find((r) => r.id === "l1")?.verified_publisher).toBe(1);
    expect(rows.find((r) => r.id === "l2")?.verified_publisher).toBe(0);
  });
});
