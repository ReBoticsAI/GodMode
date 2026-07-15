#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const audits = ["audit-kernel-coverage.mjs", "audit-kernel-direct-writes.mjs"];
let failed = false;

for (const audit of audits) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, audit), "--strict"], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed = true;
}

if (failed) process.exitCode = 1;
