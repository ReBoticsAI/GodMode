import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type PluginScaffoldTemplate = "domain" | "records";

/** Resolved root of checked-in scaffold trees. */
export function scaffoldsRoot(): string {
  const override = process.env.GODMODE_SCAFFOLDS_DIR?.trim();
  if (override) return path.resolve(override);
  const fromRepo = path.join(config.repoRoot, "apps", "bridge", "data", "scaffolds");
  if (fs.existsSync(fromRepo)) return fromRepo;
  // Fallback when tests run from package without full repoRoot layout.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data/scaffolds");
}

export function pluginTemplateDir(template: PluginScaffoldTemplate): string {
  const name = template === "records" ? "plugin-records" : "plugin-domain";
  const dir = path.join(scaffoldsRoot(), name);
  if (!fs.existsSync(dir)) {
    throw new Error(`Scaffold template missing: ${dir}`);
  }
  return dir;
}

export function loadScaffoldBlueprint(
  kind: "pack" | "agent" | "automation"
): Record<string, unknown> {
  const file =
    kind === "pack"
      ? path.join(scaffoldsRoot(), "pack", "catalog-entry.json")
      : kind === "agent"
        ? path.join(scaffoldsRoot(), "agent", "defaults.json")
        : path.join(scaffoldsRoot(), "automation", "hook-defaults.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Scaffold blueprint missing: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function toPascal(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

export function scaffoldTokens(opts: {
  id: string;
  name: string;
  deptId: string;
}): Record<string, string> {
  const recordType = `${toPascal(opts.id)}Item`;
  const recordTable = `${opts.id.replace(/-/g, "_")}_items`;
  return {
    PLUGIN_ID: opts.id,
    PLUGIN_NAME: opts.name,
    DEPT_ID: opts.deptId,
    DEPT_LABEL: opts.name,
    RECORD_TYPE: recordType,
    RECORD_TABLE: recordTable,
  };
}

export function applyScaffoldTokens(
  source: string,
  tokens: Record<string, string>
): string {
  // Replace longest keys first so __PLUGIN_ID__ wins over a greedy __PLUGIN_ID___…__ match.
  let out = source;
  const keys = Object.keys(tokens).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const token = `__${key}__`;
    if (!out.includes(token)) continue;
    out = out.split(token).join(tokens[key]!);
  }
  return out;
}

/** Copy a scaffold tree into dest, applying token substitution to every file. */
export function copyScaffoldTree(
  templateDir: string,
  destDir: string,
  tokens: Record<string, string>
): void {
  const walk = (src: string, dest: string) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      if (ent.name === "." || ent.name === "..") continue;
      const from = path.join(src, ent.name);
      const to = path.join(dest, ent.name);
      if (ent.isDirectory()) {
        walk(from, to);
        continue;
      }
      const raw = fs.readFileSync(from, "utf8");
      fs.writeFileSync(to, applyScaffoldTokens(raw, tokens), "utf8");
    }
  };
  walk(templateDir, destDir);
}
