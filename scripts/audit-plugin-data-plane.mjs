#!/usr/bin/env node
/**
 * Fail CI when a godmode.plugin.json seeds native ObjectType tables on the
 * workspace DB without dataPlane: "core-records".
 *
 * Scans plugins/, scaffold trees, and test fixtures.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function normPath(rel) {
  return path.normalize(rel).replaceAll("\\", "/");
}

function walkManifests(dir, out = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return out;
  for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" ||
        ent.name === ".git" ||
        ent.name === "dist" ||
        ent.name === "coverage"
      ) {
        continue;
      }
      walkManifests(rel, out);
    } else if (ent.name === "godmode.plugin.json") {
      out.push(rel);
    }
  }
  return out;
}

function objectTypeIsNative(ot) {
  if (!ot || typeof ot !== "object") return false;
  const storage = ot.storage;
  if (!storage || typeof storage !== "object") {
    // Legacy / incomplete shapes that imply workspace materialization.
    return true;
  }
  return storage.kind === "native";
}

const scanRoots = [
  "plugins",
  "apps/bridge/data/scaffolds",
  "apps/bridge/src/plugins/__tests__/fixtures",
];

const manifests = scanRoots.flatMap((dir) => walkManifests(dir));

for (const rel of manifests) {
  const full = path.join(root, rel);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (err) {
    errors.push(`${normPath(rel)}: invalid JSON (${err instanceof Error ? err.message : err})`);
    continue;
  }
  if (!raw || typeof raw !== "object") {
    errors.push(`${normPath(rel)}: expected object`);
    continue;
  }
  const dataPlane = raw.dataPlane ?? "domain";
  if (dataPlane === "core-records") continue;
  if (dataPlane !== "domain" && dataPlane !== "core-records") {
    errors.push(
      `${normPath(rel)}: dataPlane must be "domain" or "core-records" (got ${JSON.stringify(dataPlane)})`
    );
    continue;
  }
  const objectTypes = Array.isArray(raw.objectTypes) ? raw.objectTypes : [];
  const natives = objectTypes.filter(objectTypeIsNative);
  if (!natives.length) continue;
  const names = natives
    .map((ot) => (typeof ot?.name === "string" ? ot.name : "?"))
    .join(", ");
  errors.push(
    `${normPath(rel)}: native ObjectType(s) [${names}] require dataPlane: "core-records" ` +
      `(plugin business data uses openPluginDb / dataPlane "domain")`
  );
}

if (errors.length) {
  console.error("audit-plugin-data-plane failed:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `audit-plugin-data-plane ok (${manifests.length} manifest${manifests.length === 1 ? "" : "s"})`
);
