import fs from "node:fs";
import path from "node:path";
import {
  validateObjectTypeDef,
  type ObjectTypeDef,
  type RecordData,
} from "@godmode/kernel";
import {
  KERNEL_CLIENT_API_VERSION,
  type KernelClientApiVersion,
} from "./kernel-client.js";

export interface PluginRecordSeed {
  objectType: string;
  data: RecordData;
}

/** Declared runtime capabilities (#290 network, #303 tools/records). Restricted catalogs grant only these. */
export interface PluginManifestCapabilities {
  network?: {
    /** Hostnames the plugin may reach via `host.externalFetch` (http/https). */
    hosts?: string[];
  };
  tools?: {
    /** AI tool names the plugin may register via `api.tools.register`. */
    names?: string[];
  };
  records?: {
    /** ObjectType names the plugin may register or call via `api.kernel` / `api.objectTypes`. */
    names?: string[];
  };
}

export interface GodmodePluginManifest {
  id: string;
  version: string;
  name: string;
  engine?: string;
  /** Kernel client contract required by executable Bridge/web plugin code. */
  kernelApiVersion?: KernelClientApiVersion;
  description?: string;
  departments?: string[];
  /** Optional capability requests for Marketplace buyer grants (#290 / #303). */
  capabilities?: PluginManifestCapabilities;
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
  /**
   * Persistence plane for this plugin.
   * - `domain` (default): business data via openPluginDb; native tenant ObjectType tables rejected.
   * - `core-records`: narrow opt-in for Core personal-OS ObjectTypes on workspace SQLite.
   *   Requires `scaffoldTemplate: "records"` (set by the records scaffold) so agents cannot
   *   bypass the gate by only flipping dataPlane.
   */
  dataPlane?: "domain" | "core-records";
  /**
   * Which architecture scaffold produced this plugin (stamped by scaffold_plugin).
   * Native workspace ObjectTypes require `scaffoldTemplate: "records"` plus core-records.
   */
  scaffoldTemplate?: "domain" | "records";
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
  if (
    m.kernelApiVersion !== undefined &&
    m.kernelApiVersion !== KERNEL_CLIENT_API_VERSION
  ) {
    throw new Error(
      `Invalid plugin manifest (${m.id}): unsupported kernelApiVersion ${String(m.kernelApiVersion)}; host supports ${KERNEL_CLIENT_API_VERSION}`
    );
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
  const capabilities = parseManifestCapabilities(m.capabilities, id);
  return {
    id,
    version: m.version.trim(),
    name: m.name.trim(),
    engine: typeof m.engine === "string" ? m.engine : undefined,
    kernelApiVersion:
      m.kernelApiVersion === KERNEL_CLIENT_API_VERSION
        ? KERNEL_CLIENT_API_VERSION
        : undefined,
    description: typeof m.description === "string" ? m.description : undefined,
    departments: Array.isArray(m.departments)
      ? m.departments.filter((d): d is string => typeof d === "string")
      : undefined,
    capabilities,
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
    dataPlane: parseDataPlane(m.dataPlane, id),
    scaffoldTemplate: parseScaffoldTemplate(m.scaffoldTemplate, id),
    objectTypes: parseObjectTypes(m.objectTypes, id),
    records: parseRecordSeeds(m.records),
  };
}

function parseDataPlane(
  raw: unknown,
  pluginId: string
): "domain" | "core-records" {
  if (raw === undefined || raw === null || raw === "") return "domain";
  if (raw === "domain" || raw === "core-records") return raw;
  throw new Error(
    `Invalid plugin manifest (${pluginId}): dataPlane must be "domain" or "core-records"`
  );
}

function parseScaffoldTemplate(
  raw: unknown,
  pluginId: string
): "domain" | "records" | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (raw === "domain" || raw === "records") return raw;
  throw new Error(
    `Invalid plugin manifest (${pluginId}): scaffoldTemplate must be "domain" or "records"`
  );
}

function parseNamedCapabilityList(
  raw: unknown,
  pluginId: string,
  pathLabel: string
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    const names = raw.filter(
      (n): n is string => typeof n === "string" && n.trim().length > 0
    );
    return names.length ? names : undefined;
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `Invalid plugin manifest (${pluginId}): ${pathLabel} must be an object or string array`
    );
  }
  const obj = raw as Record<string, unknown>;
  if (obj.names !== undefined && !Array.isArray(obj.names)) {
    throw new Error(
      `Invalid plugin manifest (${pluginId}): ${pathLabel}.names must be an array`
    );
  }
  if (!Array.isArray(obj.names)) return undefined;
  const names = obj.names.filter(
    (n): n is string => typeof n === "string" && n.trim().length > 0
  );
  return names.length ? names : undefined;
}

function parseManifestCapabilities(
  raw: unknown,
  pluginId: string
): PluginManifestCapabilities | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `Invalid plugin manifest (${pluginId}): capabilities must be an object`
    );
  }
  const cap = raw as Record<string, unknown>;
  const out: PluginManifestCapabilities = {};

  if (cap.network !== undefined) {
    if (!cap.network || typeof cap.network !== "object") {
      throw new Error(
        `Invalid plugin manifest (${pluginId}): capabilities.network must be an object`
      );
    }
    const net = cap.network as Record<string, unknown>;
    if (net.hosts !== undefined && !Array.isArray(net.hosts)) {
      throw new Error(
        `Invalid plugin manifest (${pluginId}): capabilities.network.hosts must be an array`
      );
    }
    const hosts = Array.isArray(net.hosts)
      ? net.hosts.filter(
          (h): h is string => typeof h === "string" && h.trim().length > 0
        )
      : undefined;
    out.network = hosts ? { hosts } : {};
  }

  const tools = parseNamedCapabilityList(
    cap.tools,
    pluginId,
    "capabilities.tools"
  );
  if (tools) out.tools = { names: tools };

  const records = parseNamedCapabilityList(
    cap.records,
    pluginId,
    "capabilities.records"
  );
  if (records) out.records = { names: records };

  return out;
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
