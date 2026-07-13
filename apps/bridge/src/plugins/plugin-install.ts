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

export interface TenantPluginRow {
  tenant_id: string;
  plugin_id: string;
  version: string;
  installed_at: string;
  plugin_root: string | null;
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
}

export function listInstalledPlugins(
  core: CoreDatabase,
  tenantId: string
): TenantPluginRow[] {
  return core
    .prepare(
      `SELECT tenant_id, plugin_id, version, installed_at, plugin_root
       FROM tenant_plugins WHERE tenant_id=? ORDER BY installed_at`
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
  core.prepare(
    `INSERT INTO tenant_plugins (tenant_id, plugin_id, version, plugin_root)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, plugin_id) DO UPDATE SET
       version=excluded.version,
       plugin_root=excluded.plugin_root,
       installed_at=datetime('now')`
  ).run(tenantId, pluginId, loaded.manifest.version, root);
  await pluginRuntime.installPluginForTenant(pluginId, tenantId);
  syncPluginKnowledgeForTenant(core, tenantId, pluginId, root);
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

export function isPluginEnabledForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string
): boolean {
  if (!pluginRuntime.hasPlugin(pluginId)) return false;
  const row = core
    .prepare(`SELECT 1 FROM tenant_plugins WHERE tenant_id=? AND plugin_id=?`)
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
  removePluginKnowledge(db, pluginId);
  await pluginRuntime.uninstallPluginForTenant(pluginId, tenantId);
  core.prepare(
    `DELETE FROM tenant_plugins WHERE tenant_id=? AND plugin_id=?`
  ).run(tenantId, pluginId);
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
        `SELECT 1 FROM tenant_plugins WHERE tenant_id=? AND plugin_id=?`
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
