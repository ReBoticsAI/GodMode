#!/usr/bin/env node
/**
 * Fail-closed ownership / split-brain parity gate.
 * Detects agent Chat UI listing agent boards while Record mutations force user ownership,
 * and HTTP Record context missing agentId (silent intelligence fallback).
 *
 * Strict mode fails on NEW blocking findings not listed in
 * scripts/parity-report/OPEN_DEBT.json (known debt until dual-model restore).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverOwnershipParityFindings } from "./audit-kernel-parity-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

const findings = discoverOwnershipParityFindings(repoRoot);
const blocking = findings.filter((f) => f.severity === "P0" || f.class === "split_brain");
const debtPath = path.join(repoRoot, "scripts", "parity-report", "OPEN_DEBT.json");
const debt = JSON.parse(fs.readFileSync(debtPath, "utf8"));
const allowed = new Set(debt.blockingIds ?? []);
const novel = blocking.filter((f) => !allowed.has(f.id));
const stale = [...allowed].filter((id) => !blocking.some((f) => f.id === id));

console.log(
  `Kernel ownership parity: ${findings.length} finding(s) (${blocking.length} blocking, ${novel.length} novel, ${stale.length} stale debt)`
);
for (const f of findings) {
  const tag = allowed.has(f.id) ? "known" : f.severity === "P0" || f.class === "split_brain" ? "NOVEL" : f.severity;
  console.log(`  [${tag}] ${f.id} (${f.class}): ${f.summary}`);
}
if (stale.length) {
  console.log(`  Stale OPEN_DEBT ids (fixed? remove from OPEN_DEBT.json): ${stale.join(", ")}`);
}

if (strict && (novel.length || stale.length)) {
  if (novel.length) {
    console.error(
      `\nOwnership parity failed: ${novel.length} NEW blocking finding(s) not in OPEN_DEBT.json.`
    );
  }
  if (stale.length) {
    console.error(
      `Ownership parity failed: OPEN_DEBT.json lists fixed ids — remove ${stale.join(", ")}.`
    );
  }
  process.exitCode = 1;
}
