import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const debtPath = path.join(root, "scripts/oss-debt.json");
const schemaPath = path.join(root, "scripts/oss-debt.schema.json");

test("oss-debt.json is valid JSON with required fields", () => {
  assert.ok(fs.existsSync(debtPath), "scripts/oss-debt.json must exist");
  assert.ok(fs.existsSync(schemaPath), "scripts/oss-debt.schema.json must exist");
  const debt = JSON.parse(fs.readFileSync(debtPath, "utf8"));
  assert.equal(typeof debt.version, "number");
  assert.ok(debt.version >= 1);
  assert.ok(Array.isArray(debt.entries), "entries must be an array");

  const owners = new Set(["sierra", "polymarket", "core-scrub"]);
  const seen = new Set();
  for (const entry of debt.entries) {
    assert.equal(typeof entry.path, "string");
    assert.ok(entry.path.length > 0, "path required");
    assert.ok(owners.has(entry.owner), `invalid owner: ${entry.owner}`);
    assert.ok(
      Number.isInteger(entry.phase) && entry.phase >= 1 && entry.phase <= 4,
      `invalid phase: ${entry.phase}`
    );
    assert.equal(typeof entry.reason, "string");
    assert.ok(entry.reason.length > 0, "reason required");
    const key = entry.path.replaceAll("\\", "/");
    assert.ok(!seen.has(key), `duplicate debt path: ${key}`);
    seen.add(key);
  }
});

test("every oss-debt entry path still exists on disk", () => {
  const debt = JSON.parse(fs.readFileSync(debtPath, "utf8"));
  const missing = [];
  for (const entry of debt.entries) {
    const full = path.join(root, entry.path);
    if (!fs.existsSync(full)) missing.push(entry.path);
  }
  assert.deepEqual(missing, [], `stale debt paths: ${missing.join(", ")}`);
});
