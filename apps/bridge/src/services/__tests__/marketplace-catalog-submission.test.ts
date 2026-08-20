import Database from "better-sqlite3";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { acceptMarketplaceTos } from "../marketplace-commerce.js";
import { prepareCommunityCatalogSubmission } from "../marketplace-catalog-submission.js";
import * as gitHostAuth from "../coding/git-host-auth.js";
import * as githubContents from "../coding/github-contents.js";

function createCore(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
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
    INSERT INTO users (id) VALUES ('seller');
  `);
  return db;
}

describe("prepareCommunityCatalogSubmission", () => {
  const userDb = {} as never;
  let core: Database.Database;

  beforeEach(() => {
    core = createCore();
    acceptMarketplaceTos(core as never, "seller");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires Connect attestation when Stripe Connect is linked", async () => {
    core
      .prepare(
        `UPDATE marketplace_seller_accounts
         SET stripe_connect_account_id=?, onboarding_status='complete'
         WHERE user_id=?`
      )
      .run("acct_sub", "seller");

    await expect(
      prepareCommunityCatalogSubmission({
        core: core as never,
        userDb,
        userId: "seller",
        input: {
          id: "my-plugin",
          title: "My Plugin",
          description: "Does things",
          installType: "plugin",
          pluginRepo: "https://github.com/alice/my-plugin",
          pluginRef: "abc123",
          ciRunUrl: "https://github.com/alice/my-plugin/actions/runs/1",
        },
      })
    ).rejects.toThrow(/attestation/);
  });

  it("returns blockers when GitHub is not connected", async () => {
    vi.spyOn(gitHostAuth, "resolveCodingGithubAccessToken").mockRejectedValue(
      new Error("not connected")
    );

    const result = await prepareCommunityCatalogSubmission({
      core: core as never,
      userDb,
      userId: "seller",
      input: {
        id: "my-plugin",
        title: "My Plugin",
        description: "Does things",
        installType: "plugin",
        pluginRepo: "https://github.com/alice/my-plugin",
        pluginRef: "abc123",
        ciRunUrl: "https://github.com/alice/my-plugin/actions/runs/1",
        stripeConnectAttestation: true,
      },
    });

    expect(result.entry.id).toBe("my-plugin");
    expect(result.readyToSubmit).toBe(false);
    expect(result.blockers.some((b) => b.code === "github_connect")).toBe(true);
  });

  it("is ready when GitHub connect and plugin pins are present", async () => {
    vi.spyOn(gitHostAuth, "resolveCodingGithubAccessToken").mockResolvedValue("token");
    vi.spyOn(githubContents, "getGithubAuthenticatedUser").mockResolvedValue({
      login: "alice",
      id: 1,
    });

    const result = await prepareCommunityCatalogSubmission({
      core: core as never,
      userDb,
      userId: "seller",
      input: {
        id: "my-plugin",
        title: "My Plugin",
        description: "Does things",
        installType: "plugin",
        pluginRepo: "https://github.com/alice/my-plugin",
        pluginRef: "abc123",
        ciRunUrl: "https://github.com/alice/my-plugin/actions/runs/1",
      },
    });

    expect(result.readyToSubmit).toBe(true);
    expect(result.entry.author).toBe("alice");
  });

  it("rejects invalid catalog ids", async () => {
    await expect(
      prepareCommunityCatalogSubmission({
        core: core as never,
        userDb,
        userId: "seller",
        input: {
          id: "Bad ID",
          title: "T",
          description: "D",
          installType: "plugin",
        },
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
