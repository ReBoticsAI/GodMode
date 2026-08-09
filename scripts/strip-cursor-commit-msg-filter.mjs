#!/usr/bin/env node
/**
 * stdin → stdout commit-message filter for git filter-branch / filter-repo.
 * Removes Cursor Cloud marketing attribution trailers.
 */
import { stripCursorAttributionMessage } from "./lib/strip-cursor-attribution.mjs";

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
});
process.stdin.on("end", () => {
  process.stdout.write(stripCursorAttributionMessage(buf));
});
