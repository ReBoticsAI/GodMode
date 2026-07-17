#!/usr/bin/env node
/**
 * OSS core release audit — fails CI if trading/private-plugin coupling or operator PII leaks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function walkJsonFiles(dir, out = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return out;
  for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory() && ent.name !== "node_modules") walkJsonFiles(p, out);
    else if (ent.name === "package.json") out.push(p);
  }
  return out;
}

function scanTextFiles(dir, exts, out = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return out;
  for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      scanTextFiles(p, exts, out);
    } else if (exts.some((e) => ent.name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

const PII_NAMES = /\b(Dane|Rachel|daneschell|rachelliang)\b/i;
const DANE_PATH = /Users[\\/]dane/i;
const GMAIL = /@[a-z0-9.-]*gmail\.com/i;
const ALLOWLIST_GMAIL = new Set([
  path.normalize("apps/bridge/.env.example"),
]);

// Blockers
if (exists("sierrachart")) {
  errors.push("sierrachart/ must not exist in public core");
}
if (exists("apps/bridge/src/polymarket")) {
  errors.push("apps/bridge/src/polymarket/ must not exist in public core");
}
if (exists("apps/bridge/data/ai/rules")) {
  errors.push("apps/bridge/data/ai/rules/ must not exist — use rules-bootstrap/ or operator pack");
}
if (exists("docs/archive-research")) {
  errors.push("docs/archive-research/ must not exist in public core");
}
if (exists("docs/GodMode_Platform_Plan.md")) {
  errors.push("docs/GodMode_Platform_Plan.md must not ship in OSS core");
}
if (exists("docs/OPERATOR_SETUP.md")) {
  errors.push("docs/OPERATOR_SETUP.md must not ship in OSS core");
}
if (exists("docs/TRADING_RESIDUE_AUDIT.md")) {
  errors.push("docs/TRADING_RESIDUE_AUDIT.md must not ship in OSS core");
}
if (exists("docs/SALES_PITCH.md")) {
  errors.push("docs/SALES_PITCH.md must not ship in OSS core");
}
if (exists("docs/KERNEL_MIGRATION_MATRIX.md")) {
  errors.push("docs/KERNEL_MIGRATION_MATRIX.md must not ship in OSS core");
}

const BANNED_DOC_TERMS = [
  { re: /Sierra\s*Chart|SierraChart/i, label: "Sierra Chart" },
  { re: /Polymarket/i, label: "Polymarket" },
  { re: /godmode-plugin-sierra/i, label: "godmode-plugin-sierra" },
  { re: /godmode-plugin-polymarket/i, label: "godmode-plugin-polymarket" },
  { re: /OPERATOR_SETUP/i, label: "OPERATOR_SETUP" },
  { re: /GodMode_Platform_Plan/i, label: "GodMode_Platform_Plan" },
  { re: /\bPB1\b/, label: "PB1" },
  { re: /playbook builder/i, label: "playbook builder" },
];

const DOC_SCAN_ALLOWLIST = new Set([
  path.normalize("scripts/audit-oss-core.mjs"),
  path.normalize("apps/web/src/lib/structure-agents.ts"),
  path.normalize("apps/web/src/lib/structure-adapters.ts"),
  path.normalize("apps/bridge/src/services/structure-regroup-migration.ts"),
  path.normalize("apps/bridge/src/services/platform-scope.ts"),
  path.normalize("packages/plugin-api/src/host-services.ts"),
]);

function scanDocForBannedTerms(rel) {
  const norm = path.normalize(rel);
  if (DOC_SCAN_ALLOWLIST.has(norm)) return;
  const text = read(rel);
  for (const { re, label } of BANNED_DOC_TERMS) {
    if (re.test(text)) {
      errors.push(`${rel}: banned OSS term "${label}"`);
    }
  }
}

for (const rel of [
  "README.md",
  "CONTRIBUTING.md",
  "PLUGIN_BOUNDARY.md",
  ...scanTextFiles("docs", [".md"]),
  ...scanTextFiles("packages", ["README.md"]),
  ...scanTextFiles("apps", ["README.md"]),
]) {
  if (exists(rel)) scanDocForBannedTerms(rel);
}

const SOURCE_SCAN_DIRS = [
  "apps/bridge/src",
  "apps/web/src",
  "packages/flow-core/src",
  "packages/plugin-api/src",
  "packages/web-host/src",
];

function scanSourceForBannedTerms(rel) {
  const norm = path.normalize(rel);
  if (DOC_SCAN_ALLOWLIST.has(norm)) return;
  if (norm.includes(`${path.sep}__tests__${path.sep}`)) return;
  const text = read(rel);
  for (const { re, label } of BANNED_DOC_TERMS) {
    if (re.test(text)) {
      errors.push(`${rel}: banned OSS term "${label}" in source`);
    }
  }
}

for (const dir of SOURCE_SCAN_DIRS) {
  for (const rel of scanTextFiles(dir, [".ts", ".tsx"])) {
    scanSourceForBannedTerms(rel);
  }
}

for (const pkg of walkJsonFiles(".")) {
  const text = read(pkg);
  if (/file:\.\.\/\.\.\/\.\.\/godmode-plugin/i.test(text)) {
    errors.push(`${pkg}: file: dependency on private sibling plugin repo`);
  }
}

try {
  const lock = read("package-lock.json");
  if (/"\.\.\/godmode-plugin-/i.test(lock)) {
    errors.push("package-lock.json: extraneous sibling plugin path entries");
  }
} catch {
  /* skip */
}

const webSrc = path.join(root, "apps/web/src");
if (fs.existsSync(webSrc)) {
  const scan = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) scan(fp);
      else if (/\.(ts|tsx)$/.test(ent.name)) {
        const text = fs.readFileSync(fp, "utf8");
        if (/from\s+["']@godmode-plugin-/i.test(text)) {
          errors.push(`${path.relative(root, fp)}: static import of private plugin package`);
        }
      }
    }
  };
  scan(webSrc);
}

try {
  const envExample = read("apps/bridge/.env.example");
  if (/GOOGLE_OAUTH_CLIENT_ID|GITHUB_OAUTH_CLIENT_ID/.test(envExample)) {
    errors.push("apps/bridge/.env.example: OAuth env vars must not ship in OSS core");
  }
} catch {
  /* skip */
}

try {
  const configText = read("apps/bridge/src/config.ts");
  if (/Dane:dane@example\.com/i.test(configText) || /Rachel:rachel@example\.com/i.test(configText)) {
    errors.push("apps/bridge/src/config.ts: hardcoded operator INITIAL_ADMINS defaults");
  }
} catch {
  /* skip */
}

try {
  const bootstrap = read("apps/bridge/src/services/tenant-bootstrap.ts");
  if (/DEFAULT_ADMIN_PASSWORD|"123456"/.test(bootstrap)) {
    errors.push("tenant-bootstrap.ts: hardcoded default admin password");
  }
} catch {
  /* skip */
}

for (const rel of scanTextFiles("apps", [".ts", ".tsx", ".md", ".mdc", ".example"])) {
  const norm = path.normalize(rel);
  const text = read(rel);
  if (PII_NAMES.test(text)) {
    errors.push(`${rel}: operator personal name reference`);
  }
  if (DANE_PATH.test(text)) {
    errors.push(`${rel}: Windows user path reference`);
  }
  if (GMAIL.test(text) && !ALLOWLIST_GMAIL.has(norm)) {
    errors.push(`${rel}: real gmail address pattern`);
  }
}

for (const rel of scanTextFiles("packages", [".ts", ".tsx", ".md"])) {
  const text = read(rel);
  if (PII_NAMES.test(text)) errors.push(`${rel}: operator personal name reference`);
  if (DANE_PATH.test(text)) errors.push(`${rel}: Windows user path reference`);
}

for (const rel of scanTextFiles("docs", [".md"])) {
  const text = read(rel);
  if (PII_NAMES.test(text)) errors.push(`${rel}: operator personal name reference`);
  if (DANE_PATH.test(text)) errors.push(`${rel}: Windows user path reference`);
}

// Warnings
const secretPatterns = [
  /0x[a-fA-F0-9]{40}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /gho_[a-zA-Z0-9]{20,}/,
];
function scanWarnings(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      scanWarnings(fp);
    } else if (/\.(ts|tsx|js|json|md|env\.example)$/.test(ent.name)) {
      const text = fs.readFileSync(fp, "utf8");
      for (const re of secretPatterns) {
        if (re.test(text)) {
          warnings.push(`${path.relative(root, fp)}: possible secret pattern ${re}`);
        }
      }
    }
  }
}
scanWarnings(path.join(root, "apps"));
scanWarnings(path.join(root, "packages"));

console.log("OSS core audit");
if (warnings.length) {
  console.log("\nWarnings:");
  warnings.slice(0, 20).forEach((w) => console.log("  ⚠", w));
  if (warnings.length > 20) console.log(`  … and ${warnings.length - 20} more`);
}

if (errors.length) {
  console.error("\nErrors:");
  errors.forEach((e) => console.error("  ✗", e));
  process.exit(1);
}

console.log("\n✓ OSS core audit passed");
process.exit(0);
