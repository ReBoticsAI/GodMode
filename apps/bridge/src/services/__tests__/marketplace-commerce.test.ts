import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import {
  acceptMarketplaceTos,
  assertCanAcquireListing,
  createMarketplaceOrder,
  isMarketplaceBanned,
  markOrderDisputedAndBanBuyer,
  markOrderPaid,
  platformFeeCents,
  updateSellerPayout,
} from "../marketplace-commerce.js";

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
      bundle_json TEXT,
      visibility TEXT DEFAULT 'public',
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE marketplace_purchases (
      id TEXT PRIMARY KEY,
      listing_id TEXT,
      buyer_user_id TEXT,
      buyer_tenant_id TEXT,
      price_credits INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
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
    CREATE TABLE marketplace_orders (
      id TEXT PRIMARY KEY,
      listing_id TEXT,
      catalog_entry_id TEXT,
      buyer_user_id TEXT NOT NULL,
      buyer_tenant_id TEXT NOT NULL,
      seller_user_id TEXT,
      seller_kind TEXT NOT NULL DEFAULT 'official',
      amount_cents INTEGER NOT NULL,
      platform_fee_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      provider TEXT NOT NULL,
      provider_ref TEXT,
      crypto_tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      delivered_at TEXT,
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
    INSERT INTO users (id) VALUES ('buyer'), ('seller');
    INSERT INTO tenants (id) VALUES ('t1');
  `);
  return db;
}

describe("marketplace commerce", () => {
  let core: Database.Database;

  beforeEach(() => {
    core = createCore();
  });

  it("charges 10% platform fee on user listings and 0 on Official", () => {
    expect(platformFeeCents(1000, "user")).toBe(100);
    expect(platformFeeCents(999, "user")).toBe(100);
    expect(platformFeeCents(1000, "official")).toBe(0);
  });

  it("requires ToS before creating a paid order", () => {
    expect(() =>
      createMarketplaceOrder(core as never, {
        catalogEntryId: "pack-1",
        buyerUserId: "buyer",
        buyerTenantId: "t1",
        sellerKind: "official",
        amountCents: 500,
        provider: "stripe",
      })
    ).toThrow(/Terms of Service/);

    acceptMarketplaceTos(core as never, "buyer");
    const order = createMarketplaceOrder(core as never, {
      catalogEntryId: "pack-1",
      buyerUserId: "buyer",
      buyerTenantId: "t1",
      sellerKind: "official",
      amountCents: 500,
      provider: "stripe",
    });
    expect(order.status).toBe("awaiting_payment");
    expect(order.platform_fee_cents).toBe(0);
    expect(order.amount_cents).toBe(500);
  });

  it("bans buyer on chargeback and blocks further marketplace use", () => {
    acceptMarketplaceTos(core as never, "buyer");
    const order = createMarketplaceOrder(core as never, {
      catalogEntryId: "pack-1",
      buyerUserId: "buyer",
      buyerTenantId: "t1",
      sellerKind: "official",
      amountCents: 500,
      provider: "stripe",
    });
    markOrderPaid(core as never, { orderId: String(order.id), providerRef: "cs_test" });
    markOrderDisputedAndBanBuyer(core as never, {
      orderId: String(order.id),
      reason: "chargeback",
    });
    expect(isMarketplaceBanned(core as never, "buyer")).toBe(true);
    expect(() =>
      createMarketplaceOrder(core as never, {
        catalogEntryId: "pack-2",
        buyerUserId: "buyer",
        buyerTenantId: "t1",
        sellerKind: "official",
        amountCents: 100,
        provider: "stripe",
      })
    ).toThrow(/banned/i);
  });

  it("gates paid listing acquire until order is paid", () => {
    acceptMarketplaceTos(core as never, "buyer");
    acceptMarketplaceTos(core as never, "seller");
    updateSellerPayout(core as never, {
      userId: "seller",
      metamaskAddress: "0x1111111111111111111111111111111111111111",
      payoutPreference: "crypto",
    });

    const listing = {
      id: "listing-1",
      price_cents: 2500,
      seller_kind: "user",
    };
    expect(() =>
      assertCanAcquireListing(core as never, { userId: "buyer", listing })
    ).toThrow(/Payment required/);

    const order = createMarketplaceOrder(core as never, {
      listingId: "listing-1",
      buyerUserId: "buyer",
      buyerTenantId: "t1",
      sellerUserId: "seller",
      sellerKind: "user",
      amountCents: 2500,
      provider: "crypto",
    });
    expect(order.platform_fee_cents).toBe(250);
    markOrderPaid(core as never, {
      orderId: String(order.id),
      cryptoTxHash: "0x" + "ab".repeat(32),
    });
    expect(() =>
      assertCanAcquireListing(core as never, { userId: "buyer", listing })
    ).not.toThrow();
  });
});
