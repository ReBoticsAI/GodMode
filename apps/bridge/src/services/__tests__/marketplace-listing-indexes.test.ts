import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../core-db.js";
import { columnExists, runMigrations } from "../db-migrations.js";

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
});
