#!/usr/bin/env node
/**
 * Read/write principal symmetry audit.
 * Flags ObjectTypes where agent-scoped list routes coexist with user-forced Record mutations.
 *
 * Strict mode fails when split_brain surfaces appear without a matching OPEN_DEBT entry
 * (P0-tasks-split / P0-cal-split cover TaskCard / CalendarEvent).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverReadWriteSymmetry } from "./audit-kernel-parity-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

const rows = discoverReadWriteSymmetry(repoRoot);
const split = rows.filter((r) => r.verdict === "split_brain");
const debt = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "scripts", "parity-report", "OPEN_DEBT.json"),
    "utf8"
  )
);
const allowed = new Set(debt.blockingIds ?? []);
const surfaceDebt = {
  TaskCard: "P0-tasks-split",
  CalendarEvent: "P0-cal-split",
};
const novel = split.filter((r) => !allowed.has(surfaceDebt[r.surface]));

console.log(`Kernel read/write symmetry: ${rows.length} surfaces, ${split.length} split_brain`);
for (const row of rows) {
  const mark = row.verdict === "ok_or_agent_only" ? "ok" : row.verdict;
  console.log(
    `  [${mark}] ${row.surface}: mutate=${row.mutatePrincipal}; agentLists=${row.listAgentRoutes.length}`
  );
}

if (strict && novel.length) {
  console.error(
    `\nRead/write symmetry failed: novel split_brain surfaces: ${novel
      .map((r) => r.surface)
      .join(", ")}`
  );
  process.exitCode = 1;
}
