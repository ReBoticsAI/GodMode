import path from "node:path";
import type { CoreDatabase } from "../core-db.js";
import { loadPluginFromRoot } from "./loader.js";
import { installPluginForTenant } from "./plugin-install.js";
import { ensurePluginBuilt } from "../services/plugin-build.js";

/**
 * Persist a plugin root for boot rediscovery (Marketplace Unofficial paths).
 */
export function appendPluginPath(core: CoreDatabase, pluginRoot: string): void {
  const key = "marketplace.plugin_paths";
  const existing = core.prepare(`SELECT value FROM platform_meta WHERE key=?`).get(key) as
    | { value: string }
    | undefined;
  const paths: string[] = existing?.value ? JSON.parse(existing.value) : [];
  const resolved = path.resolve(pluginRoot);
  if (!paths.includes(resolved)) paths.push(resolved);
  core
    .prepare(
      `INSERT INTO platform_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    )
    .run(key, JSON.stringify(paths));
}

export interface ActivatePluginResult {
  pluginId: string;
  pluginRoot: string;
  installed: boolean;
  built: boolean;
  reloaded: boolean;
}

/**
 * Same pipeline as Marketplace Unofficial: optional build → persist path →
 * runtime load/reload → tenant install. No Bridge restart required for tools
 * and tenant:install hooks.
 */
export async function activatePluginForTenant(
  core: CoreDatabase,
  tenantId: string,
  pluginRoot: string,
  opts?: { buildIfNeeded?: boolean; installForTenant?: boolean; reload?: boolean }
): Promise<ActivatePluginResult> {
  const resolved = path.resolve(pluginRoot);
  let built = false;
  if (opts?.buildIfNeeded !== false) {
    built = await ensurePluginBuilt(resolved);
  }

  appendPluginPath(core, resolved);
  const load = await loadPluginFromRoot(resolved, { reload: opts?.reload });

  let installed = false;
  if (opts?.installForTenant !== false) {
    await installPluginForTenant(core, tenantId, load.pluginId, resolved);
    installed = true;
  }

  return {
    pluginId: load.pluginId,
    pluginRoot: resolved,
    installed,
    built,
    reloaded: load.reloaded,
  };
}
