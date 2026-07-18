import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  acquireCloneListing,
  type CloneAcquisitionFailurePoint,
} from "../marketplace-listings.js";

const failurePoints: CloneAcquisitionFailurePoint[] = [
  "before_operation_registered",
  "after_operation_registered",
  "before_tenant_imported",
  "after_tenant_imported",
  "before_purchase_recorded",
  "after_purchase_recorded",
  "before_completed",
  "after_completed",
];

function workflowBundle(sourceId = "workflow-source") {
  return {
    version: 1 as const,
    kind: "workflow" as const,
    exportedAt: "2026-01-01T00:00:00.000Z",
    sourceId,
    title: "Imported workflow",
    data: {
      workflow: {
        id: sourceId,
        name: "Imported workflow",
        config_json: "{}",
        enabled: 1,
        agent_id: "intelligence",
      },
    },
  };
}

function coreDb() {
  const db = new Database(":memory:");
  db.exec(`
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
      bundle_json TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'active',
      delivery_mode TEXT NOT NULL DEFAULT 'clone'
    );
    CREATE TABLE marketplace_purchases (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      buyer_tenant_id TEXT NOT NULL,
      price_credits INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO marketplace_listings
     (id, seller_user_id, seller_tenant_id, kind, resource_id, title,
      bundle_json, visibility, status, delivery_mode)
     VALUES ('listing-a', 'seller', 'seller-tenant', 'workflow', 'workflow-source',
             'Imported workflow', ?, 'public', 'active', 'clone')`
  ).run(JSON.stringify(workflowBundle()));
  db.prepare(
    `INSERT INTO marketplace_listings
     (id, seller_user_id, seller_tenant_id, kind, resource_id, title,
      bundle_json, visibility, status, delivery_mode)
     VALUES ('listing-b', 'seller', 'seller-tenant', 'workflow', 'workflow-other',
             'Other workflow', ?, 'public', 'active', 'clone')`
  ).run(JSON.stringify(workflowBundle("workflow-other")));
  return db;
}

function tenantDb(withWorkflowTable = true) {
  const db = new Database(":memory:");
  if (withWorkflowTable) {
    db.exec(`
      CREATE TABLE ai_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        agent_id TEXT NOT NULL
      );
    `);
  }
  return db;
}

function acquire(
  core: Database.Database,
  tenant: Database.Database,
  overrides: Partial<{
    listingId: string;
    buyerUserId: string;
    buyerTenantId: string;
    idempotencyKey: string;
  }> = {},
  fail?: (point: CloneAcquisitionFailurePoint) => void
) {
  return acquireCloneListing(
    { core, buyerTenant: tenant },
    {
      listingId: "listing-a",
      buyerUserId: "buyer-a",
      buyerTenantId: "tenant-a",
      idempotencyKey: "acquire-once",
      ...overrides,
    },
    { fail }
  );
}

describe("cross-database marketplace clone acquisition", () => {
  for (const failurePoint of failurePoints) {
    it(`recovers a crash at ${failurePoint}`, () => {
      const core = coreDb();
      const tenant = tenantDb();
      let injected = false;

      expect(() =>
        acquire(core, tenant, {}, (point) => {
          if (!injected && point === failurePoint) {
            injected = true;
            throw new Error(`crash:${point}`);
          }
        })
      ).toThrow(`crash:${failurePoint}`);

      const result = acquire(core, tenant) as Record<string, unknown>;
      expect(result).toMatchObject({ ok: true, status: "completed" });
      expect(core.prepare(`SELECT count(*) AS n FROM marketplace_purchases`).get()).toEqual({
        n: 1,
      });
      expect(tenant.prepare(`SELECT count(*) AS n FROM ai_workflows`).get()).toEqual({ n: 1 });
      expect(
        core.prepare(`SELECT count(*) AS n FROM marketplace_acquisition_steps`).get()
      ).toEqual({ n: 4 });
    });
  }

  it("returns the original result for duplicate idempotency keys", () => {
    const core = coreDb();
    const tenant = tenantDb();
    const first = acquire(core, tenant);
    const duplicate = acquire(core, tenant);

    expect(duplicate).toEqual(first);
    expect(core.prepare(`SELECT count(*) AS n FROM marketplace_purchases`).get()).toEqual({
      n: 1,
    });
    expect(tenant.prepare(`SELECT count(*) AS n FROM ai_workflows`).get()).toEqual({ n: 1 });
  });

  it("rejects reuse of a key for a different listing", () => {
    const core = coreDb();
    const tenant = tenantDb();
    acquire(core, tenant);
    expect(() => acquire(core, tenant, { listingId: "listing-b" })).toThrow(
      /different listing/i
    );
  });

  it("rolls back a failed tenant import and safely resumes", () => {
    const core = coreDb();
    const tenant = tenantDb(false);

    expect(() => acquire(core, tenant)).toThrow(/ai_workflows/i);
    expect(
      tenant.prepare(`SELECT count(*) AS n FROM marketplace_acquisition_imports`).get()
    ).toEqual({ n: 0 });
    expect(
      core.prepare(`SELECT status FROM marketplace_acquisition_operations`).get()
    ).toEqual({ status: "registered" });

    tenant.exec(`
      CREATE TABLE ai_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        agent_id TEXT NOT NULL
      );
    `);
    expect(acquire(core, tenant)).toMatchObject({ ok: true, status: "completed" });
  });

  it("isolates equal keys and imports across buyer tenants", () => {
    const core = coreDb();
    const tenantA = tenantDb();
    const tenantB = tenantDb();

    const resultA = acquire(core, tenantA);
    const resultB = acquire(core, tenantB, {
      buyerUserId: "buyer-b",
      buyerTenantId: "tenant-b",
    });

    expect(resultA.operationId).not.toBe(resultB.operationId);
    expect(core.prepare(`SELECT count(*) AS n FROM marketplace_purchases`).get()).toEqual({
      n: 2,
    });
    expect(tenantA.prepare(`SELECT count(*) AS n FROM ai_workflows`).get()).toEqual({ n: 1 });
    expect(tenantB.prepare(`SELECT count(*) AS n FROM ai_workflows`).get()).toEqual({ n: 1 });
    expect(
      tenantA.prepare(`SELECT DISTINCT tenant_id FROM marketplace_acquisition_audit`).all()
    ).toEqual([{ tenant_id: "tenant-a" }]);
    expect(
      tenantB.prepare(`SELECT DISTINCT tenant_id FROM marketplace_acquisition_audit`).all()
    ).toEqual([{ tenant_id: "tenant-b" }]);
  });

  it("commits audit and outbox receipts with each database-owned step", () => {
    const core = coreDb();
    const tenant = tenantDb();
    acquire(core, tenant);

    expect(
      core.prepare(`SELECT count(*) AS n FROM marketplace_acquisition_audit`).get()
    ).toEqual({ n: 4 });
    expect(
      core.prepare(`SELECT count(*) AS n FROM marketplace_acquisition_outbox`).get()
    ).toEqual({ n: 4 });
    expect(
      tenant.prepare(`SELECT count(*) AS n FROM marketplace_acquisition_audit`).get()
    ).toEqual({ n: 1 });
    expect(
      tenant.prepare(`SELECT count(*) AS n FROM marketplace_acquisition_outbox`).get()
    ).toEqual({ n: 1 });
  });
});
