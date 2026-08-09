#!/usr/bin/env node
/**
 * Fail CI when commit messages in the PR range (or recent main commits)
 * contain Cursor Cloud marketing attribution (cursoragent@cursor.com).
 *
 * IDE Attribution OFF does not apply to Cursor Cloud Agents / SDK; they still
 * inject Co-authored-by trailers. Public GodMode must not land those.
 */
import { execFileSync } from "node:child_process";

const TRAILER =
  /Co-authored-by:\s*Cursor\s*<[^>\n]*cursor\.com>|Made-with:\s*Cursor|cursoragent@cursor\.com/i;

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
      /* shallow clones may already have enough */
    }
    return `origin/${baseRef}..${sha}`;
  }
  // Push to main: scan the pushed tip only (merge commit / squash).
  return `${sha}^!`;
}

const range = rangeSpec();
let log;
try {
  log = git(["log", "--format=%H%n%B%n---", range]);
} catch (err) {
  // Empty range or missing parent on orphan; treat as pass.
  console.log(`audit-cursor-attribution: skip (${err instanceof Error ? err.message : err})`);
  process.exit(0);
}

if (!log || !TRAILER.test(log)) {
  console.log("audit-cursor-attribution: ok (no Cursor co-author trailers)");
  process.exit(0);
}

const hits = [];
for (const block of log.split("\n---\n")) {
  const lines = block.trim().split("\n");
  const sha = lines[0] || "";
  if (TRAILER.test(block)) hits.push(sha.slice(0, 7));
}

console.error(
  "audit-cursor-attribution: forbidden Cursor attribution in commit message(s):",
  hits.join(", ") || "(unknown)"
);
console.error(
  "Strip Co-authored-by: Cursor <cursoragent@cursor.com> (and Made-with: Cursor) before merge."
);
console.error(
  "GodMode git_commit strips these; prefer it over Cursor Cloud Agent commits on public repos."
);
process.exit(1);
