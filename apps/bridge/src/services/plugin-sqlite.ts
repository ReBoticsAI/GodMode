import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { configureDbPragmas } from "./db-config.js";

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const TENANT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const openHandles = new Map<string, Database.Database>();

function assertIds(pluginId: string, tenantId: string): void {
  if (!PLUGIN_ID_RE.test(pluginId)) {
    throw new Error(`Invalid pluginId for plugin SQLite: ${pluginId}`);
  }
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`Invalid tenantId for plugin SQLite: ${tenantId}`);
  }
}

/** Absolute path for a plugin-private SQLite file (never the workspace core DB). */
export function pluginSqlitePath(pluginId: string, tenantId: string): string {
  assertIds(pluginId, tenantId);
  return path.join(config.dataDir, "plugin-data", tenantId, `${pluginId}.sqlite`);
}

/**
 * Open (and cache) a plugin-owned SQLite database for one tenant.
 * Stored under `{PLATFORM_DATA_DIR}/plugin-data/{tenantId}/{pluginId}.sqlite`.
 */
export function openPluginSqlite(
  pluginId: string,
  tenantId: string
): Database.Database {
  assertIds(pluginId, tenantId);
  const key = `${tenantId}::${pluginId}`;
  const existing = openHandles.get(key);
  if (existing) return existing;

  const dbPath = pluginSqlitePath(pluginId, tenantId);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  configureDbPragmas(db);
  openHandles.set(key, db);
  return db;
}

export function closePluginSqlite(pluginId: string, tenantId: string): void {
  assertIds(pluginId, tenantId);
  const key = `${tenantId}::${pluginId}`;
  const db = openHandles.get(key);
  if (!db) return;
  openHandles.delete(key);
  db.close();
}

/** Close every cached plugin SQLite handle for one tenant (uninstall / wipe). */
export function closePluginSqliteForTenant(tenantId: string): void {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`Invalid tenantId for plugin SQLite: ${tenantId}`);
  }
  const prefix = `${tenantId}::`;
  for (const key of [...openHandles.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const db = openHandles.get(key);
    openHandles.delete(key);
    if (!db) continue;
    try {
      db.close();
    } catch (err) {
      console.warn("[plugin-sqlite] close failed", key, err);
    }
  }
}

/**
 * Delete `{dataDir}/plugin-data/{tenantId}/` after closing handles.
 * Used on tenant wipe only; uninstall retains the files.
 */
export function deletePluginDataForTenant(tenantId: string): void {
  closePluginSqliteForTenant(tenantId);
  const dir = path.join(config.dataDir, "plugin-data", tenantId);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Root directory for all plugin-owned SQLite files. */
export function pluginDataRoot(): string {
  return path.join(config.dataDir, "plugin-data");
}

/**
 * Snapshot every on-disk plugin SQLite into `destPluginDataDir` (same relative layout).
 * Uses open handles when present so WAL is included via SQLite backup API.
 */
export async function backupPluginDataTree(
  destPluginDataDir: string,
  backupSqliteFile: (db: Database.Database, destFile: string) => Promise<void>
): Promise<string[]> {
  const srcRoot = pluginDataRoot();
  if (!fs.existsSync(srcRoot)) return [];
  const copied: string[] = [];
  for (const tenantId of fs.readdirSync(srcRoot)) {
    if (!TENANT_ID_RE.test(tenantId)) continue;
    const tenantSrc = path.join(srcRoot, tenantId);
    if (!fs.statSync(tenantSrc).isDirectory()) continue;
    for (const file of fs.readdirSync(tenantSrc)) {
      if (!file.endsWith(".sqlite")) continue;
      const pluginId = file.slice(0, -".sqlite".length);
      if (!PLUGIN_ID_RE.test(pluginId)) continue;
      const key = `${tenantId}::${pluginId}`;
      const destFile = path.join(destPluginDataDir, tenantId, file);
      const existing = openHandles.get(key);
      const opened = existing ?? new Database(path.join(tenantSrc, file), { readonly: true });
      try {
        await backupSqliteFile(opened, destFile);
        copied.push(path.join(tenantId, file).replace(/\\/g, "/"));
      } finally {
        if (!existing) opened.close();
      }
    }
  }
  return copied;
}

export function closeAllPluginSqlite(): void {
  for (const [key, db] of openHandles) {
    try {
      db.close();
    } catch (err) {
      console.warn("[plugin-sqlite] close failed", key, err);
    }
  }
  openHandles.clear();
}

/** Test helper: whether a tenant/plugin pair currently holds an open handle. */
export function isPluginSqliteOpen(pluginId: string, tenantId: string): boolean {
  assertIds(pluginId, tenantId);
  return openHandles.has(`${tenantId}::${pluginId}`);
}
