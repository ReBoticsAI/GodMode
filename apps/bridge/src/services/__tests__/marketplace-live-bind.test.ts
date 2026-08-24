import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import type { AppDatabase } from "../../db.js";
import { acceptMarketplaceTos } from "../marketplace-commerce.js";
import { claimOwnedCommunityCatalogListings } from "../marketplace-listings.js";
import type { PortableBundle } from "../portability.js";
import {
  assertLiveListingBoundFresh,
  demoteLiveListingsForCatalogPinChanges,
  portableBundleDigest,
} from "../marketplace-live-bind.js";

vi.mock("../portability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../portability.js")>();
  return {
    ...actual,
    exportEntity: vi.fn(),
  };
});

import { exportEntity } from "../portability.js";

const exportEntityMock = vi.mocked(exportEntity);

function sampleBundle(overrides: Partial<PortableBundle> = {}): PortableBundle {
  return {
    version: 1,
    kind: "skill",
    exportedAt: "2026-01-01T00:00:00.000Z",
    sourceId: "skill-1",
    title: "Weekly review",
    data: { body: "do the thing", version: 1 },
    ...overrides,
  };
}

function openBindDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
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
      stripe_connect_account_id TEXT,
      paypal_merchant_id TEXT,
      metamask_address TEXT,
      payout_preference TEXT,
      onboarding_status TEXT NOT NULL DEFAULT 'pending',
      public_handle TEXT,
      tos_accepted_version TEXT,
      tos_accepted_at TEXT,
      verified_seller INTEGER NOT NULL DEFAULT 0,
      verified_frozen INTEGER NOT NULL DEFAULT 0,
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
      catalog_plugin_ref TEXT,
      catalog_plugin_digest TEXT,
      live_resource_id TEXT,
      live_bundle_digest TEXT,
      live_bound_at TEXT,
      bundle_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'active',
      delivery_mode TEXT NOT NULL DEFAULT 'clone',
      pricing_model TEXT NOT NULL DEFAULT 'one_time',
      price_period TEXT,
      meter_unit TEXT,
      meter_rate INTEGER,
      license TEXT,
      inference_endpoint_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX marketplace_listings_seller_catalog_uidx
      ON marketplace_listings(seller_user_id, catalog_entry_id)
      WHERE catalog_entry_id IS NOT NULL AND status != 'archived';
  `);
  db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run("u-alice", "alice@example.test");
  db.prepare(`INSERT INTO tenants (id) VALUES (?)`).run("t-alice");
  return db;
}

describe("portableBundleDigest", () => {
  it("ignores exportedAt and hashes durable content", () => {
    const a = sampleBundle({ exportedAt: "2026-01-01T00:00:00.000Z" });
    const b = sampleBundle({ exportedAt: "2026-06-01T12:00:00.000Z" });
    expect(portableBundleDigest(a)).toBe(portableBundleDigest(b));
  });

  it("changes when durable payload drifts", () => {
    const a = sampleBundle();
    const b = sampleBundle({ data: { body: "changed", version: 1 } });
    expect(portableBundleDigest(a)).not.toBe(portableBundleDigest(b));
  });
});

describe("assertLiveListingBoundFresh", () => {
  const tenantDb = new Database(":memory:") as unknown as AppDatabase;

  beforeEach(() => {
    exportEntityMock.mockReset();
  });

  it("passes when re-export digest matches the bind pin", () => {
    const core = openBindDb();
    const pinned = sampleBundle();
    const digest = portableBundleDigest(pinned);
    exportEntityMock.mockReturnValue(sampleBundle({ exportedAt: "2026-08-01T00:00:00.000Z" }));
    expect(() =>
      assertLiveListingBoundFresh(core, tenantDb, {
        id: "listing-1",
        delivery_mode: "live",
        kind: "skill",
        live_resource_id: "skill-1",
        live_bundle_digest: digest,
      })
    ).not.toThrow();
  });

  it("demotes to draft when local export drifts from bind pin", () => {
    const core = openBindDb();
    core
      .prepare(
        `INSERT INTO marketplace_listings (
           id, seller_user_id, seller_tenant_id, kind, resource_id, title,
           delivery_mode, status, visibility, live_resource_id, live_bundle_digest
         ) VALUES (?, ?, ?, ?, ?, ?, 'live', 'active', 'public', ?, ?)`
      )
      .run(
        "listing-drift",
        "u-alice",
        "t-alice",
        "skill",
        "skill-1",
        "Live pack",
        "skill-1",
        portableBundleDigest(sampleBundle())
      );
    exportEntityMock.mockReturnValue(
      sampleBundle({ data: { body: "drifted", version: 2 } })
    );
    expect(() =>
      assertLiveListingBoundFresh(core, tenantDb, {
        id: "listing-drift",
        delivery_mode: "live",
        kind: "skill",
        live_resource_id: "skill-1",
        live_bundle_digest: portableBundleDigest(sampleBundle()),
      })
    ).toThrow(/drifted from the catalog pin/i);
    const row = core
      .prepare(`SELECT status, visibility FROM marketplace_listings WHERE id=?`)
      .get("listing-drift") as { status: string; visibility: string };
    expect(row).toEqual({ status: "draft", visibility: "private" });
  });

  it("demotes when bind columns are missing", () => {
    const core = openBindDb();
    core
      .prepare(
        `INSERT INTO marketplace_listings (
           id, seller_user_id, seller_tenant_id, kind, resource_id, title,
           delivery_mode, status, visibility
         ) VALUES (?, ?, ?, ?, ?, ?, 'live', 'active', 'public')`
      )
      .run("listing-unbound", "u-alice", "t-alice", "skill", "skill-1", "Unbound");
    expect(() =>
      assertLiveListingBoundFresh(core, tenantDb, {
        id: "listing-unbound",
        delivery_mode: "live",
        kind: "skill",
      })
    ).toThrow(/not bound/i);
    const row = core
      .prepare(`SELECT status FROM marketplace_listings WHERE id=?`)
      .get("listing-unbound") as { status: string };
    expect(row.status).toBe("draft");
  });
});

describe("demoteLiveListingsForCatalogPinChanges", () => {
  it("demotes live listings when catalog pluginRef or pluginDigest bumps", () => {
    const core = openBindDb();
    core
      .prepare(
        `INSERT INTO marketplace_listings (
           id, seller_user_id, seller_tenant_id, kind, resource_id, title,
           catalog_entry_id, catalog_plugin_ref, catalog_plugin_digest,
           delivery_mode, status, visibility
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 'active', 'public')`
      )
      .run(
        "listing-pin",
        "u-alice",
        "t-alice",
        "skill",
        "skill-1",
        "Live pack",
        "live-pack",
        "abc111",
        "digest-old"
      );
    const demoted = demoteLiveListingsForCatalogPinChanges(core, [
      {
        id: "live-pack",
        title: "Live pack",
        pluginRef: "abc222",
        pluginDigest: "digest-new",
        deliveryMode: "live",
        installType: "clone",
      },
    ]);
    expect(demoted).toBe(1);
    const row = core
      .prepare(`SELECT status, visibility FROM marketplace_listings WHERE id=?`)
      .get("listing-pin") as { status: string; visibility: string };
    expect(row).toEqual({ status: "draft", visibility: "private" });
  });
});

describe("claimOwnedCommunityCatalogListings deliveryMode live", () => {
  it("claims owned live catalog rows with delivery_mode=live", () => {
    const core = openBindDb();
    acceptMarketplaceTos(core, "u-alice");
    const tenantDb = new Database(":memory:") as unknown as AppDatabase;
    const orphans = claimOwnedCommunityCatalogListings(core, tenantDb, {
      sellerUserId: "u-alice",
      sellerTenantId: "t-alice",
      githubLogin: "alice",
      entries: [
        {
          id: "live-review-pack",
          title: "Live review",
          author: "alice",
          pluginRepo: "https://github.com/alice/live-review-pack",
          installType: "clone",
          kind: "skill",
          deliveryMode: "live",
          priceCents: 0,
        },
      ],
    });
    expect(orphans).toEqual([]);
    const row = core
      .prepare(
        `SELECT kind, catalog_entry_id, delivery_mode, status FROM marketplace_listings WHERE catalog_entry_id=?`
      )
      .get("live-review-pack") as {
      kind: string;
      catalog_entry_id: string;
      delivery_mode: string;
      status: string;
    };
    expect(row).toMatchObject({
      kind: "skill",
      catalog_entry_id: "live-review-pack",
      delivery_mode: "live",
      status: "draft",
    });
  });
});
