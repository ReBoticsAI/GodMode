import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config, tenantWorkspaceDir } from "../config.js";
import { getCloudDb, type CoreDatabase } from "../core-db.js";
import type { AppDatabase } from "../db.js";
import { importEntity, type PortableBundle } from "./portability.js";
import {
  listAvailablePlugins,
  listInstalledPlugins,
} from "../plugins/plugin-install.js";
import { pluginRuntime } from "../plugins/runtime.js";
import { bridgeEntryExists, ensurePluginBuilt } from "./plugin-build.js";
import { pluginPathFromEnv, readGodmodePluginManifest } from "@godmode/plugin-api";
import {
  activatePluginForTenant,
  installPluginForTenant,
  persistPluginPath,
  uninstallPluginForTenant,
} from "./plugin-lifecycle.js";
import { assertDeployAllowed } from "./authority/deploy-authority.js";
import {
  attachListingCommerceToCatalogEntry,
  communityPluginInstallBlock,
  isCommunityCatalogSource,
} from "./marketplace-listing-policy.js";
import {
  applyCommunityCommerceOverlay,
  fetchRemoteCommunityShelf,
} from "./marketplace-community-shelf.js";
import {
  findListingByCatalogEntryId,
  listingCommerceMapForCatalogEntries,
} from "./marketplace-listings.js";
import {
  hasPaidEntitlementForCatalogEntry,
  hasPaidEntitlementForListing,
  MarketplaceCommerceError,
} from "./marketplace-commerce.js";
import {
  assertPluginInstallPin,
  materializePinnedPluginCheckout,
  resolvePluginPinPolicy,
} from "./marketplace-plugin-pin.js";
import {
  buildCapabilityGrants,
  collectDeclaredCapabilityNames,
  collectDeclaredNetworkHosts,
  resolvePluginTrustTier,
  writeCapabilityGrants,
} from "./plugin-capabilities.js";

export type CatalogInstallType = "clone" | "plugin";

export interface CatalogEntry {
  id: string;
  kind: string;
  installType: CatalogInstallType;
  /** clone (default) or live Shared grant on seller host (#596). */
  deliveryMode?: "clone" | "live";
  title: string;
  description: string;
  version: string;
  author: string;
  tags?: string[];
  bundlePath?: string;
  pluginRepo?: string;
  /** Immutable git tag or commit for Official/Community installs (#177). */
  pluginRef?: string;
  /** Optional full/prefix commit sha; fail closed if HEAD drifts (#177). */
  pluginDigest?: string;
  /**
   * Hostnames Official/Community installs may grant for `host.externalFetch` (#290).
   * Empty / omitted => network deny-by-default for restricted trust tiers.
   */
  networkHosts?: string[];
  /**
   * Tool names Official/Community installs may grant for `api.tools.register` (#303).
   * Empty / omitted => tools deny-by-default for restricted trust tiers.
   */
  toolNames?: string[];
  /**
   * ObjectType names Official/Community installs may grant for records (#303).
   * Empty / omitted => records deny-by-default for restricted trust tiers.
   */
  recordNames?: string[];
  /** Install from an existing local directory (no git clone). */
  pluginLocalPath?: string;
  previewPath?: string;
  sourceCatalog?: string;
  sourceName?: string;
  /** USD cents; 0 = free. Present on SaaS Official feed. */
  priceCents?: number;
  currency?: string;
  listingId?: string;
  /** Listing status when joined from this host or the Cloud Community overlay. */
  listingStatus?: string;
  /** Set when listing commerce lives on GodMode Cloud rather than this Bridge. */
  commerceHost?: string;
  /**
   * Curated Official publisher identity signal (#309).
   * Explicit `false` wins; Official serve paths default to `true`.
   * Not a security boundary (pins / capability grants remain authoritative).
   */
  verifiedPublisher?: boolean;
}

export interface CatalogIndex {
  version: number;
  repoBase?: string;
  updatedAt?: string;
  entries: CatalogEntry[];
}

interface CatalogCache {
  url: string;
  fetchedAt: number;
  etag: string | null;
  index: CatalogIndex;
}

const catalogCache = new Map<string, CatalogCache>();
const catalogInflight = new Map<string, Promise<CatalogIndex>>();

export function resetMarketplaceCatalogCacheForTests(): void {
  catalogCache.clear();
  catalogInflight.clear();
}

export function ensureCatalogTables(core: CoreDatabase): void {
  core.exec(`
    CREATE TABLE IF NOT EXISTS catalog_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS catalog_sources_user_idx ON catalog_sources(user_id);

    CREATE TABLE IF NOT EXISTS catalog_installs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      entry_title TEXT NOT NULL,
      install_type TEXT NOT NULL,
      source_catalog TEXT,
      installed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS catalog_installs_tenant_idx ON catalog_installs(tenant_id, installed_at DESC);
  `);
}

export function resolveOfficialCatalogUrl(customUrl?: string): string {
  if (customUrl?.trim()) return customUrl.trim();
  if (config.marketplace.localCatalogPath && fs.existsSync(config.marketplace.localCatalogPath)) {
    return `file://${path.resolve(config.marketplace.localCatalogPath)}`;
  }
  return config.marketplace.officialUrl;
}

function resolveCatalogUrl(customUrl?: string): string {
  return resolveOfficialCatalogUrl(customUrl);
}

function catalogFetchTimeoutMs(): number {
  const n = Number(config.marketplace.catalogFetchTimeoutMs);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError")
  );
}

export async function fetchCatalogIndex(url: string): Promise<CatalogIndex> {
  const cached = catalogCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < config.marketplace.cacheTtlMs) {
    return cached.index;
  }

  const inflight = catalogInflight.get(url);
  if (inflight) return inflight;

  const pending = loadCatalogIndex(url).finally(() => {
    catalogInflight.delete(url);
  });
  catalogInflight.set(url, pending);
  return pending;
}

async function loadCatalogIndex(url: string): Promise<CatalogIndex> {
  const cached = catalogCache.get(url);
  try {
    if (url.startsWith("file://")) {
      const filePath = url.slice("file://".length);
      const raw = fs.readFileSync(filePath, "utf8");
      const index = JSON.parse(raw) as CatalogIndex;
      catalogCache.set(url, { url, fetchedAt: Date.now(), etag: null, index });
      return index;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(catalogFetchTimeoutMs()),
    });
    if (res.status === 304 && cached) {
      catalogCache.set(url, { ...cached, fetchedAt: Date.now() });
      return cached.index;
    }
    if (!res.ok) throw new Error(`Catalog fetch failed (${res.status}): ${url}`);
    const index = (await res.json()) as CatalogIndex;
    catalogCache.set(url, {
      url,
      fetchedAt: Date.now(),
      etag: res.headers.get("etag"),
      index,
    });
    return index;
  } catch (err) {
    if (cached) {
      console.warn(
        `[catalog] using stale cache for ${url}:`,
        isAbortError(err) ? "timed out" : err instanceof Error ? err.message : err
      );
      return cached.index;
    }
    if (isAbortError(err)) {
      throw new Error(`Catalog fetch timed out: ${url}`);
    }
    throw err;
  }
}

function entryBaseUrl(index: CatalogIndex, catalogUrl: string): string {
  if (index.repoBase) return index.repoBase.replace(/\/$/, "");
  if (catalogUrl.startsWith("file://")) {
    return path.dirname(catalogUrl.slice("file://".length)).replace(/\\/g, "/");
  }
  const rawUrl = catalogUrl.replace(/\/catalog\/index\.json$/, "");
  return rawUrl;
}

/**
 * Official shelf is ReBotics-curated (#315). Verified badges are for Community sellers.
 * Official cards only show Verified when explicitly set true (optional).
 */
export function withOfficialVerifiedPublisher<T extends { verifiedPublisher?: boolean }>(
  entry: T
): T & { verifiedPublisher: boolean } {
  return {
    ...entry,
    verifiedPublisher: entry.verifiedPublisher === true,
  };
}

export async function fetchOfficialCatalog(): Promise<{ url: string; entries: CatalogEntry[] }> {
  const url = resolveCatalogUrl();
  const index = await fetchCatalogIndex(url);
  const entries = index.entries.map((e) =>
    withOfficialVerifiedPublisher({
      ...e,
      sourceCatalog: url,
      sourceName: "Official",
    })
  );
  return { url, entries };
}

export function resolveCommunityCatalogUrl(customUrl?: string): string {
  if (customUrl?.trim()) return customUrl.trim();
  if (
    config.marketplace.localCommunityCatalogPath &&
    fs.existsSync(config.marketplace.localCommunityCatalogPath)
  ) {
    return `file://${path.resolve(config.marketplace.localCommunityCatalogPath)}`;
  }
  return config.marketplace.communityUrl;
}

/** Community gated catalog (user sellers). Separate from in-app DB listings. */
export async function fetchCommunityCatalog(
  core?: CoreDatabase
): Promise<{ url: string; entries: CatalogEntry[] }> {
  const url = resolveCommunityCatalogUrl();
  const index = await fetchCatalogIndex(url);
  let entries: CatalogEntry[] = index.entries.map((e) => ({
    ...e,
    sourceCatalog: url,
    sourceName: "Community",
    verifiedPublisher: e.verifiedPublisher === true,
  }));
  const remote = await fetchRemoteCommunityShelf();
  if (remote?.entries.length) {
    entries = applyCommunityCommerceOverlay(entries, remote.entries);
  }
  if (core) {
    const commerceMap = listingCommerceMapForCatalogEntries(
      core,
      entries.map((e) => e.id)
    );
    entries = entries.map((e) => attachListingCommerceToCatalogEntry(e, commerceMap));
    try {
      const { demoteLiveListingsForCatalogPinChanges } = await import(
        "./marketplace-live-bind.js"
      );
      demoteLiveListingsForCatalogPinChanges(core, entries);
    } catch {
      /* bind module optional during early boot */
    }
  }
  return { url, entries };
}

export function listCatalogSources(core: CoreDatabase, userId: string): Array<{
  id: string;
  name: string;
  url: string;
  created_at: string;
}> {
  ensureCatalogTables(core);
  return core
    .prepare(`SELECT id, name, url, created_at FROM catalog_sources WHERE user_id=? ORDER BY created_at`)
    .all(userId) as Array<{ id: string; name: string; url: string; created_at: string }>;
}

export function addCatalogSource(
  core: CoreDatabase,
  userId: string,
  name: string,
  url: string
): string {
  ensureCatalogTables(core);
  const id = uuidv4();
  core.prepare(`INSERT INTO catalog_sources (id, user_id, name, url) VALUES (?, ?, ?, ?)`).run(
    id,
    userId,
    name.trim(),
    url.trim()
  );
  return id;
}

export function removeCatalogSource(core: CoreDatabase, userId: string, id: string): boolean {
  ensureCatalogTables(core);
  const r = core
    .prepare(`DELETE FROM catalog_sources WHERE id=? AND user_id=?`)
    .run(id, userId);
  return r.changes > 0;
}

export async function fetchUnofficialCatalog(
  core: CoreDatabase,
  userId: string
): Promise<CatalogEntry[]> {
  const sources = listCatalogSources(core, userId);
  const merged: CatalogEntry[] = [];
  for (const src of sources) {
    try {
      const index = await fetchCatalogIndex(src.url);
      for (const e of index.entries) {
        merged.push({ ...e, sourceCatalog: src.url, sourceName: src.name });
      }
    } catch (err) {
      console.warn(`[catalog] unofficial source failed ${src.url}:`, err);
    }
  }
  return merged;
}

function catalogSourceName(url: string, fallback = "custom"): string {
  const src = url.toLowerCase();
  if (src.includes("/catalog/community")) return "Community";
  if (src.includes("/catalog/unofficial")) return "Unofficial";
  if (src.includes("/catalog/official") || src.includes("commerce/catalog/official")) {
    return "Official";
  }
  return fallback;
}

export async function findCatalogEntry(
  entryId: string,
  opts?: { sourceCatalog?: string; userId?: string }
): Promise<{ entry: CatalogEntry; index: CatalogIndex; catalogUrl: string } | null> {
  const catalogs: Array<{ url: string; name: string }> = [];
  const source = opts?.sourceCatalog?.trim() ?? "";
  if (source === "saas-official") {
    // Curated SaaS Official rows use a synthetic source id in the UI. Resolve pins
    // from the public Official index (same entry ids / bundle paths after sync).
    catalogs.push({ url: resolveCatalogUrl(), name: "Official" });
  } else if (source) {
    catalogs.push({
      url: source,
      name: catalogSourceName(source),
    });
  } else {
    catalogs.push({ url: resolveCatalogUrl(), name: "Official" });
    catalogs.push({ url: resolveCommunityCatalogUrl(), name: "Community" });
    if (opts?.userId) {
      for (const s of listCatalogSources(getCloudDb(), opts.userId)) {
        catalogs.push({ url: s.url, name: s.name });
      }
    }
  }
  for (const cat of catalogs) {
    try {
      const index = await fetchCatalogIndex(cat.url);
      const entry = index.entries.find((e) => e.id === entryId);
      if (entry) {
        return {
          entry: { ...entry, sourceCatalog: cat.url, sourceName: cat.name },
          index,
          catalogUrl: cat.url,
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function githubOwnerRepo(pluginRepo: string): { owner: string; repo: string } | null {
  const path = pluginRepo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const [owner, repo] = path.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** Raw GitHub URL for a pinned pack file (Community clone entries with pluginRepo). */
export function githubRawContentUrl(pluginRepo: string, ref: string, filePath: string): string {
  const parsed = githubOwnerRepo(pluginRepo);
  if (!parsed) {
    throw new Error(`Invalid GitHub pluginRepo: ${pluginRepo}`);
  }
  const rel = filePath.replace(/^\//, "");
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(ref)}/${rel}`;
}

/** Fetch the pinned portable bundle for a catalog entry (Official path or Community GitHub pin). */
export async function fetchCatalogEntryBundle(
  entry: CatalogEntry,
  index: CatalogIndex,
  catalogUrl: string
): Promise<PortableBundle> {
  return fetchBundleJson(entry, index, catalogUrl);
}

async function fetchBundleJson(
  entry: CatalogEntry,
  index: CatalogIndex,
  catalogUrl: string
): Promise<PortableBundle> {
  if (!entry.bundlePath) throw new Error("Entry missing bundlePath");

  if (entry.pluginRepo?.trim() && entry.installType === "clone") {
    const policy = resolvePluginPinPolicy({ entry, sourceCatalog: catalogUrl });
    const pin = assertPluginInstallPin(entry, policy);
    const bundleUrl = githubRawContentUrl(entry.pluginRepo, pin.ref, entry.bundlePath);
    const res = await fetch(bundleUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(catalogFetchTimeoutMs()),
    });
    if (!res.ok) throw new Error(`Bundle fetch failed (${res.status}): ${bundleUrl}`);
    return (await res.json()) as PortableBundle;
  }

  const base = entryBaseUrl(index, catalogUrl);
  const bundleUrl = `${base}/${entry.bundlePath.replace(/^\//, "")}`;

  if (bundleUrl.startsWith("file://") || catalogUrl.startsWith("file://")) {
    const localPath = bundleUrl.startsWith("file://")
      ? bundleUrl.slice("file://".length)
      : path.join(path.dirname(catalogUrl.slice("file://".length)), "..", entry.bundlePath);
    const resolved = path.resolve(localPath);
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as PortableBundle;
  }

  const res = await fetch(bundleUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(catalogFetchTimeoutMs()),
  });
  if (!res.ok) throw new Error(`Bundle fetch failed (${res.status}): ${bundleUrl}`);
  return (await res.json()) as PortableBundle;
}

function marketplacePluginsDir(): string {
  const dir = path.join(config.dataDir, "marketplace-plugins");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function extraPluginPathsFromMeta(core: CoreDatabase): string[] {
  const row = core.prepare(`SELECT value FROM platform_meta WHERE key=?`).get(
    "marketplace.plugin_paths"
  ) as { value: string } | undefined;
  if (!row?.value) return [];
  try {
    return (JSON.parse(row.value) as string[]).filter((p) => fs.existsSync(p));
  } catch {
    return [];
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

/** Host env plugins, this tenant's workspace, or this tenant's tenant_plugins roots. */
export function pluginRootVisibleToTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginRoot: string
): boolean {
  const resolved = path.resolve(pluginRoot);
  for (const envPath of pluginPathFromEnv()) {
    if (isPathInside(envPath, resolved)) return true;
  }
  if (isPathInside(tenantWorkspaceDir(tenantId), resolved)) return true;
  return listInstalledPlugins(core, tenantId).some(
    (row) => row.plugin_root != null && path.resolve(row.plugin_root) === resolved
  );
}

export function extraPluginPathsForTenant(core: CoreDatabase, tenantId: string): string[] {
  return extraPluginPathsFromMeta(core).filter((pluginRoot) =>
    pluginRootVisibleToTenant(core, tenantId, pluginRoot)
  );
}

/** Keep the tenant_plugins root when the same plugin id also lives under coding-root. */
export function preferInstalledPluginRoots<T extends { id: string; pluginRoot: string }>(
  rows: T[],
  installed: Array<{ plugin_id: string; plugin_root: string | null }>
): T[] {
  const installedRootById = new Map<string, string>();
  for (const row of installed) {
    if (!row.plugin_root) continue;
    installedRootById.set(row.plugin_id, path.resolve(row.plugin_root));
  }
  const out: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const installedRoot = installedRootById.get(row.id);
    if (installedRoot && path.resolve(row.pluginRoot) !== installedRoot) {
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ ...row, pluginRoot: installedRoot ?? path.resolve(row.pluginRoot) });
  }
  return out;
}

export function normalizeLocalPathInput(raw: string): string {
  let p = raw.trim().replace(/^["']|["']$/g, "");
  if (p.startsWith("file://")) {
    p = p.slice("file://".length);
  }
  return path.resolve(p);
}

export function listDiscoveredPluginsForTenant(
  core: CoreDatabase,
  tenantId: string
): Array<{
  id: string;
  version: string;
  name: string;
  pluginRoot: string;
  loaded: boolean;
  installed: boolean;
  source: "env" | "marketplace";
}> {
  const installedIds = new Set(
    listInstalledPlugins(core, tenantId).map((r) => r.plugin_id)
  );
  const marketplacePaths = new Set(
    extraPluginPathsFromMeta(core).map((p) => path.resolve(p))
  );
  const out: Array<{
    id: string;
    version: string;
    name: string;
    pluginRoot: string;
    loaded: boolean;
    installed: boolean;
    source: "env" | "marketplace";
  }> = [];

  for (const p of listAvailablePlugins()) {
    const resolved = path.resolve(p.pluginRoot);
    if (!pluginRootVisibleToTenant(core, tenantId, resolved)) continue;
    out.push({
      id: p.id,
      version: p.version,
      name: p.name,
      pluginRoot: resolved,
      loaded: p.loaded,
      installed: installedIds.has(p.id),
      source: marketplacePaths.has(resolved) ? "marketplace" : "env",
    });
  }
  return preferInstalledPluginRoots(
    out,
    listInstalledPlugins(core, tenantId)
  );
}

export async function registerLocalPluginFolder(
  core: CoreDatabase,
  tenantId: string,
  rawPath: string,
  opts?: { installForTenant?: boolean; userId?: string }
): Promise<{
  pluginId: string;
  pluginRoot: string;
  name: string;
  version: string;
  installed: boolean;
  built: boolean;
}> {
  const pluginRoot = normalizeLocalPathInput(rawPath);
  if (!fs.existsSync(pluginRoot)) {
    throw new Error(`Folder not found: ${pluginRoot}`);
  }
  if (!fs.statSync(pluginRoot).isDirectory()) {
    throw new Error(`Path is not a directory: ${pluginRoot}`);
  }

  const manifest = readGodmodePluginManifest(pluginRoot);
  const builtBefore = bridgeEntryExists(pluginRoot);
  if (!builtBefore) {
    await ensurePluginBuilt(pluginRoot, {
      tenantId,
      userId: opts?.userId,
      action: "register_local_plugin",
    });
  }

  let installed = false;
  if (opts?.installForTenant !== false) {
    await activatePluginForTenant(core, tenantId, pluginRoot, {
      buildIfNeeded: false,
      installForTenant: true,
    });
    installed = true;

    const installId = uuidv4();
    core.prepare(
      `INSERT INTO catalog_installs (id, tenant_id, user_id, entry_id, entry_title, install_type, source_catalog)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      installId,
      tenantId,
      opts?.userId ?? "",
      manifest.id,
      manifest.name,
      "plugin",
      `local://${pluginRoot}`
    );
  } else persistPluginPath(core, pluginRoot);

  return {
    pluginId: manifest.id,
    pluginRoot,
    name: manifest.name,
    version: manifest.version,
    installed,
    built: !builtBefore,
  };
}

export function removeLocalPluginFolder(core: CoreDatabase, rawPath: string): boolean {
  const pluginRoot = normalizeLocalPathInput(rawPath);
  const key = "marketplace.plugin_paths";
  const existing = core.prepare(`SELECT value FROM platform_meta WHERE key=?`).get(key) as
    | { value: string }
    | undefined;
  if (!existing?.value) return false;
  const paths = JSON.parse(existing.value) as string[];
  const next = paths.filter((p) => path.resolve(p) !== pluginRoot);
  if (next.length === paths.length) return false;
  core.prepare(
    `INSERT INTO platform_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, JSON.stringify(next));
  return true;
}

export async function installDiscoveredPlugin(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string
): Promise<void> {
  assertDeployAllowed({
    tenantId,
    action: "install_discovered_plugin",
  });
  const available = listAvailablePlugins().find((p) => p.id === pluginId);
  if (!available) {
    throw new Error(
      `Plugin not available: ${pluginId}. Add its folder under Marketplace → Unofficial first.`
    );
  }
  if (!pluginRuntime.hasPlugin(pluginId)) {
    await activatePluginForTenant(core, tenantId, available.pluginRoot, {
      buildIfNeeded: false,
      installForTenant: true,
    });
    return;
  }
  await installPluginForTenant(core, tenantId, pluginId, available.pluginRoot);
}

export async function uninstallDiscoveredPlugin(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string
): Promise<void> {
  await uninstallPluginForTenant(core, tenantId, pluginId);
}

async function installPluginEntry(
  core: CoreDatabase,
  tenantId: string,
  entry: CatalogEntry,
  sourceCatalog?: string
): Promise<{
  pluginId: string;
  pluginRoot: string;
  restartRequired: boolean;
  built: boolean;
  pluginRef: string;
  pluginDigest?: string;
  capabilities?: {
    trustTier: string;
    networkHosts: string[];
    toolNames: string[];
    recordNames: string[];
  };
}> {
  const policy = resolvePluginPinPolicy({ entry, sourceCatalog });
  const pin = assertPluginInstallPin(entry, policy);
  const dirName = entry.id.replace(/[^a-z0-9-]/gi, "-");
  let target: string;
  let built = false;

  if (entry.pluginLocalPath?.trim()) {
    target = path.resolve(entry.pluginLocalPath.trim());
    if (!fs.existsSync(target)) {
      throw new Error(`pluginLocalPath not found: ${target}`);
    }
    const builtBefore = bridgeEntryExists(target);
    if (!builtBefore) {
      await ensurePluginBuilt(target, {
        tenantId,
        action: "install_catalog_plugin",
      });
      built = true;
    }
  } else {
    if (!entry.pluginRepo) {
      throw new Error("Entry missing pluginRepo or pluginLocalPath");
    }
    target = path.join(marketplacePluginsDir(), dirName);
    const cloneUrl = authenticatedGitCloneUrl(entry.pluginRepo);
    materializePinnedPluginCheckout({
      target,
      cloneUrl,
      ref: pin.ref,
      digest: pin.digest,
      entryId: entry.id,
    });
    if (!bridgeEntryExists(target)) {
      await ensurePluginBuilt(target, {
        tenantId,
        action: "install_catalog_plugin",
      });
      built = true;
    }
  }

  const trustTier = resolvePluginTrustTier({ entry, sourceCatalog });
  let manifestHosts: string[] = [];
  let manifestTools: string[] = [];
  let manifestRecords: string[] = [];
  try {
    const manifest = readGodmodePluginManifest(target);
    manifestHosts = manifest.capabilities?.network?.hosts ?? [];
    manifestTools = manifest.capabilities?.tools?.names ?? [];
    manifestRecords = [
      ...(manifest.capabilities?.records?.names ?? []),
      ...(manifest.objectTypes?.map((ot) => ot.name) ?? []),
    ];
  } catch {
    /* grant from catalog alone when manifest is not readable yet */
  }
  const declaredHosts = collectDeclaredNetworkHosts({
    catalogHosts: entry.networkHosts,
    manifestHosts,
  });
  const declaredTools = collectDeclaredCapabilityNames({
    catalogNames: entry.toolNames,
    manifestNames: manifestTools,
  });
  const declaredRecords = collectDeclaredCapabilityNames({
    catalogNames: entry.recordNames,
    manifestNames: manifestRecords,
  });
  writeCapabilityGrants(
    target,
    buildCapabilityGrants({
      trustTier,
      declaredHosts,
      declaredTools,
      declaredRecords,
      sourceEntryId: entry.id,
    })
  );

  const activation = await activatePluginForTenant(core, tenantId, target, {
    buildIfNeeded: false,
    installForTenant: true,
  });
  return {
    pluginId: activation.pluginId,
    pluginRoot: target,
    restartRequired: false,
    built,
    pluginRef: pin.ref,
    pluginDigest: pin.digest,
    capabilities: {
      trustTier,
      networkHosts: declaredHosts,
      toolNames: declaredTools,
      recordNames: declaredRecords,
    },
  };
}

function authenticatedGitCloneUrl(repo: string): string {
  const token = config.githubToken.trim();
  if (!token) return repo;
  try {
    const u = new URL(repo);
    if (u.protocol === "https:" && u.hostname === "github.com") {
      u.username = "x-access-token";
      u.password = token;
      return u.toString();
    }
  } catch {
    /* not a URL */
  }
  return repo;
}

export async function installCatalogEntry(
  core: CoreDatabase,
  tenantDb: AppDatabase,
  opts: {
    userId: string;
    tenantId: string;
    entryId: string;
    sourceCatalog?: string;
    /** Local Buy (#584): Cloud Stripe session already verified on this Bridge. */
    paymentVerified?: boolean;
  }
): Promise<Record<string, unknown>> {
  ensureCatalogTables(core);
  const found = await findCatalogEntry(opts.entryId, {
    sourceCatalog: opts.sourceCatalog,
    userId: opts.userId,
  });
  if (!found) throw new Error(`Catalog entry not found: ${opts.entryId}`);

  const { entry, index, catalogUrl } = found;
  let priceCents = Number(entry.priceCents ?? 0);
  if (!priceCents) {
    const priced = core
      .prepare(
        `SELECT price_cents FROM marketplace_official_catalog WHERE entry_id=? AND status='active'`
      )
      .get(entry.id) as { price_cents: number } | undefined;
    priceCents = Number(priced?.price_cents ?? 0);
  }
  const community = isCommunityCatalogSource(opts.sourceCatalog ?? catalogUrl);
  if (community) {
    const listing =
      (entry.listingId
        ? (core
            .prepare(`SELECT id, status FROM marketplace_listings WHERE id=?`)
            .get(entry.listingId) as { id: string; status: string } | undefined)
        : undefined) ??
      (findListingByCatalogEntryId(core, entry.id) as
        | { id: string; status: string }
        | undefined) ??
      (entry.listingId
        ? { id: entry.listingId, status: entry.listingStatus ?? "active" }
        : undefined);
    const block = communityPluginInstallBlock({
      priceCents,
      listingId: listing?.id,
      listingStatus: listing?.status,
    });
    if (block) {
      throw new MarketplaceCommerceError(block, 400);
    }
    if (
      priceCents > 0 &&
      listing &&
      !opts.paymentVerified &&
      !hasPaidEntitlementForListing(core, {
        userId: opts.userId,
        listingId: listing.id,
      })
    ) {
      throw new MarketplaceCommerceError(
        "Payment required before installing this Community catalog item. Complete checkout on the listing first.",
        402
      );
    }
  } else if (priceCents > 0 && !opts.paymentVerified) {
    if (
      !hasPaidEntitlementForCatalogEntry(core, {
        userId: opts.userId,
        catalogEntryId: entry.id,
      })
    ) {
      throw new MarketplaceCommerceError(
        "Payment required before installing this Official catalog entry. Complete checkout first.",
        402
      );
    }
  }

  let result: Record<string, unknown>;

  if (entry.installType === "plugin") {
    result = await installPluginEntry(
      core,
      opts.tenantId,
      entry,
      opts.sourceCatalog ?? catalogUrl
    );
  } else {
    const bundle = await fetchBundleJson(entry, index, catalogUrl);
    const imported = importEntity(tenantDb, bundle);
    result = { mode: "clone", import: imported };
  }

  const installId = uuidv4();
  core.prepare(
    `INSERT INTO catalog_installs (id, tenant_id, user_id, entry_id, entry_title, install_type, source_catalog)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    installId,
    opts.tenantId,
    opts.userId,
    entry.id,
    entry.title,
    entry.installType,
    catalogUrl
  );

  return { installId, entryId: entry.id, title: entry.title, ...result };
}

export function listCatalogInstalls(
  core: CoreDatabase,
  tenantId: string
): Array<Record<string, unknown>> {
  ensureCatalogTables(core);
  return core
    .prepare(
      `SELECT id, entry_id, entry_title, install_type, source_catalog, installed_at
       FROM catalog_installs WHERE tenant_id=? ORDER BY installed_at DESC`
    )
    .all(tenantId) as Array<Record<string, unknown>>;
}
