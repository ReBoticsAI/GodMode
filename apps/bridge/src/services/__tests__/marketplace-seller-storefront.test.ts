import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { CoreDatabase } from "../../core-db.js";
import {
  allocateUniqueSellerPublicHandle,
  ensureSellerAccount,
  getPublicSellerStorefront,
  renderPublicSellerStorefrontHtml,
} from "../marketplace-commerce.js";

function openDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
    CREATE TABLE marketplace_seller_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      stripe_connect_account_id TEXT,
      paypal_merchant_id TEXT,
      metamask_address TEXT,
      payout_preference TEXT,
      onboarding_status TEXT NOT NULL DEFAULT 'pending',
      public_handle TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX marketplace_seller_accounts_public_handle_uidx
      ON marketplace_seller_accounts(public_handle)
      WHERE public_handle IS NOT NULL AND TRIM(public_handle) != '';
    CREATE TABLE marketplace_listings (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'active',
      visibility TEXT NOT NULL DEFAULT 'public',
      catalog_entry_id TEXT,
      delivery_mode TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("seller public_handle + storefront (#688)", () => {
  it("allocates unique opaque handles", () => {
    const core = openDb();
    const a = allocateUniqueSellerPublicHandle(core);
    core
      .prepare(
        `INSERT INTO marketplace_seller_accounts (id, user_id, public_handle)
         VALUES ('sa-1', 'u-1', ?)`
      )
      .run(a);
    const b = allocateUniqueSellerPublicHandle(core);
    expect(a).toMatch(/^s_[a-z0-9]{10}$/);
    expect(b).toMatch(/^s_[a-z0-9]{10}$/);
    expect(a).not.toBe(b);
  });

  it("ensureSellerAccount backfills public_handle", () => {
    const core = openDb();
    core
      .prepare(
        `INSERT INTO marketplace_seller_accounts (id, user_id, public_handle)
         VALUES ('sa-legacy', 'user-legacy', NULL)`
      )
      .run();
    const row = ensureSellerAccount(core, "user-legacy");
    expect(String(row.public_handle)).toMatch(/^s_/);
  });

  it("public storefront shows pending_payout, hides draft, flags buyEnabled", () => {
    const core = openDb();
    const seller = ensureSellerAccount(core, "seller-1");
    const handle = String(seller.public_handle);
    core
      .prepare(
        `INSERT INTO marketplace_listings
           (id, seller_user_id, title, description, kind, price_cents, status, visibility)
         VALUES
           ('l-active', 'seller-1', 'Active Pack', 'live', 'plugin', 1000, 'active', 'public'),
           ('l-pending', 'seller-1', 'Pending Pack', 'soon', 'plugin', 2000, 'pending_payout', 'unlisted'),
           ('l-draft', 'seller-1', 'Draft Pack', 'hidden', 'plugin', 3000, 'draft', 'private')`
      )
      .run();

    const store = getPublicSellerStorefront(core, handle);
    expect(store).not.toBeNull();
    expect(store!.listings.map((l) => l.id)).toEqual(["l-active", "l-pending"]);
    expect(store!.listings.find((l) => l.id === "l-active")?.buyEnabled).toBe(true);
    expect(store!.listings.find((l) => l.id === "l-pending")?.buyEnabled).toBe(false);

    const html = renderPublicSellerStorefrontHtml(store!);
    expect(html).toContain("Active Pack");
    expect(html).toContain("Pending Pack");
    expect(html).toContain("Pending · awaiting payment setup");
    expect(html).not.toContain("Draft Pack");
  });

  it("rejects malformed handles", () => {
    const core = openDb();
    expect(getPublicSellerStorefront(core, "acct_123")).toBeNull();
    expect(getPublicSellerStorefront(core, "../etc")).toBeNull();
  });
});
