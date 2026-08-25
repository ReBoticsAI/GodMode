import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mem = new Database(":memory:");
const userMem = new Database(":memory:");

vi.mock("../../core-db.js", () => ({
  getCloudDb: () => mem,
}));

vi.mock("../../config.js", () => ({
  config: {
    isSaas: true,
    dataDir: "/tmp/gm-seller-ready",
    cloudDbPath: "/tmp/gm-seller-ready/Cloud.sqlite",
    usersDir: "/tmp/gm-seller-ready/users",
    tenantsDir: "/tmp/gm-seller-ready/tenants",
    saas: { plans: [] },
    marketplace: { tosVersion: "1" },
  },
}));

vi.mock("../user-registry.js", () => ({
  getUserDb: () => userMem,
}));

vi.mock("../github-integration.js", () => ({
  githubProjectsStatus: () => ({
    connected: true,
    login: "seller-gh",
    configured: true,
    githubApp: false,
    installationId: null,
    installUrl: null,
  }),
}));

const { acceptMarketplaceTos } = await import("../marketplace-commerce.js");
const { getSellerCommerceReadiness } = await import("../saas-subscriptions.js");

function seedSchema(): void {
  mem.exec(`
    DROP TABLE IF EXISTS marketplace_seller_accounts;
    DROP TABLE IF EXISTS marketplace_tos_acceptances;
    DROP TABLE IF EXISTS marketplace_bans;
    DROP TABLE IF EXISTS users;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE marketplace_seller_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      stripe_connect_account_id TEXT,
      paypal_merchant_id TEXT,
      metamask_address TEXT,
      payout_preference TEXT,
      onboarding_status TEXT NOT NULL DEFAULT 'pending',
      public_handle TEXT,
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
  `);
}

describe("getSellerCommerceReadiness (#681)", () => {
  beforeEach(() => {
    seedSchema();
  });

  it("reports github, tos, and stripe connect readiness", () => {
    const userId = randomUUID();
    mem.prepare(`INSERT INTO users (id) VALUES (?)`).run(userId);

    expect(getSellerCommerceReadiness(userId)).toEqual({
      githubConnected: true,
      tosAccepted: false,
      stripePayoutReady: false,
    });

    acceptMarketplaceTos(mem as never, userId);
    mem
      .prepare(
        `UPDATE marketplace_seller_accounts
         SET stripe_connect_account_id=?, onboarding_status='ready', updated_at=datetime('now')
         WHERE user_id=?`
      )
      .run("acct_test_681", userId);

    expect(getSellerCommerceReadiness(userId)).toEqual({
      githubConnected: true,
      tosAccepted: true,
      stripePayoutReady: true,
    });
  });
});
