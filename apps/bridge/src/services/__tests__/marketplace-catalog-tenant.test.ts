import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { ensureTenantPluginsStorage } from "../plugin-lifecycle.js";
import {
  extraPluginPathsForTenant,
  pluginRootVisibleToTenant,
  preferInstalledPluginRoots,
} from "../marketplace-catalog.js";

const temps: string[] = [];
const previousWorkspaces = config.tenantWorkspacesDir;

afterEach(() => {
  config.tenantWorkspacesDir = previousWorkspaces;
  while (temps.length) {
    fs.rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe("marketplace catalog tenant isolation", () => {
  it("hides other tenants' plugin roots from installed/discovered lists", () => {
    const root = tempDir("gm-catalog-");
    config.tenantWorkspacesDir = path.join(root, "tenant-workspaces");
    const tenantA = path.join(config.tenantWorkspacesDir, "tenant-a", "plugins", "pulse");
    const tenantB = path.join(config.tenantWorkspacesDir, "tenant-b", "plugins", "tips");
    fs.mkdirSync(tenantA, { recursive: true });
    fs.mkdirSync(tenantB, { recursive: true });

    const core = new Database(":memory:");
    core.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      INSERT INTO tenants (id) VALUES ('tenant-a'), ('tenant-b');
    `);
    ensureTenantPluginsStorage(core);
    core.exec(`
      CREATE TABLE IF NOT EXISTS platform_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    core
      .prepare(
        `INSERT INTO platform_meta (key, value) VALUES ('marketplace.plugin_paths', ?)`
      )
      .run(JSON.stringify([tenantA, tenantB]));
    core
      .prepare(
        `INSERT INTO tenant_plugins (tenant_id, plugin_id, version, plugin_root, state)
         VALUES ('tenant-a', 'workspace-pulse', '0.1.0', ?, 'active')`
      )
      .run(tenantA);

    expect(pluginRootVisibleToTenant(core, "tenant-a", tenantA)).toBe(true);
    expect(pluginRootVisibleToTenant(core, "tenant-a", tenantB)).toBe(false);
    expect(pluginRootVisibleToTenant(core, "tenant-b", tenantB)).toBe(true);
    expect(extraPluginPathsForTenant(core, "tenant-a").map((p) => path.resolve(p))).toEqual([
      path.resolve(tenantA),
    ]);
    expect(extraPluginPathsForTenant(core, "tenant-b").map((p) => path.resolve(p))).toEqual([
      path.resolve(tenantB),
    ]);
    core.close();
  });

  it("drops coding-root copies when tenant_plugins already points at the catalog root", () => {
    const codingRoot = path.join("/data", "tenant-workspaces", "tenant-a", "plugins", "pulse");
    const catalogRoot = path.join("/data", "marketplace-plugins", "pulse");
    const rows = preferInstalledPluginRoots(
      [
        { id: "workspace-pulse", pluginRoot: codingRoot },
        { id: "workspace-pulse", pluginRoot: catalogRoot },
        { id: "other", pluginRoot: path.join("/data", "plugins", "other") },
      ],
      [{ plugin_id: "workspace-pulse", plugin_root: catalogRoot }]
    );
    expect(rows.map((row) => row.pluginRoot)).toEqual([
      path.resolve(catalogRoot),
      path.resolve(path.join("/data", "plugins", "other")),
    ]);
  });
});
