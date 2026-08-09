#!/usr/bin/env node
/**
 * Detect and optionally rewrite commits in a git range that contain Cursor
 * Cloud co-author / Made-with trailers.
 *
 * Usage:
 *   node scripts/strip-cursor-attribution-range.mjs --check [--base SHA]
 *   node scripts/strip-cursor-attribution-range.mjs --rewrite --base SHA
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { messageHasCursorAttribution } from "./lib/strip-cursor-attribution.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILTER = path.resolve(__dirname, "strip-cursor-commit-msg-filter.mjs");

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseArgs(argv) {
  const out = { check: false, rewrite: false, base: "", head: "HEAD" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--rewrite") out.rewrite = true;
    else if (a === "--base") out.base = String(argv[++i] ?? "");
    else if (a === "--head") out.head = String(argv[++i] ?? "HEAD");
  }
  return out;
}

function resolveBase(explicit) {
  if (explicit) return explicit;
  const event = process.env.GITHUB_EVENT_NAME || "";
  const baseRef = process.env.GITHUB_BASE_REF;
  if (event === "pull_request" && baseRef) {
    try {
      execFileSync("git", ["fetch", "--depth=50", "origin", baseRef], {
        stdio: "ignore",
      });
    } catch {
      /* ignore */
    }
    return `origin/${baseRef}`;
  }
  try {
    return git(["merge-base", "HEAD", "origin/main"]);
  } catch {
    return git(["rev-parse", "HEAD~1"]);
  }
}

function listDirtyShas(base, head) {
  const range = `${base}..${head}`;
  let log;
  try {
    log = git(["log", "--format=%H%n%B%n---COMMIT---", range]);
  } catch {
    return [];
  }
  if (!log) return [];
  const dirty = [];
  for (const block of log.split("---COMMIT---")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const nl = trimmed.indexOf("\n");
    const sha = (nl >= 0 ? trimmed.slice(0, nl) : trimmed).trim();
    const body = nl >= 0 ? trimmed.slice(nl + 1) : "";
    if (sha && messageHasCursorAttribution(body)) dirty.push(sha);
  }
  return dirty;
}

const args = parseArgs(process.argv.slice(2));
if (!args.check && !args.rewrite) {
  console.error("Usage: --check and/or --rewrite [--base SHA] [--head SHA]");
  process.exit(2);
}

const base = resolveBase(args.base);
const head = args.head || "HEAD";
const dirty = listDirtyShas(base, head);

if (dirty.length === 0) {
  console.log("strip-cursor-attribution: ok (no Cursor trailers in range)");
  process.exit(0);
}

console.log(
  `strip-cursor-attribution: found ${dirty.length} commit(s) with Cursor trailers:`,
  dirty.map((s) => s.slice(0, 7)).join(", ")
);

if (args.check && !args.rewrite) {
  console.error(
    "Forbidden Cursor attribution in commit messages. Same-repo PRs are auto-stripped by .github/workflows/strip-cursor-attribution.yml; otherwise remove Co-authored-by: Cursor <cursoragent@cursor.com> (and Made-with: Cursor) and push again."
  );
  process.exit(1);
}

if (!args.rewrite) process.exit(0);

const baseSha = git(["rev-parse", base]);
const before = git(["rev-parse", head]);
process.env.FILTER_BRANCH_SQUELCH_WARNING = "1";
const node = process.execPath;
const msgFilter = `${JSON.stringify(node)} ${JSON.stringify(FILTER)}`;
try {
  execFileSync(
    "git",
    ["filter-branch", "-f", "--msg-filter", msgFilter, `${baseSha}..${head}`],
    { stdio: "inherit", env: process.env }
  );
} catch (err) {
  console.error("strip-cursor-attribution: filter-branch failed", err);
  process.exit(1);
}

const after = git(["rev-parse", "HEAD"]);
const still = listDirtyShas(baseSha, "HEAD");
if (still.length > 0) {
  console.error(
    "strip-cursor-attribution: rewrite left dirty commits:",
    still.map((s) => s.slice(0, 7)).join(", ")
  );
  process.exit(1);
}

console.log(
  `strip-cursor-attribution: rewrote ${before.slice(0, 7)} → ${after.slice(0, 7)}`
);
process.exit(0);
