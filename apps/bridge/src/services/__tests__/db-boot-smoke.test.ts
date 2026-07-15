import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateTenantDb, TENANT_BOOT_MIGRATIONS } from "../../db.js";

const db = new Database(":memory:");
migrateTenantDb(db);

const firstVersions = db
  .prepare("SELECT version, name FROM schema_version ORDER BY version")
  .all() as Array<{ version: number; name: string }>;
assert.deepEqual(
  firstVersions.filter((row) => row.version >= 7),
  TENANT_BOOT_MIGRATIONS.map(({ version, name }) => ({ version, name }))
);
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

const firstSchemaCount = (
  db
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger', 'view')`
    )
    .get() as { count: number }
).count;
migrateTenantDb(db);
assert.equal(
  (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type IN ('table', 'index', 'trigger', 'view')`
      )
      .get() as { count: number }
  ).count,
  firstSchemaCount
);
assert.deepEqual(
  db.prepare("SELECT version, name FROM schema_version ORDER BY version").all(),
  firstVersions
);
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

db.close();
console.log("db-boot-smoke.test.ts: ok");
