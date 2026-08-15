/**
 * Plugin runtime capability grants (#290 network, #303 tools/records).
 * Deny-by-default for Official/Community installs; Local/operator unrestricted.
 * Distinct from coding jail (#112). Raw in-process fetch remains a residual risk until
 * the Community child-process sandbox lands (docs/PLUGIN_ISOLATION.md, #559).
 */
import fs from "node:fs";
import path from "node:path";
import type { CatalogEntry } from "./marketplace-catalog.js";
import { resolvePluginPinPolicy } from "./marketplace-plugin-pin.js";

export const PLUGIN_CAPABILITIES_FILE = "godmode.capabilities.json";

export type PluginTrustTier = "official" | "community" | "local" | "operator";

export type NetworkCapabilityMode = "deny" | "allowlist" | "unrestricted";

export type NamedCapabilityMode = "deny" | "allowlist" | "unrestricted";

export interface PluginNetworkCapability {
  mode: NetworkCapabilityMode;
  /** Lowercase hostnames. Exact match or `*.example.com` suffix wildcards. */
  hosts: string[];
}

/** Named allowlist for tools or ObjectType / record access (#303). */
export interface PluginNamedCapability {
  mode: NamedCapabilityMode;
  /** Exact tool names or ObjectType names. */
  names: string[];
}

export interface PluginCapabilityGrants {
  version: 1;
  trustTier: PluginTrustTier;
  network: PluginNetworkCapability;
  tools: PluginNamedCapability;
  records: PluginNamedCapability;
  grantedAt: string;
  sourceEntryId?: string;
}

export function capabilitiesPath(pluginRoot: string): string {
  return path.join(pluginRoot, PLUGIN_CAPABILITIES_FILE);
}

export function normalizeCapabilityHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function normalizeCapabilityHosts(hosts: unknown): string[] {
  if (!Array.isArray(hosts)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hosts) {
    if (typeof raw !== "string") continue;
    const host = normalizeCapabilityHost(raw);
    if (!host || seen.has(host)) continue;
    if (host.startsWith("*.") && host.length < 4) continue;
    if (!host.startsWith("*.") && !/^[a-z0-9.-]+$/.test(host)) continue;
    if (host.startsWith("*.") && !/^\*\.[a-z0-9.-]+$/.test(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

/** Tool / ObjectType identifiers: trim; keep case; allow letters, digits, `_`, `-`. */
export function normalizeCapabilityName(name: string): string {
  return name.trim();
}

export function normalizeCapabilityNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = normalizeCapabilityName(raw);
    if (!name || seen.has(name)) continue;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function resolvePluginTrustTier(opts: {
  entry?: CatalogEntry;
  sourceCatalog?: string;
  pluginLocalPath?: boolean;
}): PluginTrustTier {
  if (opts.pluginLocalPath || opts.entry?.pluginLocalPath?.trim()) {
    return "local";
  }
  const sourceName = String(opts.entry?.sourceName ?? "").toLowerCase();
  if (sourceName.includes("community")) return "community";
  if (sourceName.includes("official")) return "official";
  const src = String(
    opts.sourceCatalog ?? opts.entry?.sourceCatalog ?? ""
  ).toLowerCase();
  if (
    src.includes("/catalog/official") ||
    src.includes("commerce/catalog/official") ||
    src.includes("godmode-marketplace")
  ) {
    return "official";
  }
  if (opts.entry) {
    const pin = resolvePluginPinPolicy({
      entry: opts.entry,
      sourceCatalog: opts.sourceCatalog,
    });
    if (pin === "required") return "official";
  }
  return "local";
}

export function buildNetworkCapability(
  trustTier: PluginTrustTier,
  declaredHosts: string[] = []
): PluginNetworkCapability {
  if (trustTier === "local" || trustTier === "operator") {
    return { mode: "unrestricted", hosts: [] };
  }
  const hosts = normalizeCapabilityHosts(declaredHosts);
  if (hosts.length === 0) {
    return { mode: "deny", hosts: [] };
  }
  return { mode: "allowlist", hosts };
}

export function buildNamedCapability(
  trustTier: PluginTrustTier,
  declaredNames: string[] = []
): PluginNamedCapability {
  if (trustTier === "local" || trustTier === "operator") {
    return { mode: "unrestricted", names: [] };
  }
  const names = normalizeCapabilityNames(declaredNames);
  if (names.length === 0) {
    return { mode: "deny", names: [] };
  }
  return { mode: "allowlist", names };
}

export function buildCapabilityGrants(opts: {
  trustTier: PluginTrustTier;
  declaredHosts?: string[];
  declaredTools?: string[];
  declaredRecords?: string[];
  sourceEntryId?: string;
  grantedAt?: string;
}): PluginCapabilityGrants {
  return {
    version: 1,
    trustTier: opts.trustTier,
    network: buildNetworkCapability(opts.trustTier, opts.declaredHosts ?? []),
    tools: buildNamedCapability(opts.trustTier, opts.declaredTools ?? []),
    records: buildNamedCapability(opts.trustTier, opts.declaredRecords ?? []),
    grantedAt: opts.grantedAt ?? new Date().toISOString(),
    sourceEntryId: opts.sourceEntryId,
  };
}

/** Hosts declared by catalog and/or plugin manifest for restricted installs. */
export function collectDeclaredNetworkHosts(opts: {
  catalogHosts?: string[] | null;
  manifestHosts?: string[] | null;
}): string[] {
  return normalizeCapabilityHosts([
    ...(opts.catalogHosts ?? []),
    ...(opts.manifestHosts ?? []),
  ]);
}

/** Tool or record names declared by catalog and/or plugin manifest (#303). */
export function collectDeclaredCapabilityNames(opts: {
  catalogNames?: string[] | null;
  manifestNames?: string[] | null;
}): string[] {
  return normalizeCapabilityNames([
    ...(opts.catalogNames ?? []),
    ...(opts.manifestNames ?? []),
  ]);
}

export function writeCapabilityGrants(
  pluginRoot: string,
  grants: PluginCapabilityGrants
): void {
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(
    capabilitiesPath(pluginRoot),
    `${JSON.stringify(grants, null, 2)}\n`,
    "utf8"
  );
}

function parseNamedCapability(
  raw: unknown,
  trustTier: PluginTrustTier
): PluginNamedCapability {
  if (!raw || typeof raw !== "object") {
    return buildNamedCapability(trustTier, []);
  }
  const obj = raw as Record<string, unknown>;
  const mode = obj.mode;
  if (mode !== "deny" && mode !== "allowlist" && mode !== "unrestricted") {
    return buildNamedCapability(trustTier, []);
  }
  return {
    mode,
    names: normalizeCapabilityNames(obj.names),
  };
}

export function parseCapabilityGrants(raw: unknown): PluginCapabilityGrants | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;
  const trustTier = obj.trustTier;
  if (
    trustTier !== "official" &&
    trustTier !== "community" &&
    trustTier !== "local" &&
    trustTier !== "operator"
  ) {
    return null;
  }
  const network = obj.network;
  if (!network || typeof network !== "object") return null;
  const net = network as Record<string, unknown>;
  const mode = net.mode;
  if (mode !== "deny" && mode !== "allowlist" && mode !== "unrestricted") {
    return null;
  }
  return {
    version: 1,
    trustTier,
    network: {
      mode,
      hosts: normalizeCapabilityHosts(net.hosts),
    },
    tools: parseNamedCapability(obj.tools, trustTier),
    records: parseNamedCapability(obj.records, trustTier),
    grantedAt:
      typeof obj.grantedAt === "string" && obj.grantedAt.trim()
        ? obj.grantedAt
        : new Date(0).toISOString(),
    sourceEntryId:
      typeof obj.sourceEntryId === "string" ? obj.sourceEntryId : undefined,
  };
}

export function readCapabilityGrants(
  pluginRoot: string
): PluginCapabilityGrants | null {
  const file = capabilitiesPath(pluginRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return parseCapabilityGrants(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Resolve grants for a loaded plugin root.
 * Marketplace-managed trees without a grants file fail closed (deny).
 * Operator / Local trees without a file stay unrestricted.
 */
export function resolveCapabilityGrants(opts: {
  pluginRoot: string;
  marketplacePluginsRoot?: string | null;
}): PluginCapabilityGrants {
  const existing = readCapabilityGrants(opts.pluginRoot);
  if (existing) return existing;

  const root = path.resolve(opts.pluginRoot);
  const marketRoot = opts.marketplacePluginsRoot
    ? path.resolve(opts.marketplacePluginsRoot)
    : null;
  const underMarketplace =
    marketRoot != null &&
    (root === marketRoot || root.startsWith(marketRoot + path.sep));

  if (underMarketplace) {
    return buildCapabilityGrants({
      trustTier: "official",
      declaredHosts: [],
      declaredTools: [],
      declaredRecords: [],
      grantedAt: new Date(0).toISOString(),
    });
  }
  return buildCapabilityGrants({
    trustTier: "operator",
    grantedAt: new Date(0).toISOString(),
  });
}

export function hostMatchesAllowlist(
  hostname: string,
  hosts: string[]
): boolean {
  const host = normalizeCapabilityHost(hostname);
  if (!host) return false;
  for (const allowed of hosts) {
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1); // ".example.com"
      if (host.endsWith(suffix) && host.length > suffix.length) return true;
      continue;
    }
    if (host === allowed) return true;
  }
  return false;
}

export function assertExternalUrlAllowed(
  grants: PluginCapabilityGrants,
  url: string | URL
): URL {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    throw new Error("Plugin externalFetch: invalid URL");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(
      `Plugin externalFetch: blocked scheme "${parsed.protocol}" (only http/https)`
    );
  }
  const { mode, hosts } = grants.network;
  if (mode === "unrestricted") return parsed;
  if (mode === "deny") {
    throw new Error(
      `Plugin externalFetch denied: network capability is deny-by-default ` +
        `(trust tier ${grants.trustTier}). Grant hosts via catalog/manifest capabilities (#290).`
    );
  }
  if (!hostMatchesAllowlist(parsed.hostname, hosts)) {
    throw new Error(
      `Plugin externalFetch denied: host "${parsed.hostname}" is not in the ` +
        `allowlist [${hosts.join(", ") || "(empty)"}] (#290).`
    );
  }
  return parsed;
}

function assertNamedAllowed(
  kind: "tool" | "record",
  grants: PluginCapabilityGrants,
  name: string
): string {
  const normalized = normalizeCapabilityName(name);
  if (!normalized) {
    throw new Error(`Plugin ${kind} capability: empty name`);
  }
  const cap = kind === "tool" ? grants.tools : grants.records;
  if (cap.mode === "unrestricted") return normalized;
  if (cap.mode === "deny") {
    throw new Error(
      `Plugin ${kind} "${normalized}" denied: ${kind} capability is deny-by-default ` +
        `(trust tier ${grants.trustTier}). Grant names via catalog/manifest capabilities (#303).`
    );
  }
  if (!cap.names.includes(normalized)) {
    throw new Error(
      `Plugin ${kind} "${normalized}" denied: not in the allowlist ` +
        `[${cap.names.join(", ") || "(empty)"}] (#303).`
    );
  }
  return normalized;
}

export function assertToolAllowed(
  grants: PluginCapabilityGrants,
  toolName: string
): string {
  return assertNamedAllowed("tool", grants, toolName);
}

export function assertRecordAllowed(
  grants: PluginCapabilityGrants,
  objectType: string
): string {
  return assertNamedAllowed("record", grants, objectType);
}

export function revokeCapabilityGrants(pluginRoot: string): void {
  const file = capabilitiesPath(pluginRoot);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
