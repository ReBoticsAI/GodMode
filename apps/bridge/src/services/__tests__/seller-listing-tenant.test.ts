import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { ensureSellerListingTenant } from "../seller-listing-tenant.js";
import { ensureSellerAccount } from "../marketplace-commerce.js";

describe("ensureSellerListingTenant (#709)", () => {
  let mem: Database.Database;

  beforeEach(() => {
    mem = new Database(":memory:");
    mem.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL
      );
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT,
        is_operator INTEGER NOT NULL DEFAULT 0,
        owner_user_id TEXT
      );
      CREATE TABLE tenant_memberships (
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        role TEXT NOT NULL
      );
      CREATE TABLE marketplace_seller_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        stripe_connect_account_id TEXT,
        paypal_merchant_id TEXT,
        metamask_address TEXT,
        onboarding_status TEXT NOT NULL DEFAULT 'pending',
        public_handle TEXT,
        listing_tenant_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  it("reuses membership tenant when seller has a workspace", () => {
    const userId = randomUUID();
    const tenantId = randomUUID();
    mem.prepare(`INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`).run(
      userId,
      "seller@test.local",
      "Seller"
    );
    mem.prepare(
      `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id) VALUES (?, ?, ?, 0, ?)`
    ).run(tenantId, "Workspace", "ws", userId);
    mem.prepare(
      `INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')`
    ).run(userId, tenantId);
    ensureSellerAccount(mem as never, userId);

    const resolved = ensureSellerListingTenant(mem as never, userId);
    expect(resolved).toBe(tenantId);
    const acct = mem
      .prepare(`SELECT listing_tenant_id FROM marketplace_seller_accounts WHERE user_id=?`)
      .get(userId) as { listing_tenant_id: string };
    expect(acct.listing_tenant_id).toBe(tenantId);
  });

  it("creates listing-only tenant without membership for seller-only accounts", () => {
    const userId = randomUUID();
    mem.prepare(`INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`).run(
      userId,
      "seller-only@test.local",
      "Seller Only"
    );
    ensureSellerAccount(mem as never, userId);
    const tenantId = randomUUID();
    mem.prepare(
      `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id) VALUES (?, ?, ?, 0, ?)`
    ).run(tenantId, "Seller listings", `seller-${userId.slice(0, 8)}`, userId);
    mem.prepare(
      `UPDATE marketplace_seller_accounts SET listing_tenant_id=? WHERE user_id=?`
    ).run(tenantId, userId);

    const resolved = ensureSellerListingTenant(mem as never, userId);
    expect(resolved).toBe(tenantId);
    const membership = mem
      .prepare(`SELECT 1 AS ok FROM tenant_memberships WHERE user_id=?`)
      .get(userId) as { ok?: number } | undefined;
    expect(membership).toBeUndefined();
  });
});
