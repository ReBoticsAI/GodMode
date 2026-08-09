#!/usr/bin/env node
/**
 * Fail CI when commit messages in the PR range (or recent main commits)
 * contain Cursor Cloud marketing attribution (cursoragent@cursor.com).
 *
 * Same-repo PRs are auto-rewritten by .github/workflows/strip-cursor-attribution.yml
 * before merge; this audit is the hard gate if rewrite did not run or is a fork.
 */
import { execFileSync } from "node:child_process";
import { messageHasCursorAttribution } from "./lib/strip-cursor-attribution.mjs";

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function rangeSpec() {
  const event = process.env.GITHUB_EVENT_NAME || "";
  const sha = process.env.GITHUB_SHA || "HEAD";
  const baseRef = process.env.GITHUB_BASE_REF;
  if (event === "pull_request" && baseRef) {
    try {
      execFileSync("git", ["fetch", "--depth=50", "origin", baseRef], {
        stdio: "ignore",
      });
    } catch {
      /* bridge not up yet or shallow */
    }
    return `origin/${baseRef}..${sha}`;
  }
  return `${sha}^!`;
}

const range = rangeSpec();
let log;
try {
  log = git(["log", "--format=%H%n%B%n---COMMIT---", range]);
} catch (err) {
  console.log(
    `audit-cursor-attribution: skip (${err instanceof Error ? err.message : err})`
  );
  process.exit(0);
}

if (!log) {
  console.log("audit-cursor-attribution: ok (empty range)");
  process.exit(0);
}

const hits = [];
for (const block of log.split("---COMMIT---")) {
  const trimmed = block.trim();
  if (!trimmed) continue;
  const nl = trimmed.indexOf("\n");
  const sha = (nl >= 0 ? trimmed.slice(0, nl) : trimmed).trim();
  const body = nl >= 0 ? trimmed.slice(nl + 1) : "";
  if (sha && messageHasCursorAttribution(body)) hits.push(sha.slice(0, 7));
}

if (hits.length === 0) {
  console.log("audit-cursor-attribution: ok (no Cursor co-author trailers)");
  process.exit(0);
}

console.error(
  "audit-cursor-attribution: forbidden Cursor attribution in commit message(s):",
  hits.join(", ")
);
console.error(
  "Same-repo PRs: wait for strip-cursor-attribution workflow to rewrite, or push a clean branch."
);
console.error(
  "Forks / manual: remove Co-authored-by: Cursor <cursoragent@cursor.com> (and Made-with: Cursor)."
);
process.exit(1);
