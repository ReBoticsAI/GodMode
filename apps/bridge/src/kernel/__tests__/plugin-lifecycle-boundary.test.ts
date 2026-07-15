import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ensureTenantPluginsStorage } from "../../services/plugin-lifecycle.js";
import { listInstalledPlugins } from "../../plugins/plugin-install.js";
import { registerPluginObjectTypes } from "../plugin-object-types.js";
import {
  getObjectType,
  registerObjectType,
  unregisterObjectType,
} from "../registry.js";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("plugin lifecycle kernel boundary", () => {
  it("keeps durable mutation services behind the CatalogInstall adapter", () => {
    const entrypoints = [
      source("../../plugins/loader.ts"),
      source("../../plugins/plugin-host-bridge.ts"),
      source("../../plugins/plugin-install.ts"),
      source("../../routes/plugins.ts"),
      source("../../routes/marketplace-catalog.ts"),
    ].join("\n");
    expect(entrypoints).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b|\b(?:mkdir|rm|writeFile|symlink)Sync\s*\(/
    );
    expect(entrypoints).not.toMatch(
      /services\/plugin-lifecycle|installPluginForTenant|uninstallPluginForTenant/
    );

    const adapter = source("../adapters/platform-actions.ts");
    expect(adapter).toMatch(/services\/plugin-lifecycle\.js/);
    expect(adapter).toMatch(/activate_plugin_path/);
    expect(adapter).toMatch(/uninstall_plugin/);
    expect(adapter).toMatch(/reconcile_runtime/);
  });

  it("dispatches boot and AI activation through declared kernel actions", () => {
    const bootstrap = source("../../bootstrap.ts");
    expect(bootstrap).toMatch(
      /executeCollectionAction\(\s*db,\s*"CatalogInstall",\s*"load_runtime"/
    );
    expect(bootstrap).toMatch(
      /executeCollectionAction\(\s*db,\s*"CatalogInstall",\s*"reconcile_runtime"/
    );

    const ai = source("../../services/ai-tool-executor.ts");
    expect(ai).toMatch(
      /objectType:\s*"CatalogInstall"[\s\S]*action:\s*"activate_plugin_path"/
    );
    expect(ai).not.toMatch(/activatePluginForTenant/);

    const runtime = source("../../plugins/runtime.ts");
    expect(runtime).toMatch(
      /async installTenant[\s\S]*executeCollectionAction\([\s\S]*"CatalogInstall"[\s\S]*"install_plugin"/
    );
  });

  it("upgrades historical lifecycle rows and preserves tenant visibility", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tenant_plugins (
        tenant_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        version TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        plugin_root TEXT,
        PRIMARY KEY (tenant_id, plugin_id)
      );
      INSERT INTO tenant_plugins
        (tenant_id, plugin_id, version, installed_at, plugin_root)
      VALUES
        ('tenant-a', 'alpha', '1.0.0', '2026-01-01', '/alpha'),
        ('tenant-b', 'beta', '1.0.0', '2026-01-01', '/beta');
    `);

    ensureTenantPluginsStorage(db);

    expect(
      db.prepare(`SELECT state, desired_state, updated_at FROM tenant_plugins WHERE plugin_id='alpha'`).get()
    ).toEqual({
      state: "active",
      desired_state: "active",
      updated_at: "2026-01-01",
    });
    expect(listInstalledPlugins(db, "tenant-a").map((row) => row.plugin_id)).toEqual([
      "alpha",
    ]);
    expect(listInstalledPlugins(db, "tenant-b").map((row) => row.plugin_id)).toEqual([
      "beta",
    ]);
  });

  it("preserves executable ObjectTypes when a manifest has no declarative definitions", () => {
    registerObjectType({
      name: "ExecutablePluginRecord",
      label: "Executable Plugin Record",
      pluginId: "executable-plugin-test",
      contractVersion: 1,
      storage: { kind: "adapter", adapterId: "executable-plugin-test" },
      fields: [{ name: "id", label: "Id", fieldType: "Data" }],
      operations: ["list"],
      permissions: [{ role: "owner", read: true }],
    });

    registerPluginObjectTypes({
      id: "executable-plugin-test",
      name: "Executable Plugin Test",
      version: "1.0.0",
      bridge: { entry: "dist/bridge.js" },
    });

    expect(getObjectType("ExecutablePluginRecord")).toBeTruthy();
    unregisterObjectType("ExecutablePluginRecord");
  });
});
