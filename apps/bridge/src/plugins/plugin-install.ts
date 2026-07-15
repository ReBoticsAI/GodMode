import type { CoreDatabase } from "../core-db.js";
import { discoverPluginRoots } from "./loader.js";
import { pluginRuntime } from "./runtime.js";
import { readGodmodePluginManifest } from "@godmode/plugin-api";

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

/** Read model for tenant-visible, fully activated plugins. */
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
  const out: Array<{
    id: string;
    version: string;
    name: string;
    pluginRoot: string;
    loaded: boolean;
  }> = [];
  for (const pluginRoot of discoverPluginRoots()) {
    try {
      const manifest = readGodmodePluginManifest(pluginRoot);
      out.push({
        id: manifest.id,
        version: manifest.version,
        name: manifest.name,
        pluginRoot,
        loaded: pluginRuntime.hasPlugin(manifest.id),
      });
    } catch {
      // Invalid plugin roots are reported by lifecycle reconciliation.
    }
  }
  return out;
}

export function isPluginEnabledForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string
): boolean {
  if (!pluginRuntime.hasPlugin(pluginId)) return false;
  return Boolean(
    core
      .prepare(
        `SELECT 1 FROM tenant_plugins
         WHERE tenant_id=? AND plugin_id=? AND state='active'`
      )
      .get(tenantId, pluginId)
  );
}

export function installedPluginIdsForTenant(
  core: CoreDatabase,
  tenantId: string
): string[] {
  return listInstalledPlugins(core, tenantId).map((row) => row.plugin_id);
}
