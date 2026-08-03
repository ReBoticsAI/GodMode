import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { CoreDatabase } from "../../core-db.js";

vi.mock("../../config.js", () => ({
  config: {
    web: { publicUrl: "http://127.0.0.1:5173" },
    marketplace: {
      tosVersion: "1",
      payments: { stripeWebhookSecret: "", paypalEnv: "sandbox" },
    },
  },
}));

vi.mock("../platform-billing.js", () => ({
  resolveStripeSecretKey: () => "sk_test_fake",
}));

function openSellerDb(): CoreDatabase {
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
      verified_seller INTEGER NOT NULL DEFAULT 0,
      verified_frozen INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("Stripe Connect onboarding (#316)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates Express account + Account Link and stores acct id", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/v1/accounts") && !u.includes("/acct_")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ id: "acct_test123" }),
        } as Response;
      }
      if (u.includes("/account_links")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ url: "https://connect.stripe.com/setup/e/test" }),
        } as Response;
      }
      return { ok: false, text: async () => "unexpected" } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { acceptMarketplaceTos } = await import("../marketplace-commerce.js");
    const { startStripeConnectOnboarding } = await import("../marketplace-payments.js");
    const core = openSellerDb();
    acceptMarketplaceTos(core, "user-1");

    const result = await startStripeConnectOnboarding(core, { userId: "user-1" });
    expect(result.accountId).toBe("acct_test123");
    expect(result.url).toContain("connect.stripe.com");

    const row = core
      .prepare(`SELECT stripe_connect_account_id FROM marketplace_seller_accounts WHERE user_id=?`)
      .get("user-1") as { stripe_connect_account_id: string };
    expect(row.stripe_connect_account_id).toBe("acct_test123");
  });
});
