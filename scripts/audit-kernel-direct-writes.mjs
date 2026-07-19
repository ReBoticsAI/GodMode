#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  constMap,
  formatLocations,
  lineOf,
  slash,
  sourceFile,
  staticText,
  visit,
  walkFiles,
} from "./audit-kernel-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const verbose = process.argv.includes("--verbose");
const PROGRESS_CEILING = 19;
const SQL_WRITE = /^\s*(?:WITH\b[\s\S]*?\b)?(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i;
const FILE_WRITE_METHODS = new Set([
  "appendFile",
  "appendFileSync",
  "copyFile",
  "copyFileSync",
  "mkdir",
  "mkdirSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "unlink",
  "unlinkSync",
  "writeFile",
  "writeFileSync",
]);

function excluded(relative) {
  return (
    /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)/.test(relative) ||
    /\.test\.[^.]+$/.test(relative) ||
    /(?:^|\/)adapters(?:\/|$)/.test(relative) ||
    /migration/i.test(path.basename(relative)) ||
    /^scripts\/audit-kernel/.test(relative) ||
    // CI artifact builders and privileged host updaters are not application
    // mutation entrypoints; their writes are their explicit operating contract.
    /^scripts\/(?:release|update|backup|features)\//.test(relative)
  );
}

export function entrypointFiles(root) {
  const files = [
    ...walkFiles(path.join(root, "apps", "bridge", "src", "routes"), new Set([".ts"])),
    ...walkFiles(path.join(root, "apps", "bridge", "src", "plugins"), new Set([".ts"])),
    ...walkFiles(path.join(root, "scripts")),
    ...walkFiles(path.join(root, "apps", "connector", "src")),
    path.join(root, "apps", "bridge", "src", "bootstrap.ts"),
    path.join(root, "apps", "bridge", "src", "services", "ai-tool-executor.ts"),
  ];
  return [...new Set(files)].filter((file) => !excluded(slash(path.relative(root, file))));
}

export function discoverDirectWrites(root, files = entrypointFiles(root)) {
  const writes = [];
  for (const file of files) {
    const relative = slash(path.relative(root, file));
    const source = sourceFile(file);
    const constants = constMap([file]);
    visit(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const method = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : "";
      if (method === "prepare" || method === "exec") {
        const sql = staticText(node.arguments[0], constants);
        const fallback = node.arguments[0]?.getText(source) ?? "";
        const match = (sql ?? fallback.replace(/^['"`]|['"`]$/g, "")).match(SQL_WRITE);
        if (match) {
          writes.push({
            kind: "sql",
            operation: match[1].toUpperCase(),
            file: relative,
            line: lineOf(source, node),
          });
        }
      }
      if (FILE_WRITE_METHODS.has(method)) {
        writes.push({
          kind: "filesystem",
          operation: method,
          file: relative,
          line: lineOf(source, node),
        });
      }
    });
  }
  return writes;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const writes = discoverDirectWrites(repoRoot);
  const byKind = Object.fromEntries(
    ["sql", "filesystem"].map((kind) => [kind, writes.filter((write) => write.kind === kind).length])
  );

  console.log(`Kernel direct-write audit (${strict ? "strict" : "progress"})`);
  console.log(JSON.stringify({ directWrites: writes.length, ...byKind }, null, 2));
  if (verbose && writes.length) {
    console.log(
      `\nDirect durable writes in entrypoints:\n${formatLocations(
        writes,
        (write) => `${write.kind}:${write.operation}`
      )}`
    );
  }

  const errors = [];
  if (writes.length > PROGRESS_CEILING) {
    errors.push(`directWrites regressed: ${writes.length} exceeds migration ceiling ${PROGRESS_CEILING}`);
  }
  if (strict && writes.length) {
    errors.push(`strict completion requires directWrites=0 (found ${writes.length})`);
  }
  if (errors.length) {
    console.error("\nKernel direct-write audit FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      strict
        ? "\nKernel strict direct-write audit passed."
        : "\nKernel direct-write progress audit passed; debt ceiling did not regress."
    );
  }
}
