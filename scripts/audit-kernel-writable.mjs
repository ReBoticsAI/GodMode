#!/usr/bin/env node
/**
 * Fail when:
 * 1) apps/web createDto/updateDto object literals send fields outside domain writable
 * 2) adapter *_WRITABLE sets include fields outside domain writable
 *
 * Prevents the TaskCard column_id / agent_id class of silent UI failures.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAPTER_WRITABLE_OBJECT_TYPES,
  discoverAdapterWritableSets,
  discoverClientRecordPayloads,
  discoverKernelSchema,
} from "./audit-kernel-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

const schema = discoverKernelSchema(repoRoot);
const payloads = discoverClientRecordPayloads(repoRoot);
const adapterSets = discoverAdapterWritableSets(repoRoot);

const errors = [];

for (const payload of payloads) {
  const def = schema.get(payload.objectType);
  if (!def) {
    errors.push(
      `${payload.file}:${payload.line} ${payload.kind}("${payload.objectType}") — unknown ObjectType`
    );
    continue;
  }
  const allowed = new Set(def.writable);
  if (payload.kind === "createDto") allowed.add("id");
  for (const field of payload.fields) {
    if (!allowed.has(field)) {
      errors.push(
        `${payload.file}:${payload.line} ${payload.kind}("${payload.objectType}") sends non-writable field "${field}"`
      );
    }
  }
}

for (const set of adapterSets) {
  const objectType = ADAPTER_WRITABLE_OBJECT_TYPES[set.name];
  if (!objectType) continue;
  const def = schema.get(objectType);
  if (!def) {
    errors.push(`${set.file} ${set.name} maps to unknown ObjectType ${objectType}`);
    continue;
  }
  for (const field of set.fields) {
    if (!def.writable.has(field) && field !== "id") {
      errors.push(
        `${set.file} ${set.name} includes "${field}" which is not in ${objectType} domain writable`
      );
    }
  }
}

if (errors.length) {
  console.error(`Kernel writable contract: ${errors.length} issue(s)`);
  for (const error of errors) console.error(`  - ${error}`);
  if (strict) process.exitCode = 1;
} else {
  console.log(
    `Kernel writable contract: ok (${payloads.length} client payloads, ${
      adapterSets.filter((s) => ADAPTER_WRITABLE_OBJECT_TYPES[s.name]).length
    } adapter sets)`
  );
}
