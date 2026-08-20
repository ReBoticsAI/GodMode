#!/usr/bin/env node
/**
 * P0 gate (#603): every static AI_TOOL_REGISTRY tool with write:true must appear
 * in scripts/ai-tool-parity-inventory.json with a classification + rationale.
 *
 * Usage:
 *   node scripts/audit-ai-tool-parity.mjs
 *   node scripts/audit-ai-tool-parity.mjs --strict
 *   node scripts/audit-ai-tool-parity.mjs --print-writers
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(
  repoRoot,
  "apps/bridge/src/services/ai-tools-registry.ts"
);
const inventoryPath = path.join(repoRoot, "scripts/ai-tool-parity-inventory.json");

export const PARITY_CLASSES = new Set([
  "kernel_generated",
  "protocol_exception",
  "infra_coding",
  "infra_llm",
  "infra_search",
  "legacy_gap",
]);

/**
 * @param {string} [filePath]
 * @returns {string[]}
 */
export function discoverStaticWriteToolNames(filePath = registryPath) {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  /** @param {ts.ObjectLiteralExpression} obj @param {string} name */
  function getProp(obj, name) {
    for (const p of obj.properties) {
      if (
        ts.isPropertyAssignment(p) &&
        ((ts.isIdentifier(p.name) && p.name.text === name) ||
          (ts.isStringLiteral(p.name) && p.name.text === name))
      ) {
        return p.initializer;
      }
    }
    return null;
  }

  /** @param {ts.Node | null | undefined} n */
  function lit(n) {
    if (!n) return null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
    return null;
  }

  const writers = new Set();
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const name = lit(getProp(node, "name"));
      const write = lit(getProp(node, "write"));
      if (typeof name === "string" && write === true) writers.add(name);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return [...writers].sort();
}

/**
 * @param {{ inventoryPath?: string, registryPath?: string, strict?: boolean }} [opts]
 */
export function auditAiToolParity(opts = {}) {
  const invPath = opts.inventoryPath ?? inventoryPath;
  const regPath = opts.registryPath ?? registryPath;
  const strict = opts.strict === true || process.argv.includes("--strict");

  const writers = discoverStaticWriteToolNames(regPath);
  const inventory = JSON.parse(fs.readFileSync(invPath, "utf8"));
  const tools = inventory.tools ?? {};
  const errors = [];
  const warnings = [];

  for (const name of writers) {
    const entry = tools[name];
    if (!entry) {
      errors.push(
        `Novel static write tool "${name}" is not in ${path.relative(repoRoot, invPath)}. Add a classification + rationale before merging.`
      );
      continue;
    }
    if (!PARITY_CLASSES.has(entry.class)) {
      errors.push(
        `Tool "${name}" has invalid class "${entry.class}" (expected one of ${[...PARITY_CLASSES].join(", ")})`
      );
    }
    if (!String(entry.rationale ?? "").trim()) {
      errors.push(`Tool "${name}" is missing a non-empty rationale`);
    }
  }

  for (const name of Object.keys(tools)) {
    if (!writers.includes(name)) {
      warnings.push(
        `Inventory lists "${name}" but it is not a static write:true tool in the registry (stale entry).`
      );
    }
  }

  return {
    ok: errors.length === 0,
    strict,
    writers,
    writerCount: writers.length,
    inventoryCount: Object.keys(tools).length,
    errors,
    warnings,
  };
}

function main() {
  if (process.argv.includes("--print-writers")) {
    console.log(JSON.stringify(discoverStaticWriteToolNames(), null, 2));
    return;
  }

  const result = auditAiToolParity({
    strict: process.argv.includes("--strict"),
  });

  for (const w of result.warnings) console.warn(`warn: ${w}`);
  for (const e of result.errors) console.error(`error: ${e}`);

  if (!result.ok) {
    console.error(
      `ai-tool parity: FAIL (${result.errors.length} error(s); ${result.writerCount} writers; inventory ${result.inventoryCount})`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `ai-tool parity: OK (${result.writerCount} static write tools inventoried)`
  );
  if (result.strict && result.warnings.length) {
    // Stale inventory entries are warnings only; do not fail strict yet so cleanup can land separately.
    console.warn(`ai-tool parity: ${result.warnings.length} stale inventory note(s)`);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
