#!/usr/bin/env tsx
/**
 * GodMode plugin management CLI.
 *
 * Usage:
 *   npm run plugins -- list
 *   npm run plugins -- install sierra-chart --tenant <id>
 *   npm run plugins -- uninstall polymarket --tenant <id>
 */
import "dotenv/config";
import { initCoreDb } from "../apps/bridge/src/core-db.js";
import { getTenantDb } from "../apps/bridge/src/tenant-registry.js";
import { loadPluginsFromEnv } from "../apps/bridge/src/plugins/loader.js";
import { pluginRuntime } from "../apps/bridge/src/plugins/runtime.js";
import { EventEmitter } from "node:events";
import {
  ensureTenantPluginsTable,
  installPluginForTenant,
  listAvailablePlugins,
  listInstalledPlugins,
  uninstallPluginForTenant,
} from "../apps/bridge/src/plugins/plugin-install.js";
import { ensurePlatformBootstrap } from "../apps/bridge/src/services/tenant-bootstrap.js";

async function main(): Promise<void> {
  const [command, pluginId, ...rest] = process.argv.slice(2);
  const tenantFlag = rest.indexOf("--tenant");
  const tenantId =
    tenantFlag >= 0 ? rest[tenantFlag + 1] : process.env.GODMODE_OPERATOR_TENANT_ID;

  const coreDb = initCoreDb();
  ensureTenantPluginsTable(coreDb);
  const { operatorTenantId } = ensurePlatformBootstrap();
  const targetTenant = tenantId ?? operatorTenantId;

  await loadPluginsFromEnv();
  pluginRuntime.configure({ operatorTenantId, bus: new EventEmitter() });

  if (!command || command === "list") {
    console.log("Available (GODMODE_PLUGIN_PATH):");
    for (const p of listAvailablePlugins()) {
      console.log(`  ${p.loaded ? "✓" : "○"} ${p.id}@${p.version} — ${p.name}`);
      console.log(`      ${p.pluginRoot}`);
    }
    if (targetTenant) {
      console.log(`\nInstalled for tenant ${targetTenant}:`);
      for (const row of listInstalledPlugins(coreDb, targetTenant)) {
        console.log(`  ${row.plugin_id}@${row.version} (${row.installed_at})`);
      }
    }
    return;
  }

  if (!targetTenant) {
    console.error("Pass --tenant <id> or set GODMODE_OPERATOR_TENANT_ID");
    process.exit(1);
  }

  getTenantDb(targetTenant);

  if (command === "install") {
    if (!pluginId) {
      console.error("Usage: npm run plugins -- install <plugin-id> --tenant <id>");
      process.exit(1);
    }
    await installPluginForTenant(coreDb, targetTenant, pluginId);
    console.log(`Installed ${pluginId} for tenant ${targetTenant}`);
    return;
  }

  if (command === "uninstall") {
    if (!pluginId) {
      console.error("Usage: npm run plugins -- uninstall <plugin-id> --tenant <id>");
      process.exit(1);
    }
    uninstallPluginForTenant(coreDb, targetTenant, pluginId);
    console.log(`Uninstalled ${pluginId} for tenant ${targetTenant}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
