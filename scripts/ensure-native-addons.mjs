#!/usr/bin/env node
/**
 * Root `.npmrc` sets `ignore-scripts=true` so Cloudflare Pages' auto
 * `npm clean-install` does not compile native addons on the marketing builder.
 * GitHub Actions overrides with `NPM_CONFIG_IGNORE_SCRIPTS=false`.
 *
 * Local `npm install` / `npm ci` therefore skip better-sqlite3 / duckdb /
 * node-pty install scripts. This helper rebuilds them when the Bridge cannot
 * load the addon (or when `--force` is passed). Prefer running from the repo
 * root; do not `npm install` / `npm rebuild` under `apps/bridge` (that creates
 * a nested copy and leaves the hoisted package without bindings).
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgePkg = path.join(root, "apps", "bridge", "package.json");
const nestedNativeRoot = path.join(root, "apps", "bridge", "node_modules");

/** Packages Bridge needs with install scripts skipped by root `.npmrc`. */
const NATIVE_PACKAGES = ["better-sqlite3", "duckdb", "node-pty"];

/** Fail the ensure step if these still cannot load after rebuild. */
const REQUIRED = new Set(["better-sqlite3"]);

const force = process.argv.includes("--force");

function bridgeRequire() {
  return createRequire(bridgePkg);
}

function isInstalled(name) {
  try {
    bridgeRequire().resolve(name);
    return true;
  } catch {
    return false;
  }
}

function canLoad(name) {
  try {
    bridgeRequire()(name);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(name) {
  try {
    return bridgeRequire().resolve(name);
  } catch {
    return null;
  }
}

function packagesNeedingRebuild() {
  return NATIVE_PACKAGES.filter((name) => {
    if (!isInstalled(name)) return false;
    if (force) return true;
    return !canLoad(name);
  });
}

function warnNestedCopies() {
  for (const name of NATIVE_PACKAGES) {
    const resolved = resolvePath(name);
    if (!resolved) continue;
    const nestedPkg = path.join(nestedNativeRoot, name);
    const nestedPrefix = nestedPkg + path.sep;
    if (resolved === nestedPkg || resolved.startsWith(nestedPrefix)) {
      console.warn(
        `[ensure-native-addons] ${name} resolved under apps/bridge/node_modules. ` +
          "Rebuild from the repo root (not apps/bridge) and remove that nested folder " +
          "so the lockfile-hoisted package keeps bindings: npm run rebuild:natives",
      );
    }
  }
}

function runRebuild(packages) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(
    `[ensure-native-addons] Rebuilding ${packages.join(", ")} ` +
      `(root .npmrc ignore-scripts skipped their install builds)`,
  );
  const result = spawnSync(npm, ["rebuild", ...packages], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_ignore_scripts: "",
      NPM_CONFIG_IGNORE_SCRIPTS: "false",
    },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(
      "[ensure-native-addons] npm rebuild failed. " +
        "From the repo root try: NPM_CONFIG_IGNORE_SCRIPTS=false npm ci",
    );
    process.exit(result.status ?? 1);
  }
}

warnNestedCopies();

const need = packagesNeedingRebuild();
if (need.length === 0) {
  process.exit(0);
}

runRebuild(need);

const stillBroken = need.filter((name) => isInstalled(name) && !canLoad(name));
const requiredBroken = stillBroken.filter((name) => REQUIRED.has(name));
if (requiredBroken.length > 0) {
  console.error(
    `[ensure-native-addons] Still cannot load ${requiredBroken.join(", ")}. ` +
      "From the repo root: NPM_CONFIG_IGNORE_SCRIPTS=false npm ci",
  );
  process.exit(1);
}

for (const name of stillBroken) {
  console.warn(
    `[ensure-native-addons] Optional native ${name} still failed to load; ` +
      "Bridge may start with that feature unavailable.",
  );
}
