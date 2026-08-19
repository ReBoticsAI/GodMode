import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import {
  MARKETPLACE_GUEST_TENANT_ID,
  MARKETPLACE_GUEST_USER_ID,
} from "../../core-db.js";
import { PROTOCOL_EXCEPTIONS } from "../../kernel/protocol-exceptions.js";
import { MarketplaceCommerceError } from "../marketplace-commerce.js";
import {
  createGuestMarketplaceCheckout,
  guestCheckoutDelivery,
  guestCheckoutStatus,
  isAllowedMarketplaceReturnUrl,
  upsertDeliveryGrant,
} from "../marketplace-guest-checkout.js";

function openDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL
    );
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_user_id TEXT NOT NULL
    );
    CREATE TABLE marketplace_seller_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      stripe_connect_account_id TEXT,
      paypal_merchant_id TEXT,
      metamask_address TEXT,
      onboarding_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE marketplace_listings (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT,
      kind TEXT,
      title TEXT,
      price_cents INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'usd',
      seller_kind TEXT DEFAULT 'user',
      catalog_entry_id TEXT,
      bundle_json TEXT,
      visibility TEXT DEFAULT 'public',
      status TEXT DEFAULT 'active',
      delivery_mode TEXT DEFAULT 'clone'
    );
    CREATE TABLE marketplace_orders (
      id TEXT PRIMARY KEY,
      listing_id TEXT,
      catalog_entry_id TEXT,
      buyer_user_id TEXT NOT NULL,
      buyer_tenant_id TEXT NOT NULL,
      seller_user_id TEXT,
      seller_kind TEXT NOT NULL DEFAULT 'user',
      amount_cents INTEGER NOT NULL,
      platform_fee_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      provider TEXT NOT NULL,
      provider_ref TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE marketplace_delivery_grants (
      id TEXT PRIMARY KEY,
      stripe_session_id TEXT NOT NULL UNIQUE,
      order_id TEXT,
      listing_id TEXT,
      catalog_entry_id TEXT,
      buyer_email TEXT,
      delivery_kind TEXT NOT NULL DEFAULT 'plugin',
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE marketplace_bans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE);
    CREATE TABLE marketplace_tos_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tos_version TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO users (id, email, display_name) VALUES (?, 'marketplace-guest@godmode.software', 'Marketplace guest')`
  ).run(MARKETPLACE_GUEST_USER_ID);
  db.prepare(
    `INSERT INTO tenants (id, name, slug, owner_user_id) VALUES (?, 'Marketplace guest', 'marketplace-guest', ?)`
  ).run(MARKETPLACE_GUEST_TENANT_ID, MARKETPLACE_GUEST_USER_ID);
  db.prepare(
    `INSERT INTO users (id, email, display_name) VALUES ('seller-1', 'seller@example.com', 'Seller')`
  ).run();
  db.prepare(
    `INSERT INTO marketplace_seller_accounts (id, user_id, stripe_connect_account_id)
     VALUES ('sa-1', 'seller-1', 'acct_test123')`
  ).run();
  return db;
}

describe("guest Marketplace return URLs", () => {
  it("allows localhost and Cloud app hosts", () => {
    expect(
      isAllowedMarketplaceReturnUrl(
        "http://127.0.0.1:5173/marketplace?paid=1&session_id={CHECKOUT_SESSION_ID}"
      )
    ).toBe(true);
    expect(
      isAllowedMarketplaceReturnUrl("https://app.godmode.software/marketplace?canceled=1")
    ).toBe(true);
    expect(isAllowedMarketplaceReturnUrl("https://evil.example/phish")).toBe(false);
  });
});

describe("guest checkout protocol exceptions", () => {
  it("registers unauthenticated Cloud checkout and delivery routes", () => {
    expect(
      PROTOCOL_EXCEPTIONS.some((e) => e.pathPattern === "/api/marketplace/commerce/checkout")
    ).toBe(true);
    expect(
      PROTOCOL_EXCEPTIONS.some(
        (e) => e.pathPattern === "/api/marketplace/commerce/checkout/status"
      )
    ).toBe(true);
    expect(
      PROTOCOL_EXCEPTIONS.some((e) => e.pathPattern === "/api/marketplace/commerce/delivery")
    ).toBe(true);
    expect(
      PROTOCOL_EXCEPTIONS.some((e) => e.pathPattern === "/api/marketplace/cloud-checkout")
    ).toBe(true);
    expect(
      PROTOCOL_EXCEPTIONS.some(
        (e) => e.pathPattern === "/api/marketplace/cloud-checkout/complete"
      )
    ).toBe(true);
  });
});

describe("guest delivery grants", () => {
  it("treats paid grants as complete and serves clone snapshots", () => {
    const db = openDb();
    upsertDeliveryGrant(db, {
      stripeSessionId: "cs_paid",
      listingId: "lst-1",
      deliveryKind: "clone",
      status: "paid",
    });
    const status = guestCheckoutStatus(db, "cs_paid");
    expect(status.paid).toBe(true);
    db.prepare(
      `INSERT INTO marketplace_listings (id, seller_user_id, kind, title, bundle_json)
       VALUES ('lst-1', 'seller-1', 'skill', 'Pack', '{"schemaVersion":1}')`
    ).run();
    const delivery = guestCheckoutDelivery(db, "cs_paid");
    expect(delivery.deliveryKind).toBe("clone");
    expect(delivery.bundle).toEqual({ schemaVersion: 1 });
  });

  it("rejects live share listings before Stripe", async () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO marketplace_listings
         (id, seller_user_id, kind, title, price_cents, delivery_mode)
       VALUES ('lst-live', 'seller-1', 'agent', 'Live', 500, 'live')`
    ).run();
    await expect(
      createGuestMarketplaceCheckout(db, {
        listingId: "lst-live",
        successUrl: "http://127.0.0.1:5173/marketplace?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "http://127.0.0.1:5173/marketplace?canceled=1",
        tosAccepted: true,
      })
    ).rejects.toBeInstanceOf(MarketplaceCommerceError);
  });
});
