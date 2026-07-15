import fs from "node:fs";
import path from "node:path";
import {
  validateObjectTypeDef,
  type ObjectTypeDef,
  type RecordData,
} from "@godmode/kernel";

export interface PluginRecordSeed {
  objectType: string;
  data: RecordData;
}

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
  /** ObjectType definitions shipped by the plugin (registered before tenant:install). */
  objectTypes?: ObjectTypeDef[];
  /** Optional Record seeds applied after ObjectTypes register (upsert by id). */
  records?: PluginRecordSeed[];
}

const MANIFEST_FILE = "godmode.plugin.json";

export function manifestPath(pluginRoot: string): string {
  return path.join(pluginRoot, MANIFEST_FILE);
}

function parseObjectTypes(raw: unknown, pluginId: string): ObjectTypeDef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ObjectTypeDef[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid plugin manifest (${pluginId}): objectTypes[${index}] must be an object`);
    }
    const ot = item as ObjectTypeDef;
    const operations =
      ot.operations ??
      (ot.storage?.kind === "native"
        ? (["list", "get", "create", "update", "delete"] as const)
        : (["list", "get"] as const));
    const writable = operations.some((operation) =>
      ["create", "update", "delete"].includes(operation)
    );
    const permissions =
      ot.permissions ??
      [
        { role: "viewer" as const, read: true },
        {
          role: "editor" as const,
          read: true,
          create: writable,
          update: writable,
          delete: writable,
        },
        {
          role: "owner" as const,
          read: true,
          create: writable,
          update: writable,
          delete: writable,
        },
        {
          role: "intelligence" as const,
          read: true,
          create: writable,
          update: writable,
          delete: writable,
        },
      ];
    const owned: ObjectTypeDef = {
      ...ot,
      contractVersion: ot.contractVersion ?? 1,
      operations: [...operations],
      permissions,
      pluginId,
    };
    const errors = validateObjectTypeDef(owned);
    if (errors.length) {
      throw new Error(
        `Invalid plugin manifest (${pluginId}): ObjectType ${String(ot.name)}: ${errors.join("; ")}`
      );
    }
    out.push(owned);
  }
  return out.length ? out : undefined;
}

function parseRecordSeeds(raw: unknown): PluginRecordSeed[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PluginRecordSeed[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid record seed at index ${index}`);
    }
    const r = item as Record<string, unknown>;
    if (typeof r.objectType !== "string" || !r.data || typeof r.data !== "object") {
      throw new Error(`Invalid record seed at index ${index}: objectType and data required`);
    }
    if (r.data && (r.data as Record<string, unknown>).id == null) {
      throw new Error(`Invalid record seed at index ${index}: deterministic data.id required`);
    }
    out.push({
      objectType: r.objectType,
      data: r.data as RecordData,
    });
  }
  return out.length ? out : undefined;
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
  const id = m.id.trim();
  return {
    id,
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
    objectTypes: parseObjectTypes(m.objectTypes, id),
    records: parseRecordSeeds(m.records),
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
