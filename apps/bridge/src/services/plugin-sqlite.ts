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
