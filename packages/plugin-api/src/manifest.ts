import fs from "node:fs";
import path from "node:path";

export interface GodmodePluginManifest {
  id: string;
  version: string;
  name: string;
  engine?: string;
  description?: string;
  departments?: string[];
  native?: {
    platform?: string;
    studiesDir?: string;
    requiresConnector?: boolean;
  };
  bridge?: {
    entry: string;
  };
  web?: {
    entry: string;
  };
  tenantMigrations?: string[];
}

const MANIFEST_FILE = "godmode.plugin.json";

export function manifestPath(pluginRoot: string): string {
  return path.join(pluginRoot, MANIFEST_FILE);
}

export function parseGodmodePluginManifest(raw: unknown): GodmodePluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid plugin manifest: expected object");
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || !m.id.trim()) {
    throw new Error("Invalid plugin manifest: id required");
  }
  if (typeof m.version !== "string" || !m.version.trim()) {
    throw new Error(`Invalid plugin manifest (${m.id}): version required`);
  }
  if (typeof m.name !== "string" || !m.name.trim()) {
    throw new Error(`Invalid plugin manifest (${m.id}): name required`);
  }
  const bridge = m.bridge as Record<string, unknown> | undefined;
  const web = m.web as Record<string, unknown> | undefined;
  if (bridge && typeof bridge.entry !== "string") {
    throw new Error(`Invalid plugin manifest (${m.id}): bridge.entry must be string`);
  }
  if (web && typeof web.entry !== "string") {
    throw new Error(`Invalid plugin manifest (${m.id}): web.entry must be string`);
  }
  const native = m.native as Record<string, unknown> | undefined;
  return {
    id: m.id.trim(),
    version: m.version.trim(),
    name: m.name.trim(),
    engine: typeof m.engine === "string" ? m.engine : undefined,
    description: typeof m.description === "string" ? m.description : undefined,
    departments: Array.isArray(m.departments)
      ? m.departments.filter((d): d is string => typeof d === "string")
      : undefined,
    native: native
      ? {
          platform: typeof native.platform === "string" ? native.platform : undefined,
          studiesDir:
            typeof native.studiesDir === "string" ? native.studiesDir : undefined,
          requiresConnector: native.requiresConnector === true,
        }
      : undefined,
    bridge: bridge ? { entry: String(bridge.entry) } : undefined,
    web: web ? { entry: String(web.entry) } : undefined,
    tenantMigrations: Array.isArray(m.tenantMigrations)
      ? m.tenantMigrations.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

export function readGodmodePluginManifest(pluginRoot: string): GodmodePluginManifest {
  const file = manifestPath(pluginRoot);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${MANIFEST_FILE} in ${pluginRoot}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  return parseGodmodePluginManifest(raw);
}

export function pluginPathFromEnv(): string[] {
  const raw = process.env.GODMODE_PLUGIN_PATH ?? "";
  return raw
    .split(process.platform === "win32" ? ";" : ":")
    .map((s) => s.trim())
    .filter(Boolean);
}
