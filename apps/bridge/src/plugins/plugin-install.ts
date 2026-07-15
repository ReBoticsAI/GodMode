import type { CoreDatabase } from "../core-db.js";
import type { AppDatabase } from "../db.js";
import { readGodmodePluginManifest } from "@godmode/plugin-api";
import { discoverPluginRoots } from "./loader.js";
import { pluginRuntime } from "./runtime.js";
import {
  importPluginKnowledgeFromRoot,
  removePluginKnowledge,
} from "../services/knowledge-store.js";
import { getTenantDb } from "../tenant-registry.js";
import { applyPluginObjectTypeSeeds, registerPluginObjectTypes } from "../kernel/plugin-object-types.js";
import { unregisterObjectTypesByPlugin } from "../kernel/registry.js";

export interface TenantPluginRow {
  tenant_id: string;
  plugin_id: string;
  version: string;
  installed_at: string;
  plugin_root: string | null;
  state: "installing" | "active" | "uninstalling" | "failed";
  last_error: string | null;
  updated_at: string;
}

export function ensureTenantPluginsTable(core: CoreDatabase): void {
  core.exec(`
    CREATE TABLE IF NOT EXISTS tenant_plugins (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL,
      version TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      plugin_root TEXT,
      PRIMARY KEY (tenant_id, plugin_id)
    );
    CREATE INDEX IF NOT EXISTS tenant_plugins_tenant_idx ON tenant_plugins(tenant_id);
  `);
  const columns = new Set(
    (
      core.prepare(`PRAGMA table_info(tenant_plugins)`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name)
  );
  if (!columns.has("state")) {
    core.exec(
      `ALTER TABLE tenant_plugins ADD COLUMN state TEXT NOT NULL DEFAULT 'active'`
    );
  }
  if (!columns.has("last_error")) {
    core.exec(`ALTER TABLE tenant_plugins ADD COLUMN last_error TEXT`);
  }
  if (!columns.has("updated_at")) {
    core.exec(`ALTER TABLE tenant_plugins ADD COLUMN updated_at TEXT`);
    core.exec(
      `UPDATE tenant_plugins SET updated_at=COALESCE(updated_at, installed_at)`
    );
  }
}

export function listInstalledPlugins(
  core: CoreDatabase,
  tenantId: string
): TenantPluginRow[] {
  return core
    .prepare(
      `SELECT tenant_id, plugin_id, version, installed_at, plugin_root,
              state, last_error, COALESCE(updated_at, installed_at) AS updated_at
       FROM tenant_plugins
       WHERE tenant_id=? AND state='active'
       ORDER BY installed_at`
    )
    .all(tenantId) as TenantPluginRow[];
}

export function listAvailablePlugins(): Array<{
  id: string;
  version: string;
  name: string;
  pluginRoot: string;
  loaded: boolean;
}> {
  const roots = discoverPluginRoots();
  const out: Array<{
    id: string;
    version: string;
    name: string;
    pluginRoot: string;
    loaded: boolean;
  }> = [];
  for (const pluginRoot of roots) {
    try {
      const m = readGodmodePluginManifest(pluginRoot);
      out.push({
        id: m.id,
        version: m.version,
        name: m.name,
        pluginRoot,
        loaded: pluginRuntime.hasPlugin(m.id),
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function installPluginForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string,
  pluginRoot?: string
): Promise<void> {
  const loaded = pluginRuntime.getPlugin(pluginId);
  if (!loaded) {
    throw new Error(
      `Plugin not loaded: ${pluginId}. Call install_plugin (or Marketplace → Unofficial) so Bridge can load it at runtime — no restart required for tools/tenant:install.`
    );
  }
  const root = pluginRoot ?? loaded.pluginRoot;
  registerPluginObjectTypes(loaded.manifest);
  ensureTenantPluginsTable(core);
  core.prepare(
    `INSERT INTO tenant_plugins
     (tenant_id, plugin_id, version, plugin_root, state, last_error, updated_at)
     VALUES (?, ?, ?, ?, 'installing', NULL, datetime('now'))
     ON CONFLICT(tenant_id, plugin_id) DO UPDATE SET
       version=excluded.version,
       plugin_root=excluded.plugin_root,
       state='installing',
       last_error=NULL,
       installed_at=datetime('now'),
       updated_at=datetime('now')`
  ).run(tenantId, pluginId, loaded.manifest.version, root);
  try {
    const tenantDb = getTenantDb(tenantId);
    applyPluginObjectTypeSeeds(tenantDb, loaded.manifest);
    await pluginRuntime.installPluginForTenant(pluginId, tenantId);
    syncPluginKnowledgeForTenant(core, tenantId, pluginId, root);
    core.prepare(
      `UPDATE tenant_plugins
       SET state='active', last_error=NULL, updated_at=datetime('now')
       WHERE tenant_id=? AND plugin_id=?`
    ).run(tenantId, pluginId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      removePluginKnowledge(getTenantDb(tenantId), pluginId);
      await pluginRuntime.uninstallPluginForTenant(pluginId, tenantId);
    } catch {
      // Reconciliation will retry compensation from the durable failed state.
    }
    core.prepare(
      `UPDATE tenant_plugins
       SET state='failed', last_error=?, updated_at=datetime('now')
       WHERE tenant_id=? AND plugin_id=?`
    ).run(message, tenantId, pluginId);
    throw error;
  }
}

function syncPluginKnowledgeForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string,
  pluginRoot: string
): void {
  const db = getTenantDb(tenantId);
  const { rules, skills } = importPluginKnowledgeFromRoot(db, pluginRoot, pluginId);
  if (rules > 0 || skills > 0) {
    console.log(
      `[plugins] imported knowledge for ${pluginId} on tenant ${tenantId}: ${rules} rules, ${skills} skills`
    );
  }
}

export function syncInstalledPluginKnowledge(
  core: CoreDatabase,
  tenantId: string
): void {
  for (const row of listInstalledPlugins(core, tenantId)) {
    const root =
      row.plugin_root ??
      pluginRuntime.getPlugin(row.plugin_id)?.pluginRoot ??
      null;
    if (!root) continue;
    syncPluginKnowledgeForTenant(core, tenantId, row.plugin_id, root);
  }
}

/** Reconcile declarative ObjectType storage/seeds for every installed tenant. */
export function reconcileInstalledPluginObjectTypes(core: CoreDatabase): void {
  ensureTenantPluginsTable(core);
  const rows = core
    .prepare(
      `SELECT tenant_id, plugin_id FROM tenant_plugins
       WHERE state='active' ORDER BY tenant_id, plugin_id`
    )
    .all() as Array<{ tenant_id: string; plugin_id: string }>;
  for (const row of rows) {
    const loaded = pluginRuntime.getPlugin(row.plugin_id);
    if (!loaded) continue;
    registerPluginObjectTypes(loaded.manifest);
    applyPluginObjectTypeSeeds(getTenantDb(row.tenant_id), loaded.manifest);
  }
}

export function isPluginEnabledForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string
): boolean {
  if (!pluginRuntime.hasPlugin(pluginId)) return false;
  const row = core
    .prepare(
      `SELECT 1 FROM tenant_plugins
       WHERE tenant_id=? AND plugin_id=? AND state='active'`
    )
    .get(tenantId, pluginId);
  return Boolean(row);
}

export function installedPluginIdsForTenant(core: CoreDatabase, tenantId: string): string[] {
  return listInstalledPlugins(core, tenantId).map((r) => r.plugin_id);
}

export async function uninstallPluginForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string
): Promise<void> {
  const db = getTenantDb(tenantId);
  core.prepare(
    `UPDATE tenant_plugins
     SET state='uninstalling', last_error=NULL, updated_at=datetime('now')
     WHERE tenant_id=? AND plugin_id=?`
  ).run(tenantId, pluginId);
  try {
    removePluginKnowledge(db, pluginId);
    await pluginRuntime.uninstallPluginForTenant(pluginId, tenantId);
    core.prepare(
      `DELETE FROM tenant_plugins WHERE tenant_id=? AND plugin_id=?`
    ).run(tenantId, pluginId);
  } catch (error) {
    core.prepare(
      `UPDATE tenant_plugins
       SET state='failed', last_error=?, updated_at=datetime('now')
       WHERE tenant_id=? AND plugin_id=?`
    ).run(error instanceof Error ? error.message : String(error), tenantId, pluginId);
    throw error;
  }
  const remaining = core
    .prepare(`SELECT 1 FROM tenant_plugins WHERE plugin_id=? LIMIT 1`)
    .get(pluginId);
  if (!remaining) unregisterObjectTypesByPlugin(pluginId);
}

export async function ensureOperatorPluginsInstalled(
  core: CoreDatabase,
  operatorTenantId: string,
  operatorDb: AppDatabase
): Promise<void> {
  ensureTenantPluginsTable(core);
  for (const plugin of pluginRuntime.loaded) {
    const row = core
      .prepare(
        `SELECT 1 FROM tenant_plugins
         WHERE tenant_id=? AND plugin_id=? AND state='active'`
      )
      .get(operatorTenantId, plugin.manifest.id);
    if (row) continue;
    const departmentIds = plugin.manifest.departments ?? [];
    const hasExistingStructure =
      departmentIds.length > 0 &&
      departmentIds.some((deptId) =>
        Boolean(
          operatorDb
            .prepare(`SELECT 1 FROM structure_nodes WHERE id=?`)
            .get(deptId)
        )
      );
    if (hasExistingStructure) {
      core.prepare(
        `INSERT OR IGNORE INTO tenant_plugins (tenant_id, plugin_id, version, plugin_root)
         VALUES (?, ?, ?, ?)`
      ).run(
        operatorTenantId,
        plugin.manifest.id,
        plugin.manifest.version,
        plugin.pluginRoot
      );
      continue;
    }
    await installPluginForTenant(
      core,
      operatorTenantId,
      plugin.manifest.id,
      plugin.pluginRoot
    );
  }
}
