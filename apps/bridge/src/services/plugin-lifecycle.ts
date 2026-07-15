import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { CoreDatabase } from "../core-db.js";
import type { AppDatabase } from "../db.js";
import { readGodmodePluginManifest } from "@godmode/plugin-api";
import { ensurePluginBuilt } from "./plugin-build.js";
import {
  discoverPluginRoots,
  loadPluginFromRoot,
  type LoadPluginsResult,
} from "../plugins/loader.js";
import { pluginRuntime } from "../plugins/runtime.js";
import {
  importPluginKnowledgeFromRoot,
  removePluginKnowledge,
} from "./knowledge-store.js";
import { getTenantDb } from "../tenant-registry.js";
import {
  applyPluginObjectTypeSeeds,
  registerPluginObjectTypes,
} from "../kernel/plugin-object-types.js";
import { unregisterObjectTypesByPlugin } from "../kernel/registry.js";
import { listInstalledPlugins } from "../plugins/plugin-install.js";

const hostRequire = createRequire(import.meta.url);
const HOST_LINKED_PACKAGES = ["plugin-api", "plugin-host"] as const;
const PLUGIN_PATHS_KEY = "marketplace.plugin_paths";

export interface ActivatePluginResult {
  pluginId: string;
  pluginRoot: string;
  installed: boolean;
  built: boolean;
  reloaded: boolean;
}

export function ensureTenantPluginsStorage(core: CoreDatabase): void {
  core.transaction(() => {
    core.exec(`
      CREATE TABLE IF NOT EXISTS tenant_plugins (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plugin_id TEXT NOT NULL,
        version TEXT NOT NULL,
        installed_at TEXT NOT NULL DEFAULT (datetime('now')),
        plugin_root TEXT,
        state TEXT NOT NULL DEFAULT 'active',
        desired_state TEXT NOT NULL DEFAULT 'active',
        last_error TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tenant_id, plugin_id)
      );
      CREATE INDEX IF NOT EXISTS tenant_plugins_tenant_idx ON tenant_plugins(tenant_id);
    `);
    const columns = new Set(
      (core.prepare(`PRAGMA table_info(tenant_plugins)`).all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!columns.has("state")) {
      core.exec(`ALTER TABLE tenant_plugins ADD COLUMN state TEXT NOT NULL DEFAULT 'active'`);
    }
    if (!columns.has("last_error")) {
      core.exec(`ALTER TABLE tenant_plugins ADD COLUMN last_error TEXT`);
    }
    if (!columns.has("desired_state")) {
      core.exec(
        `ALTER TABLE tenant_plugins ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'active'`
      );
    }
    if (!columns.has("updated_at")) {
      core.exec(`ALTER TABLE tenant_plugins ADD COLUMN updated_at TEXT`);
      core.exec(`UPDATE tenant_plugins SET updated_at=COALESCE(updated_at, installed_at)`);
    }
  })();
}

export function persistPluginPath(core: CoreDatabase, pluginRoot: string): void {
  const existing = core.prepare(`SELECT value FROM platform_meta WHERE key=?`).get(
    PLUGIN_PATHS_KEY
  ) as { value: string } | undefined;
  const paths: string[] = existing?.value ? JSON.parse(existing.value) : [];
  const resolved = path.resolve(pluginRoot);
  if (!paths.some((candidate) => path.resolve(candidate) === resolved)) paths.push(resolved);
  core
    .prepare(
      `INSERT INTO platform_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    )
    .run(PLUGIN_PATHS_KEY, JSON.stringify(paths));
}

/**
 * Prepare only host-owned links below a validated plugin root. Link deletion
 * cannot escape node_modules/@godmode, and targets must resolve from Bridge.
 */
export function prepareHostPackageLinks(pluginRoot: string): void {
  const root = path.resolve(pluginRoot);
  readGodmodePluginManifest(root);
  const packageDir = path.join(root, "node_modules", "@godmode");
  fs.mkdirSync(packageDir, { recursive: true });

  for (const name of HOST_LINKED_PACKAGES) {
    let resolvedPackage: string;
    try {
      resolvedPackage = path.dirname(hostRequire.resolve(`@godmode/${name}/package.json`));
    } catch {
      console.warn(`[plugins] host package @godmode/${name} not resolvable; skip link for ${root}`);
      continue;
    }
    if (!fs.existsSync(path.join(resolvedPackage, "dist", "index.js"))) continue;

    const linkPath = path.resolve(packageDir, name);
    if (!linkPath.startsWith(packageDir + path.sep)) {
      throw new Error(`Unsafe plugin host link path: ${linkPath}`);
    }
    try {
      fs.lstatSync(linkPath);
      if (fs.realpathSync(linkPath) === fs.realpathSync(resolvedPackage)) continue;
      fs.rmSync(linkPath, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        fs.rmSync(linkPath, { recursive: true, force: true });
      }
    }

    const type = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(resolvedPackage, linkPath, type);
  }
}

function syncPluginKnowledgeForTenant(
  tenantId: string,
  pluginId: string,
  pluginRoot: string
): void {
  const { rules, skills } = importPluginKnowledgeFromRoot(
    getTenantDb(tenantId),
    pluginRoot,
    pluginId
  );
  if (rules > 0 || skills > 0) {
    console.log(
      `[plugins] imported knowledge for ${pluginId} on tenant ${tenantId}: ${rules} rules, ${skills} skills`
    );
  }
}

export async function installPluginForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string,
  pluginRoot?: string
): Promise<void> {
  const loaded = pluginRuntime.getPlugin(pluginId);
  if (!loaded) throw new Error(`Plugin not loaded: ${pluginId}`);
  const root = path.resolve(pluginRoot ?? loaded.pluginRoot);
  registerPluginObjectTypes(loaded.manifest);
  ensureTenantPluginsStorage(core);
  core
    .prepare(
      `INSERT INTO tenant_plugins
       (tenant_id, plugin_id, version, plugin_root, state, desired_state, last_error, updated_at)
       VALUES (?, ?, ?, ?, 'installing', 'active', NULL, datetime('now'))
       ON CONFLICT(tenant_id, plugin_id) DO UPDATE SET
         version=excluded.version, plugin_root=excluded.plugin_root,
         state='installing', desired_state='active', last_error=NULL,
         installed_at=datetime('now'),
         updated_at=datetime('now')`
    )
    .run(tenantId, pluginId, loaded.manifest.version, root);
  try {
    applyPluginObjectTypeSeeds(getTenantDb(tenantId), loaded.manifest);
    await pluginRuntime.installPluginForTenant(pluginId, tenantId);
    syncPluginKnowledgeForTenant(tenantId, pluginId, root);
    core
      .prepare(
        `UPDATE tenant_plugins SET state='active', last_error=NULL,
         updated_at=datetime('now') WHERE tenant_id=? AND plugin_id=?`
      )
      .run(tenantId, pluginId);
  } catch (error) {
    try {
      removePluginKnowledge(getTenantDb(tenantId), pluginId);
      await pluginRuntime.uninstallPluginForTenant(pluginId, tenantId);
    } catch {
      // Restart reconciliation retries compensation from the failed durable state.
    }
    core
      .prepare(
        `UPDATE tenant_plugins SET state='failed', last_error=?,
         updated_at=datetime('now') WHERE tenant_id=? AND plugin_id=?`
      )
      .run(error instanceof Error ? error.message : String(error), tenantId, pluginId);
    throw error;
  }
}

export async function uninstallPluginForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginId: string
): Promise<void> {
  const existing = core
    .prepare(`SELECT 1 FROM tenant_plugins WHERE tenant_id=? AND plugin_id=?`)
    .get(tenantId, pluginId);
  if (!existing) throw Object.assign(new Error("Plugin installation not found"), { status: 404 });
  core
    .prepare(
      `UPDATE tenant_plugins SET state='uninstalling', desired_state='absent', last_error=NULL,
       updated_at=datetime('now') WHERE tenant_id=? AND plugin_id=?`
    )
    .run(tenantId, pluginId);
  try {
    removePluginKnowledge(getTenantDb(tenantId), pluginId);
    await pluginRuntime.uninstallPluginForTenant(pluginId, tenantId);
    core.prepare(`DELETE FROM tenant_plugins WHERE tenant_id=? AND plugin_id=?`).run(
      tenantId,
      pluginId
    );
  } catch (error) {
    core
      .prepare(
        `UPDATE tenant_plugins SET state='failed', last_error=?,
         updated_at=datetime('now') WHERE tenant_id=? AND plugin_id=?`
      )
      .run(error instanceof Error ? error.message : String(error), tenantId, pluginId);
    throw error;
  }
  if (!core.prepare(`SELECT 1 FROM tenant_plugins WHERE plugin_id=? LIMIT 1`).get(pluginId)) {
    unregisterObjectTypesByPlugin(pluginId);
  }
}

export async function activatePluginForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginRoot: string,
  opts: { buildIfNeeded?: boolean; installForTenant?: boolean; reload?: boolean } = {}
): Promise<ActivatePluginResult> {
  const resolved = path.resolve(pluginRoot);
  readGodmodePluginManifest(resolved);
  const built = opts.buildIfNeeded === false ? false : await ensurePluginBuilt(resolved);
  prepareHostPackageLinks(resolved);
  const load = await loadPluginFromRoot(resolved, { reload: opts.reload });
  persistPluginPath(core, resolved);
  if (opts.installForTenant !== false) {
    await installPluginForTenant(core, tenantId, load.pluginId, resolved);
  }
  return {
    pluginId: load.pluginId,
    pluginRoot: resolved,
    installed: opts.installForTenant !== false,
    built,
    reloaded: load.reloaded,
  };
}

export async function loadPluginsForBoot(): Promise<LoadPluginsResult> {
  const loaded: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  for (const pluginRoot of discoverPluginRoots()) {
    try {
      prepareHostPackageLinks(pluginRoot);
      const result = await loadPluginFromRoot(pluginRoot, { reload: false });
      loaded.push(result.pluginId);
    } catch (error) {
      errors.push({
        path: pluginRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { loaded, errors };
}

export async function reconcilePluginLifecycle(
  core: CoreDatabase,
  operatorTenantId: string,
  operatorDb: AppDatabase
): Promise<void> {
  ensureTenantPluginsStorage(core);
  for (const plugin of pluginRuntime.loaded) {
    const row = core
      .prepare(
        `SELECT state, desired_state FROM tenant_plugins WHERE tenant_id=? AND plugin_id=?`
      )
      .get(operatorTenantId, plugin.manifest.id) as
      | { state: string; desired_state: string }
      | undefined;
    if (!row) {
      const hasExistingStructure = (plugin.manifest.departments ?? []).some((departmentId) =>
        Boolean(operatorDb.prepare(`SELECT 1 FROM structure_nodes WHERE id=?`).get(departmentId))
      );
      if (hasExistingStructure) {
        core
          .prepare(
            `INSERT INTO tenant_plugins
             (tenant_id, plugin_id, version, plugin_root, state, desired_state, updated_at)
             VALUES (?, ?, ?, ?, 'active', 'active', datetime('now'))`
          )
          .run(
            operatorTenantId,
            plugin.manifest.id,
            plugin.manifest.version,
            plugin.pluginRoot
          );
      } else {
        await installPluginForTenant(
          core,
          operatorTenantId,
          plugin.manifest.id,
          plugin.pluginRoot
        );
      }
    } else if (row.state !== "active" && row.desired_state !== "absent") {
      await installPluginForTenant(
        core,
        operatorTenantId,
        plugin.manifest.id,
        plugin.pluginRoot
      );
    }
  }

  const interrupted = core
    .prepare(
      `SELECT tenant_id, plugin_id, desired_state FROM tenant_plugins
       WHERE state<>'active' ORDER BY tenant_id, plugin_id`
    )
    .all() as Array<{
      tenant_id: string;
      plugin_id: string;
      desired_state: "active" | "absent";
    }>;
  for (const row of interrupted) {
    try {
      if (row.desired_state === "absent") {
        await uninstallPluginForTenant(core, row.tenant_id, row.plugin_id);
      } else if (pluginRuntime.hasPlugin(row.plugin_id)) {
        await installPluginForTenant(core, row.tenant_id, row.plugin_id);
      }
    } catch (error) {
      console.warn(
        `[plugins] lifecycle reconciliation failed for ${row.tenant_id}/${row.plugin_id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const rows = core
    .prepare(
      `SELECT tenant_id, plugin_id, plugin_root FROM tenant_plugins
       WHERE state='active' ORDER BY tenant_id, plugin_id`
    )
    .all() as Array<{ tenant_id: string; plugin_id: string; plugin_root: string | null }>;
  for (const row of rows) {
    const loaded = pluginRuntime.getPlugin(row.plugin_id);
    if (!loaded) continue;
    registerPluginObjectTypes(loaded.manifest);
    applyPluginObjectTypeSeeds(getTenantDb(row.tenant_id), loaded.manifest);
    syncPluginKnowledgeForTenant(
      row.tenant_id,
      row.plugin_id,
      row.plugin_root ?? loaded.pluginRoot
    );
  }
}

export function syncInstalledPluginKnowledge(core: CoreDatabase, tenantId: string): void {
  for (const row of listInstalledPlugins(core, tenantId)) {
    const root = row.plugin_root ?? pluginRuntime.getPlugin(row.plugin_id)?.pluginRoot;
    if (root) syncPluginKnowledgeForTenant(tenantId, row.plugin_id, root);
  }
}
