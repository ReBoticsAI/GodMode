import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  readGodmodePluginManifest,
  pluginPathFromEnv,
  manifestPath,
  assertEngineCompatible,
  type GodModePluginRegister,
} from "@godmode/plugin-api";
import { getCoreDb } from "../core-db.js";
import { pluginRuntime } from "./runtime.js";

const hostRequire = createRequire(import.meta.url);

/**
 * Packages that plugin bridge bundles typically `external`ize and expect to
 * resolve from node_modules. In Docker hubs the plugin's `file:../GodMode`
 * links often break (symlink outside the bind mount / missing dist). Point
 * them at the Bridge image's built copies instead.
 */
const HOST_LINKED_PACKAGES = ["plugin-api", "plugin-host"] as const;

/**
 * Ensure `@godmode/plugin-api` and `@godmode/plugin-host` under the plugin's
 * node_modules resolve to the same builds Bridge itself uses.
 */
export function ensureHostGodmodePackageLinks(pluginRoot: string): void {
  const nmGodmode = path.join(pluginRoot, "node_modules", "@godmode");
  fs.mkdirSync(nmGodmode, { recursive: true });

  for (const name of HOST_LINKED_PACKAGES) {
    let resolvedPkg: string;
    try {
      resolvedPkg = path.dirname(hostRequire.resolve(`@godmode/${name}/package.json`));
    } catch {
      console.warn(
        `[plugins] host package @godmode/${name} not resolvable; skip link for ${pluginRoot}`
      );
      continue;
    }

    const distEntry = path.join(resolvedPkg, "dist", "index.js");
    if (!fs.existsSync(distEntry)) {
      console.warn(
        `[plugins] host package @godmode/${name} has no dist/index.js at ${distEntry}`
      );
      continue;
    }

    const linkPath = path.join(nmGodmode, name);
    try {
      if (fs.existsSync(linkPath)) {
        const real = fs.realpathSync(linkPath);
        if (real === fs.realpathSync(resolvedPkg)) continue;
        fs.rmSync(linkPath, { recursive: true, force: true });
      }
    } catch {
      try {
        fs.rmSync(linkPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    try {
      // 'junction' works for directories on Windows without admin; 'dir' symlink on POSIX.
      const type = process.platform === "win32" ? "junction" : "dir";
      fs.symlinkSync(resolvedPkg, linkPath, type);
      console.log(`[plugins] linked @godmode/${name} -> ${resolvedPkg} for ${pluginRoot}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[plugins] failed to link @godmode/${name} for ${pluginRoot}: ${msg}`);
    }
  }
}

function extraMarketplacePluginPaths(): string[] {
  try {
    const row = getCoreDb()
      .prepare(`SELECT value FROM platform_meta WHERE key=?`)
      .get("marketplace.plugin_paths") as { value: string } | undefined;
    if (!row?.value) return [];
    return (JSON.parse(row.value) as string[]).filter((p) => fs.existsSync(p));
  } catch {
    return [];
  }
}

/** Env paths and marketplace-installed plugin roots. */
export function discoverPluginRoots(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string): void => {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    if (fs.existsSync(manifestPath(resolved))) out.push(resolved);
  };

  for (const p of pluginPathFromEnv()) add(p);
  for (const p of extraMarketplacePluginPaths()) add(p);

  return out;
}

function resolveBridgeEntry(pluginRoot: string, entry: string): string {
  const candidates = [
    path.join(pluginRoot, entry),
    path.join(pluginRoot, entry.replace(/\.js$/, ".ts")),
    path.join(pluginRoot, "src/bridge/index.ts"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Plugin bridge entry not found: ${entry} in ${pluginRoot}`);
}

async function importBridgeRegister(entryPath: string): Promise<GodModePluginRegister> {
  const url = pathToFileURL(entryPath).href;
  const mod = (await import(url)) as {
    default?: GodModePluginRegister;
    register?: GodModePluginRegister;
  };
  const fn = mod.default ?? mod.register;
  if (typeof fn !== "function") {
    throw new Error(`Plugin entry must export default or register function: ${entryPath}`);
  }
  return fn;
}

export interface LoadPluginsResult {
  loaded: string[];
  errors: Array<{ path: string; error: string }>;
}

export async function loadPluginsFromEnv(): Promise<LoadPluginsResult> {
  const roots = discoverPluginRoots();
  const loaded: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const pluginRoot of roots) {
    try {
      const manifest = readGodmodePluginManifest(pluginRoot);
      assertEngineCompatible(manifest);
      if (!manifest.bridge?.entry) {
        errors.push({ path: pluginRoot, error: "manifest missing bridge.entry" });
        continue;
      }
      ensureHostGodmodePackageLinks(pluginRoot);
      const entryPath = resolveBridgeEntry(pluginRoot, manifest.bridge.entry);
      const registerFn = await importBridgeRegister(entryPath);
      await Promise.resolve(pluginRuntime.register(manifest, pluginRoot, registerFn));
      loaded.push(manifest.id);
      console.log(`[plugins] loaded ${manifest.name} (${manifest.id}) from ${pluginRoot}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ path: pluginRoot, error: msg });
      console.error(`[plugins] failed to load ${pluginRoot}:`, msg);
    }
  }

  return { loaded, errors };
}

/** Load a single plugin at runtime (e.g. after marketplace git clone). */
export async function loadPluginFromRoot(
  pluginRoot: string
): Promise<{ pluginId: string; pluginRoot: string }> {
  const manifest = readGodmodePluginManifest(pluginRoot);
  assertEngineCompatible(manifest);
  if (pluginRuntime.hasPlugin(manifest.id)) {
    return { pluginId: manifest.id, pluginRoot };
  }
  if (!manifest.bridge?.entry) {
    throw new Error("manifest missing bridge.entry");
  }
  ensureHostGodmodePackageLinks(pluginRoot);
  const entryPath = resolveBridgeEntry(pluginRoot, manifest.bridge.entry);
  const registerFn = await importBridgeRegister(entryPath);
  await Promise.resolve(pluginRuntime.register(manifest, pluginRoot, registerFn));
  console.log(`[plugins] runtime-loaded ${manifest.name} (${manifest.id}) from ${pluginRoot}`);
  return { pluginId: manifest.id, pluginRoot };
}

export function listPluginManifestsForWeb(): Array<{
  id: string;
  version: string;
  name: string;
  webEntry?: string;
}> {
  const roots = discoverPluginRoots();
  const out: Array<{ id: string; version: string; name: string; webEntry?: string }> = [];
  for (const pluginRoot of roots) {
    try {
      const m = readGodmodePluginManifest(pluginRoot);
      out.push({
        id: m.id,
        version: m.version,
        name: m.name,
        webEntry: m.web?.entry,
      });
    } catch {
      /* skip invalid */
    }
  }
  return out;
}
