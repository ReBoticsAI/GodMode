import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { CoreDatabase } from "../../core-db.js";

const paymentsConfig = vi.hoisted(() => ({
  stripeWebhookSecret: "whsec_platform",
  stripeConnectWebhookSecret: "whsec_connect",
  paypalEnv: "sandbox" as const,
}));

vi.mock("../../config.js", () => ({
  config: {
    web: { publicUrl: "http://127.0.0.1:5173" },
    marketplace: {
      tosVersion: "2",
      payments: paymentsConfig,
    },
  },
}));

vi.mock("../platform-billing.js", () => ({
  resolveStripeSecretKey: () => "sk_test_fake",
}));

function openDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
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
      tos_accepted_at TEXT,
      tos_accepted_version TEXT,
      tos_version TEXT,
      stripe_connect_account_id TEXT,
      paypal_merchant_id TEXT,
      metamask_address TEXT,
      payout_preference TEXT,
      onboarding_status TEXT NOT NULL DEFAULT 'pending',
      public_handle TEXT,
      verified_seller INTEGER NOT NULL DEFAULT 0,
      verified_frozen INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      crypto_tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE marketplace_delivery_grants (
      id TEXT PRIMARY KEY,
      stripe_session_id TEXT NOT NULL UNIQUE,
      order_id TEXT,
      listing_id TEXT,
      catalog_entry_id TEXT,
      buyer_email TEXT,
      delivery_kind TEXT NOT NULL DEFAULT 'plugin',
      status TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT
    );
  `);
  return db;
}

function signStripeBody(payload: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("Marketplace Stripe direct charges (#690)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    paymentsConfig.stripeWebhookSecret = "whsec_platform";
    paymentsConfig.stripeConnectWebhookSecret = "whsec_connect";
  });

  it("user-seller Checkout uses Stripe-Account + application_fee (no transfer_data)", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      return {
        ok: true,
        json: async () => ({
          id: "cs_test_community",
          url: "https://checkout.stripe.com/c/pay/cs_test_community",
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { acceptMarketplaceTos, createMarketplaceOrder, updateSellerPayout } =
      await import("../marketplace-commerce.js");
    const { startMarketplaceCheckout } = await import("../marketplace-payments.js");
    const core = openDb();
    acceptMarketplaceTos(core, "buyer-1");
    acceptMarketplaceTos(core, "seller-1");
    updateSellerPayout(core, {
      userId: "seller-1",
      stripeConnectAccountId: "acct_seller",
      payoutPreference: "stripe",
    });

    const order = createMarketplaceOrder(core, {
      buyerUserId: "buyer-1",
      buyerTenantId: "tenant-1",
      sellerUserId: "seller-1",
      sellerKind: "user",
      amountCents: 1000,
      provider: "stripe",
    });

    const result = await startMarketplaceCheckout(core, {
      orderId: String(order.id),
      successUrl: "https://app.godmode.software/ok",
      cancelUrl: "https://app.godmode.software/cancel",
      stripeConnectAccountId: "acct_seller",
    });
    expect(result.sessionId).toBe("cs_test_community");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Stripe-Account"]).toBe("acct_seller");
    const body = String(init.body);
    expect(body).toContain("payment_intent_data%5Bapplication_fee_amount%5D=100");
    expect(body).not.toContain("transfer_data");
  });

  it("Official Checkout has no Stripe-Account header", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          id: "cs_test_official",
          url: "https://checkout.stripe.com/c/pay/cs_test_official",
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { acceptMarketplaceTos, createMarketplaceOrder } = await import(
      "../marketplace-commerce.js"
    );
    const { startMarketplaceCheckout } = await import("../marketplace-payments.js");
    const core = openDb();
    acceptMarketplaceTos(core, "buyer-1");

    const order = createMarketplaceOrder(core, {
      buyerUserId: "buyer-1",
      buyerTenantId: "tenant-1",
      sellerKind: "official",
      amountCents: 1000,
      provider: "stripe",
    });

    await startMarketplaceCheckout(core, {
      orderId: String(order.id),
      successUrl: "https://app.godmode.software/ok",
      cancelUrl: "https://app.godmode.software/cancel",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Stripe-Account"]).toBeUndefined();
    const body = String(init.body);
    expect(body).not.toContain("application_fee_amount");
    expect(body).not.toContain("transfer_data");
  });

  it("accepts Connect webhook signing secret for checkout.session.completed", async () => {
    const { acceptMarketplaceTos, createMarketplaceOrder, markOrderProviderRef, updateSellerPayout } =
      await import("../marketplace-commerce.js");
    const { handleMarketplaceStripeWebhook } = await import("../marketplace-payments.js");
    const core = openDb();
    acceptMarketplaceTos(core, "buyer-1");
    acceptMarketplaceTos(core, "seller-1");
    updateSellerPayout(core, {
      userId: "seller-1",
      stripeConnectAccountId: "acct_seller",
      payoutPreference: "stripe",
    });

    const order = createMarketplaceOrder(core, {
      buyerUserId: "buyer-1",
      buyerTenantId: "tenant-1",
      sellerUserId: "seller-1",
      sellerKind: "user",
      amountCents: 1000,
      provider: "stripe",
    });
    markOrderProviderRef(core, String(order.id), "cs_connect_paid");

    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_connect_paid",
          metadata: {
            godmode_marketplace: "1",
            godmode_order_id: String(order.id),
          },
          customer_details: { email: "buyer@example.com" },
        },
      },
    });
    const sig = signStripeBody(payload, "whsec_connect");
    const result = handleMarketplaceStripeWebhook(core, Buffer.from(payload), sig);
    expect(result).toEqual({ ok: true, orderId: String(order.id) });

    const row = core
      .prepare(`SELECT status FROM marketplace_orders WHERE id=?`)
      .get(String(order.id)) as { status: string };
    expect(row.status).toBe("paid");
  });
});
