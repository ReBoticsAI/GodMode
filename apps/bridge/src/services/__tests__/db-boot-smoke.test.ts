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

const tradingTables = db
  .prepare(
    `SELECT name FROM sqlite_master WHERE type='table'
     AND (
       name GLOB 'sc_*'
       OR name IN ('playbooks', 'backtest_runs', 'backtest_sweeps', 'backtest_trades', 'pm_signals')
     )
     ORDER BY name`
  )
  .all() as Array<{ name: string }>;
assert.deepEqual(
  tradingTables,
  [],
  "vanilla OSS tenant boot must not create trading plugin tables"
);

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
