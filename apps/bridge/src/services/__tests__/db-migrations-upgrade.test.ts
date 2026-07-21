import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  addCol,
  columnExists,
  runMigrations,
  type Migration,
} from "../db-migrations.js";
import { migrateStructureNodes } from "../structure-nodes-migration.js";
import { CORE_MIGRATIONS } from "../../core-db.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

function fixture(name: string): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
  return db;
}

function checksum(db: Database.Database, sql: string): string {
  const rows = db.prepare(sql).all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function foreignKeyViolations(db: Database.Database): unknown[] {
  return db.prepare("PRAGMA foreign_key_check").all();
}

{
  const db = fixture("historical-core.sql");
  const before = checksum(
    db,
    `SELECT u.id, u.email, u.display_name, t.id AS tenant_id, m.role
     FROM users u
     LEFT JOIN tenant_memberships m ON m.user_id=u.id
     LEFT JOIN tenants t ON t.id=m.tenant_id
     ORDER BY u.id`
  );
  db.exec(`
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO schema_version (version, name) VALUES (2, 'existing_higher_version');
  `);

  const coreMigrations: Migration[] = [
    {
      version: 1,
      name: "newly_introduced_lower_version",
      up: (target) => addCol(target, "users", "timezone", "TEXT"),
    },
    {
      version: 2,
      name: "existing_higher_version",
      up: () => assert.fail("an applied migration must not run again"),
    },
  ];
  runMigrations(db, coreMigrations);

  assert.equal(columnExists(db, "users", "timezone"), true);
  assert.deepEqual(
    db.prepare("SELECT version FROM schema_version ORDER BY version").all(),
    [{ version: 1 }, { version: 2 }]
  );
  assert.equal(
    checksum(
      db,
      `SELECT u.id, u.email, u.display_name, t.id AS tenant_id, m.role
       FROM users u
       LEFT JOIN tenant_memberships m ON m.user_id=u.id
       LEFT JOIN tenants t ON t.id=m.tenant_id
       ORDER BY u.id`
    ),
    before
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count,
    2
  );
  assert.deepEqual(foreignKeyViolations(db), []);

  runMigrations(db, coreMigrations);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as {
      count: number;
    }).count,
    2,
    "a second upgrade must be idempotent"
  );
  db.close();
}

{
  const db = fixture("historical-tenant.sql");
  const legacyStructureChecksum = checksum(
    db,
    `SELECT d.id, d.label, v.id AS division_id, p.id AS page_id, p.page_kind
     FROM departments d
     JOIN divisions v ON v.department_id=d.id
     JOIN division_pages p
       ON p.department_id=v.department_id AND p.division_id=v.id
     ORDER BY d.id, v.id, p.id`
  );
  const customStructureChecksum = checksum(
    db,
    `SELECT id, parent_id, label, icon, segment, kind, built_in, sort_order
     FROM structure_nodes WHERE id='custom-root'`
  );
  const tenantMigrations: Migration[] = [
    { version: 2, name: "structure_nodes_flatten_v1", up: migrateStructureNodes },
  ];

  runMigrations(db, tenantMigrations);

  assert.equal(
    checksum(
      db,
      `SELECT d.id, d.label, v.id AS division_id, p.id AS page_id, p.page_kind
       FROM departments d
       JOIN divisions v ON v.department_id=d.id
       JOIN division_pages p
         ON p.department_id=v.department_id AND p.division_id=v.id
       ORDER BY d.id, v.id, p.id`
    ),
    legacyStructureChecksum
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM structure_nodes").get() as {
      count: number;
    }).count,
    4
  );
  assert.equal(
    checksum(
      db,
      `SELECT id, parent_id, label, icon, segment, kind, built_in, sort_order
       FROM structure_nodes WHERE id='custom-root'`
    ),
    customStructureChecksum,
    "pre-existing custom structure must remain unchanged"
  );
  assert.deepEqual(
    db.prepare("SELECT agent_id FROM ai_agent_assignments ORDER BY agent_id").all(),
    [{ agent_id: "custom-agent" }],
    "unrelated assignments must survive structure cleanup"
  );
  assert.deepEqual(foreignKeyViolations(db), []);

  const after = checksum(
    db,
    `SELECT id, parent_id, label, segment, kind, built_in, sort_order
     FROM structure_nodes ORDER BY id`
  );
  runMigrations(db, tenantMigrations);
  assert.equal(
    checksum(
      db,
      `SELECT id, parent_id, label, segment, kind, built_in, sort_order
       FROM structure_nodes ORDER BY id`
    ),
    after
  );
  assert.deepEqual(foreignKeyViolations(db), []);
  db.close();
}

{
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE parent_rows (id TEXT PRIMARY KEY);
    CREATE TABLE child_rows (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL REFERENCES parent_rows(id)
    );
    INSERT INTO parent_rows VALUES ('parent-1');
    INSERT INTO child_rows VALUES ('child-1', 'parent-1');
  `);
  assert.throws(
    () =>
      runMigrations(db, [
        {
          version: 1,
          name: "unsafe_fk_rebuild",
          foreignKeysOff: true,
          up: (target) => {
            target.exec(`
              DROP TABLE parent_rows;
              CREATE TABLE parent_rows (id TEXT PRIMARY KEY);
            `);
          },
        },
      ]),
    /foreign key violation/
  );
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(db.prepare("SELECT id FROM parent_rows").all(), [
    { id: "parent-1" },
  ]);
  assert.equal(
    db.prepare("SELECT 1 FROM schema_version WHERE version=1").get(),
    undefined
  );

  runMigrations(db, [
    {
      version: 1,
      name: "safe_fk_rebuild",
      foreignKeysOff: true,
      up: (target) => {
        target.exec(`
          CREATE TABLE parent_rows_new (id TEXT PRIMARY KEY);
          INSERT INTO parent_rows_new SELECT id FROM parent_rows;
          DROP TABLE parent_rows;
          ALTER TABLE parent_rows_new RENAME TO parent_rows;
        `);
      },
    },
  ]);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(foreignKeyViolations(db), []);
  db.close();
}

{
  const db = fixture("historical-core.sql");
  const before = checksum(
    db,
    `SELECT 'listing' AS kind, id, title AS value FROM marketplace_listings
     UNION ALL SELECT 'message', id, body_text FROM dm_messages
     UNION ALL SELECT 'hook-run', id, status FROM hook_runs
     UNION ALL SELECT 'wiki', id, body_markdown FROM wiki_pages
     UNION ALL SELECT 'revision', id, body_markdown FROM wiki_revisions
     UNION ALL SELECT 'ticket', id, body FROM support_tickets
     ORDER BY kind, id`
  );

  runMigrations(db, CORE_MIGRATIONS);

  assert.equal(columnExists(db, "users", "password_hash"), true);
  assert.equal(columnExists(db, "marketplace_listings", "pricing_model"), true);
  assert.equal(columnExists(db, "dm_messages", "sender_kind"), true);
  assert.equal(columnExists(db, "wiki_pages", "embedding"), true);
  assert.equal(columnExists(db, "support_tickets", "target_kind"), true);
  assert.match(
    (
      db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hooks'")
        .get() as { sql: string }
    ).sql,
    /run_workflow/
  );
  assert.equal(
    (
      db.prepare(
        "SELECT COUNT(*) AS count FROM pragma_foreign_key_list('dm_conversation_members') WHERE `table`='users'"
      ).get() as { count: number }
    ).count,
    0
  );
  assert.equal(
    checksum(
      db,
      `SELECT 'listing' AS kind, id, title AS value FROM marketplace_listings
       UNION ALL SELECT 'message', id, body_text FROM dm_messages
       UNION ALL SELECT 'hook-run', id, status FROM hook_runs
       UNION ALL SELECT 'wiki', id, body_markdown FROM wiki_pages
       UNION ALL SELECT 'revision', id, body_markdown FROM wiki_revisions
       UNION ALL SELECT 'ticket', id, body FROM support_tickets
       ORDER BY kind, id`
    ),
    before
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM schema_version").get() as {
      count: number;
    }).count,
    CORE_MIGRATIONS.length
  );
  assert.deepEqual(foreignKeyViolations(db), []);

  const migrated = checksum(
    db,
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
  );
  runMigrations(db, CORE_MIGRATIONS);
  assert.equal(
    checksum(
      db,
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
    ),
    migrated,
    "a second core upgrade must be idempotent"
  );
  assert.deepEqual(foreignKeyViolations(db), []);
  db.close();
}

{
  const db = fixture("historical-core.sql");
  const interrupted: Migration = {
    version: 7,
    name: "interrupted_upgrade",
    up: (target) => {
      target.exec("CREATE TABLE interrupted_data (id TEXT PRIMARY KEY)");
      target.prepare("INSERT INTO interrupted_data VALUES (?)").run("partial");
      throw new Error("simulated interruption");
    },
  };
  assert.throws(() => runMigrations(db, [interrupted]), /simulated interruption/);
  assert.equal(
    db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='interrupted_data'"
    ).get(),
    undefined
  );
  assert.equal(
    db.prepare("SELECT 1 FROM schema_version WHERE version=7").get(),
    undefined
  );

  runMigrations(db, [
    {
      version: 7,
      name: "interrupted_upgrade",
      up: (target) => {
        target.exec("CREATE TABLE interrupted_data (id TEXT PRIMARY KEY)");
        target.prepare("INSERT INTO interrupted_data VALUES (?)").run("recovered");
      },
    },
  ]);
  assert.deepEqual(db.prepare("SELECT id FROM interrupted_data").all(), [
    { id: "recovered" },
  ]);
  assert.ok(db.prepare("SELECT 1 FROM schema_version WHERE version=7").get());
  assert.throws(() => addCol(db, "missing_table", "value", "TEXT"), /does not exist/);
  db.close();
}

console.log("db-migrations-upgrade.test.ts: ok");
