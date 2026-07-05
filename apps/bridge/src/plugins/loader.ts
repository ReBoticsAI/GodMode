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
