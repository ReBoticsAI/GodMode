import fs from "node:fs";
import path from "node:path";
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
import { registerPluginObjectTypes } from "../kernel/plugin-object-types.js";
import {
  listObjectTypes,
  replaceObjectTypesByPlugin,
} from "../kernel/registry.js";

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

async function importBridgeRegister(
  entryPath: string,
  cacheBust?: boolean
): Promise<GodModePluginRegister> {
  let url = pathToFileURL(entryPath).href;
  if (cacheBust) {
    url += `${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }
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

/**
 * Load a single plugin at runtime (Marketplace / Intelligence).
 * If already loaded, unregister and re-import with a cache-bust so rebuilds apply.
 */
export async function loadPluginFromRoot(
  pluginRoot: string,
  opts?: { reload?: boolean }
): Promise<{ pluginId: string; pluginRoot: string; reloaded: boolean }> {
  const manifest = readGodmodePluginManifest(pluginRoot);
  assertEngineCompatible(manifest);
  const already = pluginRuntime.hasPlugin(manifest.id);
  const shouldReload = already && opts?.reload !== false;
  if (already && !shouldReload) {
    return { pluginId: manifest.id, pluginRoot, reloaded: false };
  }
  const previousDefs = listObjectTypes().filter(
    (def) => def.pluginId === manifest.id
  );
  registerPluginObjectTypes(manifest);
  if (!manifest.bridge?.entry) {
    if ((manifest.objectTypes?.length ?? 0) > 0 || (manifest.records?.length ?? 0) > 0) {
      pluginRuntime.registerManifestOnly(manifest, pluginRoot);
      console.log(
        `[plugins] registered ObjectTypes for ${manifest.name} (${manifest.id}) from ${pluginRoot}`
      );
      return { pluginId: manifest.id, pluginRoot, reloaded: false };
    }
    throw new Error("manifest missing bridge.entry");
  }

  try {
    const entryPath = resolveBridgeEntry(pluginRoot, manifest.bridge.entry);
    const registerFn = await importBridgeRegister(entryPath, already);
    if (already) {
      pluginRuntime.unregister(manifest.id);
    }
    await Promise.resolve(pluginRuntime.register(manifest, pluginRoot, registerFn));
  } catch (error) {
    replaceObjectTypesByPlugin(manifest.id, previousDefs);
    throw error;
  }
  console.log(
    `[plugins] runtime-${already ? "reloaded" : "loaded"} ${manifest.name} (${manifest.id}) from ${pluginRoot}`
  );
  return { pluginId: manifest.id, pluginRoot, reloaded: already };
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
