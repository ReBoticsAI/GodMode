import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../core-db.js";
import { columnExists, runMigrations } from "../db-migrations.js";
import { buildPublicListingsSql } from "../../routes/marketplace.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("marketplace listing indexes", () => {
  it("dedupes catalog claims then unique-indexes seller+catalog_entry_id", () => {
    const db = new Database(":memory:");
    db.exec(fs.readFileSync(path.join(fixturesDir, "historical-core.sql"), "utf8"));
    runMigrations(
      db,
      CORE_MIGRATIONS.filter((m) => m.version < 15)
    );
    expect(columnExists(db, "marketplace_listings", "catalog_entry_id")).toBe(true);

    const insert = db.prepare(
      `INSERT INTO marketplace_listings
         (id, seller_user_id, seller_tenant_id, kind, resource_id, title, bundle_json, catalog_entry_id)
       VALUES (?, 'user-1', 'tenant-1', 'plugin', ?, ?, '{}', 'community-ping')`
    );
    insert.run("dup-1", "community-ping", "Community Ping");
    insert.run("dup-2", "community-ping", "Community Ping copy");

    runMigrations(db, CORE_MIGRATIONS);

    const rows = db
      .prepare(
        `SELECT id FROM marketplace_listings WHERE catalog_entry_id='community-ping' AND status != 'archived'`
      )
      .all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("dup-1");

    expect(() =>
      insert.run("dup-3", "community-ping", "Community Ping again")
    ).toThrow(/UNIQUE constraint failed/i);

    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='marketplace_listings_seller_catalog_uidx'`
      )
      .get() as { name: string } | undefined;
    expect(idx?.name).toBe("marketplace_listings_seller_catalog_uidx");
    db.close();
  });

  it("adds verified_frozen after commerce migration 11 already applied", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE marketplace_seller_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        stripe_connect_account_id TEXT,
        paypal_merchant_id TEXT,
        metamask_address TEXT
      );
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
        visibility TEXT DEFAULT 'public',
        status TEXT DEFAULT 'active',
        delivery_mode TEXT,
        pricing_model TEXT,
        price_period TEXT,
        meter_unit TEXT,
        meter_rate INTEGER,
        license TEXT,
        inference_endpoint_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const insertVersion = db.prepare(
      `INSERT INTO schema_version (version, name) VALUES (?, ?)`
    );
    for (const m of CORE_MIGRATIONS.filter((row) => row.version < 16)) {
      insertVersion.run(m.version, m.name);
    }
    expect(columnExists(db, "marketplace_seller_accounts", "verified_frozen")).toBe(false);

    runMigrations(db, CORE_MIGRATIONS);

    expect(columnExists(db, "marketplace_seller_accounts", "verified_frozen")).toBe(true);
    expect(columnExists(db, "marketplace_seller_accounts", "verified_seller")).toBe(true);
    const { sql, params } = buildPublicListingsSql({ sellerKind: "user" });
    expect(() => db.prepare(sql).all(...params)).not.toThrow();
    db.close();
  });
});
