import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { getCoreDb, type CoreDatabase } from "../core-db.js";
import type { AppDatabase } from "../db.js";
import { importEntity, type PortableBundle } from "./portability.js";
import { installPluginForTenant } from "../plugins/plugin-install.js";
import { loadPluginFromRoot } from "../plugins/loader.js";

export type CatalogInstallType = "clone" | "plugin";

export interface CatalogEntry {
  id: string;
  kind: string;
  installType: CatalogInstallType;
  title: string;
  description: string;
  version: string;
  author: string;
  tags?: string[];
  bundlePath?: string;
  pluginRepo?: string;
  pluginRef?: string;
  /** Install from an existing local directory (no git clone). */
  pluginLocalPath?: string;
  previewPath?: string;
  sourceCatalog?: string;
  sourceName?: string;
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

function resolveCatalogUrl(customUrl?: string): string {
  if (customUrl?.trim()) return customUrl.trim();
  if (config.marketplace.localCatalogPath && fs.existsSync(config.marketplace.localCatalogPath)) {
    return `file://${path.resolve(config.marketplace.localCatalogPath)}`;
  }
  return config.marketplace.officialUrl;
}

async function fetchCatalogIndex(url: string): Promise<CatalogIndex> {
  const cached = catalogCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < config.marketplace.cacheTtlMs) {
    return cached.index;
  }

  if (url.startsWith("file://")) {
    const filePath = url.slice("file://".length);
    const raw = fs.readFileSync(filePath, "utf8");
    const index = JSON.parse(raw) as CatalogIndex;
    catalogCache.set(url, { url, fetchedAt: Date.now(), etag: null, index });
    return index;
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  const res = await fetch(url, { headers });
  if (res.status === 304 && cached) return cached.index;
  if (!res.ok) throw new Error(`Catalog fetch failed (${res.status}): ${url}`);
  const index = (await res.json()) as CatalogIndex;
  catalogCache.set(url, {
    url,
    fetchedAt: Date.now(),
    etag: res.headers.get("etag"),
    index,
  });
  return index;
}

function entryBaseUrl(index: CatalogIndex, catalogUrl: string): string {
  if (index.repoBase) return index.repoBase.replace(/\/$/, "");
  if (catalogUrl.startsWith("file://")) {
    return path.dirname(catalogUrl.slice("file://".length)).replace(/\\/g, "/");
  }
  const rawUrl = catalogUrl.replace(/\/catalog\/index\.json$/, "");
  return rawUrl;
}

export async function fetchOfficialCatalog(): Promise<{ url: string; entries: CatalogEntry[] }> {
  const url = resolveCatalogUrl();
  const index = await fetchCatalogIndex(url);
  const entries = index.entries.map((e) => ({
    ...e,
    sourceCatalog: url,
    sourceName: "Official",
  }));
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

export async function findCatalogEntry(
  entryId: string,
  opts?: { sourceCatalog?: string; userId?: string }
): Promise<{ entry: CatalogEntry; index: CatalogIndex; catalogUrl: string } | null> {
  const catalogs: Array<{ url: string; name: string }> = [];
  if (opts?.sourceCatalog) {
    catalogs.push({ url: opts.sourceCatalog, name: "custom" });
  } else {
    catalogs.push({ url: resolveCatalogUrl(), name: "Official" });
    if (opts?.userId) {
      for (const s of listCatalogSources(getCoreDb(), opts.userId)) {
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

async function fetchBundleJson(
  entry: CatalogEntry,
  index: CatalogIndex,
  catalogUrl: string
): Promise<PortableBundle> {
  if (!entry.bundlePath) throw new Error("Entry missing bundlePath");
  const base = entryBaseUrl(index, catalogUrl);
  const bundleUrl = `${base}/${entry.bundlePath.replace(/^\//, "")}`;

  if (bundleUrl.startsWith("file://") || catalogUrl.startsWith("file://")) {
    const localPath = bundleUrl.startsWith("file://")
      ? bundleUrl.slice("file://".length)
      : path.join(path.dirname(catalogUrl.slice("file://".length)), "..", entry.bundlePath);
    const resolved = path.resolve(localPath);
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as PortableBundle;
  }

  const res = await fetch(bundleUrl);
  if (!res.ok) throw new Error(`Bundle fetch failed (${res.status}): ${bundleUrl}`);
  return (await res.json()) as PortableBundle;
}

function marketplacePluginsDir(): string {
  const dir = path.join(config.dataDir, "marketplace-plugins");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendPluginPath(core: CoreDatabase, pluginRoot: string): void {
  const key = "marketplace.plugin_paths";
  const existing = core.prepare(`SELECT value FROM platform_meta WHERE key=?`).get(key) as
    | { value: string }
    | undefined;
  const paths: string[] = existing?.value ? JSON.parse(existing.value) : [];
  const resolved = path.resolve(pluginRoot);
  if (!paths.includes(resolved)) paths.push(resolved);
  core.prepare(
    `INSERT INTO platform_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, JSON.stringify(paths));
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

async function installPluginEntry(
  core: CoreDatabase,
  tenantId: string,
  entry: CatalogEntry
): Promise<{ pluginId: string; pluginRoot: string; restartRequired: boolean }> {
  const ref = entry.pluginRef ?? "main";
  const dirName = entry.id.replace(/[^a-z0-9-]/gi, "-");
  let target: string;

  if (entry.pluginLocalPath?.trim()) {
    target = path.resolve(entry.pluginLocalPath.trim());
    if (!fs.existsSync(target)) {
      throw new Error(`pluginLocalPath not found: ${target}`);
    }
  } else {
    if (!entry.pluginRepo) {
      throw new Error("Entry missing pluginRepo or pluginLocalPath");
    }
    target = path.join(marketplacePluginsDir(), dirName);
    const cloneUrl = authenticatedGitCloneUrl(entry.pluginRepo);
    if (fs.existsSync(target)) {
      try {
        execSync("git pull", { cwd: target, stdio: "pipe" });
      } catch {
        fs.rmSync(target, { recursive: true, force: true });
        execSync(`git clone --depth 1 --branch ${ref} ${cloneUrl} ${target}`, {
          stdio: "pipe",
        });
      }
    } else {
      execSync(`git clone --depth 1 --branch ${ref} ${cloneUrl} ${target}`, {
        stdio: "pipe",
      });
    }
  }

  appendPluginPath(core, target);
  const loadResult = await loadPluginFromRoot(target);
  await installPluginForTenant(core, tenantId, loadResult.pluginId, target);
  return { pluginId: loadResult.pluginId, pluginRoot: target, restartRequired: false };
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
  }
): Promise<Record<string, unknown>> {
  ensureCatalogTables(core);
  const found = await findCatalogEntry(opts.entryId, {
    sourceCatalog: opts.sourceCatalog,
    userId: opts.userId,
  });
  if (!found) throw new Error(`Catalog entry not found: ${opts.entryId}`);

  const { entry, index, catalogUrl } = found;
  let result: Record<string, unknown>;

  if (entry.installType === "plugin") {
    result = await installPluginEntry(core, opts.tenantId, entry);
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
