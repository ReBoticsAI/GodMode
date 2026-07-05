const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = path.join(process.env.APPDATA, "GodMode", "platform.db");
const specPath = path.resolve(
  __dirname,
  "..",
  "apps",
  "bridge",
  "data",
  "example-playbook.json"
);

const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
const db = new Database(dbPath);

db.prepare(
  `INSERT INTO playbooks (id, name, version, spec_json, status)
   VALUES (?, ?, ?, ?, 'draft')
   ON CONFLICT(id) DO UPDATE SET
     name = excluded.name,
     version = excluded.version,
     spec_json = excluded.spec_json,
     updated_at = datetime('now')`
).run(spec.id, spec.name, spec.version, JSON.stringify(spec));

console.log(`seeded ${spec.id} v${spec.version}`);
