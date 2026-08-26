import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const mem = new Database(":memory:");

vi.mock("../../core-db.js", () => ({
  getCloudDb: () => mem,
}));

vi.mock("../../config.js", () => ({
  config: {
    web: { publicUrl: "https://app.example.com" },
    isSaas: true,
  },
}));

vi.mock("../github-integration.js", () => ({
  githubProjectsStatus: () => ({
    connected: true,
    login: "seller-gh",
  }),
}));

vi.mock("../../user-registry.js", () => ({
  getUserDb: () => mem,
}));

const {
  approveSellerLinkDevice,
  assertSellerLinkReturnUrl,
  completeSellerGithubRedirect,
  completeSellerLinkRedirect,
  completeSellerStripeRedirect,
  denySellerLinkDevice,
  ensureSellerLinkSchema,
  exchangeSellerLinkCode,
  getSellerGithubRedirectSession,
  getSellerLinkRedirectSession,
  getSellerStripeRedirectSession,
  pollSellerLinkDevice,
  resolveSellerLinkBearer,
  revokeSellerLinkBearer,
  startSellerGithubRedirect,
  startSellerLinkDevice,
  startSellerLinkRedirect,
  startSellerStripeRedirect,
} = await import("../seller-link.js");

function seedUser(email = "seller@example.com"): string {
  const id = randomUUID();
  mem
    .prepare(
      `INSERT INTO users (id, email, display_name, is_admin)
       VALUES (?, ?, ?, 0)`
    )
    .run(id, email, "Seller");
  return id;
}

describe("seller-link device flow", () => {
  beforeEach(() => {
    mem.exec(`
      DROP TABLE IF EXISTS seller_link_tokens;
      DROP TABLE IF EXISTS seller_link_devices;
      DROP TABLE IF EXISTS seller_link_redirects;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        access_disabled INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        email_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureSellerLinkSchema(mem as never);
  });

  it("starts, approves, polls token, resolves entitlement bearer, revokes", () => {
    const userId = seedUser();
    const started = startSellerLinkDevice();
    expect(started.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(started.verificationUrl).toContain("seller_link=");

    expect(pollSellerLinkDevice(started.deviceCode)).toEqual({ status: "pending" });

    approveSellerLinkDevice(userId, started.userCode);
    const complete = pollSellerLinkDevice(started.deviceCode);
    expect(complete.status).toBe("complete");
    if (complete.status !== "complete") throw new Error("expected complete");
    expect(complete.accessToken.startsWith("gsl_")).toBe(true);

    const auth = resolveSellerLinkBearer(`Bearer ${complete.accessToken}`);
    expect(auth?.id).toBe(userId);
    expect(auth?.email).toBe("seller@example.com");

    expect(revokeSellerLinkBearer(`Bearer ${complete.accessToken}`)).toBe(true);
    expect(resolveSellerLinkBearer(`Bearer ${complete.accessToken}`)).toBeNull();
  });

  it("denies a pending device code", () => {
    const userId = seedUser();
    const started = startSellerLinkDevice();
    denySellerLinkDevice(userId, started.userCode);
    expect(pollSellerLinkDevice(started.deviceCode)).toEqual({ status: "denied" });
  });
});

describe("seller-link redirect flow (#706)", () => {
  beforeEach(() => {
    mem.exec(`
      DROP TABLE IF EXISTS seller_link_tokens;
      DROP TABLE IF EXISTS seller_link_devices;
      DROP TABLE IF EXISTS seller_link_redirects;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        access_disabled INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        email_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureSellerLinkSchema(mem as never);
  });

  it("rejects non-local return URLs", () => {
    expect(() => assertSellerLinkReturnUrl("https://evil.example/hack")).toThrow(/localhost/i);
  });

  it("starts redirect, completes, exchanges gsl_ token", () => {
    const userId = seedUser();
    const started = startSellerLinkRedirect("http://localhost:5173/marketplace?tab=seller");
    expect(started.connectUrl).toContain("/seller-link/connect?state=");
    expect(started.state.length).toBeGreaterThan(10);

    const session = getSellerLinkRedirectSession(started.state);
    expect(session.returnUrl).toContain("localhost:5173");
    expect(session.status).toBe("pending");

    const completed = completeSellerLinkRedirect(userId, started.state);
    expect(completed.redirectUrl).toContain("seller_link_exchange=slx_");
    expect(completed.exchangeCode.startsWith("slx_")).toBe(true);

    const exchanged = exchangeSellerLinkCode(completed.exchangeCode);
    expect(exchanged.accessToken.startsWith("gsl_")).toBe(true);
    expect(resolveSellerLinkBearer(`Bearer ${exchanged.accessToken}`)?.id).toBe(userId);

    expect(() => exchangeSellerLinkCode(completed.exchangeCode)).toThrow();
  });
});

describe("seller-link GitHub redirect (#711)", () => {
  beforeEach(() => {
    mem.exec(`
      DROP TABLE IF EXISTS seller_link_tokens;
      DROP TABLE IF EXISTS seller_link_devices;
      DROP TABLE IF EXISTS seller_link_redirects;
      DROP TABLE IF EXISTS seller_github_redirects;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        access_disabled INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        email_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureSellerLinkSchema(mem as never);
  });

  it("starts GitHub redirect and completes back to Local with seller_github=connected", () => {
    const userId = seedUser();
    const started = startSellerGithubRedirect("http://127.0.0.1:5173/marketplace?tab=seller");
    expect(started.connectUrl).toContain("/seller-link/github?state=");
    const session = getSellerGithubRedirectSession(started.state);
    expect(session.returnUrl).toContain("127.0.0.1:5173");
    expect(session.status).toBe("pending");

    const completed = completeSellerGithubRedirect(userId, started.state);
    expect(completed.redirectUrl).toContain("seller_github=connected");
    expect(completed.redirectUrl).toContain("github_login=seller-gh");
  });
});

describe("seller-link Stripe redirect (#709)", () => {
  beforeEach(() => {
    mem.exec(`
      DROP TABLE IF EXISTS seller_stripe_redirects;
      DROP TABLE IF EXISTS marketplace_seller_accounts;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        access_disabled INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        email_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE marketplace_seller_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        stripe_connect_account_id TEXT,
        paypal_merchant_id TEXT,
        metamask_address TEXT,
        onboarding_status TEXT,
        public_handle TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureSellerLinkSchema(mem as never);
  });

  it("starts Stripe redirect and completes back to Local with seller_stripe=connected", () => {
    const userId = seedUser();
    mem.prepare(
      `INSERT INTO marketplace_seller_accounts (id, user_id, stripe_connect_account_id, onboarding_status, public_handle)
       VALUES (?, ?, 'acct_test709', 'ready', 'seller709')`
    ).run(randomUUID(), userId);

    const started = startSellerStripeRedirect("http://127.0.0.1:5173/marketplace?tab=seller");
    expect(started.connectUrl).toContain("/seller-link/stripe?state=");
    const session = getSellerStripeRedirectSession(started.state);
    expect(session.returnUrl).toContain("127.0.0.1:5173");

    const completed = completeSellerStripeRedirect(userId, started.state);
    expect(completed.redirectUrl).toContain("seller_stripe=connected");
  });
});
