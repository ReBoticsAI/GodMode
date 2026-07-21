#!/usr/bin/env node
/**
 * OSS core release audit — fails CI if trading/private-plugin coupling or operator PII leaks.
 *
 * Known temporary residue must be listed in scripts/oss-debt.json.
 * Matches outside the debt allowlist are errors; debt matches are counted as warnings.
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

function normPath(rel) {
  return path.normalize(rel).replaceAll("\\", "/");
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
      if (
        ent.name === "node_modules" ||
        ent.name === ".git" ||
        ent.name === "dist" ||
        ent.name === "coverage"
      ) {
        continue;
      }
      // Runtime copy of skills-bootstrap; gitignored and not part of OSS tree.
      if (normPath(p) === "apps/bridge/data/ai/skills") continue;
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
const ALLOWLIST_GMAIL = new Set([normPath("apps/bridge/.env.example")]);

/** Self-scan + debt machinery — must mention banned terms to enforce them. */
const SELF_SCAN_ALLOWLIST = new Set(
  [
    "scripts/audit-oss-core.mjs",
    "scripts/oss-debt.json",
    "scripts/oss-debt.schema.json",
    "scripts/__tests__/oss-debt.test.mjs",
  ].map(normPath)
);

// --- Blockers: paths that must not exist ---
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

/** Sierra Chart operator helpers belong in godmode-plugin-sierra, not OSS core. */
const BANNED_SIERRA_SCRIPTS = [
  "scripts/sc-screenshot.ps1",
  "scripts/find-zone-signals.ps1",
  "scripts/find-zones-deep.ps1",
  "scripts/check-input.ps1",
  "scripts/seed-playbook.cjs",
];
for (const rel of BANNED_SIERRA_SCRIPTS) {
  if (exists(rel)) {
    errors.push(
      `${rel}: Sierra Chart operator script must live in godmode-plugin-sierra`
    );
  }
}

// --- Debt allowlist ---
const debtPath = path.join(root, "scripts/oss-debt.json");
let debtEntries = [];
if (!fs.existsSync(debtPath)) {
  errors.push("scripts/oss-debt.json missing — required for debt-aware OSS audit");
} else {
  try {
    const debt = JSON.parse(fs.readFileSync(debtPath, "utf8"));
    if (!Array.isArray(debt.entries)) {
      errors.push("scripts/oss-debt.json: entries must be an array");
    } else {
      debtEntries = debt.entries;
      for (const entry of debtEntries) {
        if (!entry?.path || !entry?.owner || !entry?.phase || !entry?.reason) {
          errors.push(
            `scripts/oss-debt.json: invalid entry ${JSON.stringify(entry)}`
          );
        }
      }
    }
  } catch (err) {
    errors.push(`scripts/oss-debt.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const debtPaths = new Set(debtEntries.map((e) => normPath(e.path)));

/** Content / symbol residue that must not appear outside debt (and self-scan). */
const RESIDUE_PATTERNS = [
  { re: /SierraPb1/g, label: "SierraPb1" },
  { re: /pingScHealth/g, label: "pingScHealth" },
  { re: /enqueueScLine/g, label: "enqueueScLine" },
  { re: /registerScHealthPing/g, label: "registerScHealthPing" },
  { re: /registerEnqueueScLine/g, label: "registerEnqueueScLine" },
  { re: /registerSierraPb1Scheduler/g, label: "registerSierraPb1Scheduler" },
  { re: /getSierraPb1Scheduler/g, label: "getSierraPb1Scheduler" },
  { re: /CREATE TABLE(?: IF NOT EXISTS)? sc_/gi, label: "CREATE TABLE sc_" },
  { re: /CREATE TABLE(?: IF NOT EXISTS)? playbooks\b/gi, label: "CREATE TABLE playbooks" },
  { re: /CREATE TABLE(?: IF NOT EXISTS)? backtest_/gi, label: "CREATE TABLE backtest_" },
  { re: /\/playbook-zones/g, label: "/playbook-zones" },
  { re: /pm-dashboard-group/g, label: "pm-dashboard-group" },
  { re: /sierra-playbooks-group/g, label: "sierra-playbooks-group" },
  { re: /sierra-dashboard-group/g, label: "sierra-dashboard-group" },
  { re: /from_sc\.txt/g, label: "from_sc.txt" },
  { re: /to_sc\.txt/g, label: "to_sc.txt" },
  { re: /\bDTC_HOST\b/g, label: "DTC_HOST" },
  { re: /\bpm_book\b/g, label: "pm_book" },
  { re: /\bpm_price\b/g, label: "pm_price" },
  { re: /LegacyBuilderRedirect/g, label: "LegacyBuilderRedirect" },
  { re: /\/trading\/sierra/g, label: "/trading/sierra" },
  { re: /Sierra\s*Chart|SierraChart/gi, label: "Sierra Chart" },
  { re: /Polymarket/gi, label: "Polymarket" },
  { re: /godmode-plugin-sierra/gi, label: "godmode-plugin-sierra" },
  { re: /godmode-plugin-polymarket/gi, label: "godmode-plugin-polymarket" },
  { re: /OPERATOR_SETUP/g, label: "OPERATOR_SETUP" },
  { re: /GodMode_Platform_Plan/g, label: "GodMode_Platform_Plan" },
  { re: /\bPB1\b/g, label: "PB1" },
  { re: /playbook builder/gi, label: "playbook builder" },
];

const RESIDUE_SCAN_DIRS = ["apps", "packages", "scripts", "deploy", "docs"];
const RESIDUE_EXTS = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".md",
  ".mdc",
  ".yml",
  ".yaml",
  ".json",
  ".example",
  ".sql",
  ".ps1",
  ".sh",
  ".cmd",
];

let debtHitCount = 0;
let newResidueCount = 0;

function isDebtPath(rel) {
  return debtPaths.has(normPath(rel));
}

function scanResidue(rel) {
  const n = normPath(rel);
  if (SELF_SCAN_ALLOWLIST.has(n)) return;
  // Do not fail the debt file for listing reasons; paths are validated separately.
  if (n === "scripts/oss-debt.json") return;

  let text;
  try {
    text = read(rel);
  } catch {
    return;
  }

  const labels = new Set();
  for (const { re, label } of RESIDUE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) labels.add(label);
  }
  if (labels.size === 0) return;

  const joined = [...labels].sort().join(", ");
  if (isDebtPath(rel)) {
    debtHitCount += 1;
    warnings.push(`${rel}: debt residue (${joined})`);
  } else {
    newResidueCount += 1;
    errors.push(`${rel}: new OSS residue not in oss-debt.json (${joined})`);
  }
}

for (const dir of RESIDUE_SCAN_DIRS) {
  for (const rel of scanTextFiles(dir, RESIDUE_EXTS)) {
    scanResidue(rel);
  }
}
for (const top of ["README.md", "CONTRIBUTING.md", "PLUGIN_BOUNDARY.md", "CHANGELOG.md", "docker-compose.yml"]) {
  if (exists(top)) scanResidue(top);
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
      if (ent.isDirectory()) {
        if (ent.name === "node_modules") continue;
        scan(fp);
      } else if (/\.(ts|tsx)$/.test(ent.name)) {
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
  const n = normPath(rel);
  const text = read(rel);
  if (PII_NAMES.test(text)) {
    errors.push(`${rel}: operator personal name reference`);
  }
  if (DANE_PATH.test(text)) {
    errors.push(`${rel}: Windows user path reference`);
  }
  if (GMAIL.test(text) && !ALLOWLIST_GMAIL.has(n)) {
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

// Warnings: possible secrets
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
console.log(`  debt entries: ${debtEntries.length}`);
console.log(`  debt hits: ${debtHitCount}`);
console.log(`  new residue errors: ${newResidueCount}`);

if (warnings.length) {
  console.log("\nWarnings:");
  warnings.slice(0, 40).forEach((w) => console.log("  ⚠", w));
  if (warnings.length > 40) console.log(`  … and ${warnings.length - 40} more`);
}

if (errors.length) {
  console.error("\nErrors:");
  errors.forEach((e) => console.error("  ✗", e));
  process.exit(1);
}

console.log("\n✓ OSS core audit passed");
process.exit(0);
