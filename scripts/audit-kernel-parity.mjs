#!/usr/bin/env node
/**
 * Full product-parity report for kernel migration re-audit.
 * Prints markdown and writes artifacts/kernel-parity-report.json (gitignored).
 *
 * Usage:
 *   npm run audit:kernel:parity
 *   node scripts/audit-kernel-parity.mjs [--strict] [--evidence path/to/evidence.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDomainGapMatrix,
  formatParityMarkdown,
} from "./audit-kernel-parity-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const evidenceIdx = process.argv.indexOf("--evidence");
let evidence = {};
if (evidenceIdx >= 0 && process.argv[evidenceIdx + 1]) {
  const evidencePath = path.resolve(process.argv[evidenceIdx + 1]);
  evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
}

const report = buildDomainGapMatrix(repoRoot, evidence);
const markdown = formatParityMarkdown(report);

const outDir = path.join(repoRoot, "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "kernel-parity-report.json");
const mdPath = path.join(outDir, "kernel-parity-report.md");
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
fs.writeFileSync(mdPath, markdown);

console.log(markdown);
console.log(`Wrote ${slashRel(jsonPath)} and ${slashRel(mdPath)}`);

const blocking = report.findings.filter(
  (f) => f.severity === "P0" || f.class === "split_brain"
);
const debtPath = path.join(repoRoot, "scripts", "parity-report", "OPEN_DEBT.json");
const debt = JSON.parse(fs.readFileSync(debtPath, "utf8"));
const allowed = new Set(debt.blockingIds ?? []);
const novel = blocking.filter((f) => !allowed.has(f.id));
const stale = [...allowed].filter((id) => !blocking.some((f) => f.id === id));

if (strict && (novel.length || stale.length)) {
  if (novel.length) {
    console.error(`\nParity report: ${novel.length} NEW blocking finding(s) not in OPEN_DEBT.json.`);
  }
  if (stale.length) {
    console.error(
      `Parity report: OPEN_DEBT.json lists fixed ids — remove ${stale.join(", ")}.`
    );
  }
  process.exitCode = 1;
} else if (blocking.length) {
  console.log(
    `\nParity report: ${blocking.length} known blocking finding(s) tracked in OPEN_DEBT.json (recommendation: ${debt.recommendation}).`
  );
}

function slashRel(absolute) {
  return path.relative(repoRoot, absolute).replaceAll("\\", "/");
}
