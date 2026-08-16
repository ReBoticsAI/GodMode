import { api, withActiveTenantQuery } from "@/api";
import { webPluginRuntime } from "./runtime.js";

interface PluginManifestLoaded {
  id: string;
  version: string;
  name: string;
  webBundle?: string;
  /** Bundle mtime from Bridge; changes on rebuild even when package version does not. */
  webRevision?: string;
}

interface PluginManifestResponse {
  plugins: Array<{ id: string; version: string; name: string }>;
  loaded: PluginManifestLoaded[];
}

type ImportShimFn = ((url: string) => Promise<unknown>) & {
  addImportMap?: (map: { imports?: Record<string, string> }) => Promise<void>;
};

function importShim(): ImportShimFn | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { importShim?: ImportShimFn }).importShim ?? null;
}

async function applyPluginImportMap(additions: Record<string, string>): Promise<void> {
  if (Object.keys(additions).length === 0) return;
  const shim = importShim();
  if (shim?.addImportMap) {
    await shim.addImportMap({ imports: additions });
    return;
  }
  // Production nginx CSP blocks inline import maps (script-src without matching
  // sha256). Host shims already cover react / web-host; skip extras rather than
  // spam CSP violations. Dev keeps the inline map for Vite plugin packages.
  if (import.meta.env.PROD) {
    console.warn(
      "[plugins] extra import map skipped under CSP; load es-module-shims for plugin package imports"
    );
    return;
  }
  const script = document.createElement("script");
  script.type = "importmap";
  script.setAttribute("data-godmode-plugin-importmap", "true");
  script.textContent = JSON.stringify({ imports: additions });
  document.head.appendChild(script);
}

async function dynamicImportModule(url: string): Promise<unknown> {
  const shim = importShim();
  // Vite dev rewrites dynamic import() to ?import=… which breaks /api/plugins/* module loads.
  if (import.meta.env.DEV && shim) {
    return shim(url);
  }
  try {
    return await import(/* @vite-ignore */ url);
  } catch (firstErr) {
    if (shim) {
      try {
        return await shim(url);
      } catch {
        throw firstErr;
      }
    }
    throw firstErr;
  }
}

function cacheBustedBundleUrl(id: string, meta: PluginManifestLoaded): string {
  const base = meta.webBundle ?? `/api/plugins/${id}/web.js`;
  const withTenant = withActiveTenantQuery(base);
  const sep = withTenant.includes("?") ? "&" : "?";
  const rev = meta.webRevision || meta.version;
  return `${withTenant}${sep}v=${encodeURIComponent(rev)}`;
}

function activationKey(meta: PluginManifestLoaded): string {
  return `${meta.version}::${meta.webRevision ?? "0"}`;
}

async function importPluginWebBundle(
  id: string,
  meta: PluginManifestLoaded
): Promise<{ ok: boolean; error?: string }> {
  const url = cacheBustedBundleUrl(id, meta);
  try {
    const mod = (await dynamicImportModule(url)) as {
      default?: import("@godmode/plugin-api").GodModeWebPluginRegister;
      registerWeb?: import("@godmode/plugin-api").GodModeWebPluginRegister;
    };
    const registerFn = mod.default ?? mod.registerWeb;
    if (typeof registerFn !== "function") {
      return { ok: false, error: `Plugin ${id}: export is not a register function` };
    }
    webPluginRuntime.unregister(id);
    webPluginRuntime.register(
      { id, version: meta.version, name: meta.name },
      registerFn
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function waitForImportShim(maxMs = 5000): Promise<void> {
  if (importShim()) return;
  // es-module-shims is injected only by the Vite DEV server. Production static
  // builds never load it — waiting the full timeout caused a ~5s black screen
  // after every sign-in while AuthGatedApp blocked on pluginsReady.
  if (!import.meta.env.DEV) return;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    if (importShim()) return;
  }
}

/** Last successfully activated key (`version::webRevision`) per plugin id. */
const activatedKeys = new Map<string, string>();

function notifyPluginsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("godmode:plugins-changed"));
}

/**
 * Load (or reload) web bundles for tenant-installed plugins.
 * Reloads when version/bundle mtime changes or when `force` is set so
 * install/rebuild picks up new page kinds without a full browser refresh.
 */
export async function loadWebPlugins(opts?: {
  force?: boolean;
}): Promise<string[]> {
  await waitForImportShim();
  const errors: string[] = [];
  let loaded: PluginManifestResponse["loaded"] = [];
  try {
    const data = await api<
      PluginManifestResponse & {
        sharedImports?: Record<string, string>;
        packageImports?: Record<string, string>;
      }
    >("/plugins/manifest");
    loaded = data.loaded;
    await applyPluginImportMap(
      Object.fromEntries(
        Object.entries({
          ...(data.sharedImports ?? {}),
          ...(data.packageImports ?? {}),
        }).map(([key, url]) => [key, withActiveTenantQuery(url)])
      )
    );
  } catch {
    /* bridge not up yet or not signed in */
  }

  const activated: string[] = [];
  let changed = false;
  const desiredIds = new Set(loaded.map((m) => m.id));

  for (const id of [...activatedKeys.keys()]) {
    if (!desiredIds.has(id)) {
      webPluginRuntime.unregister(id);
      activatedKeys.delete(id);
      changed = true;
    }
  }

  for (const meta of loaded) {
    const key = activationKey(meta);
    const prev = activatedKeys.get(meta.id);
    const needsLoad = opts?.force === true || prev !== key;
    if (!needsLoad) {
      activated.push(meta.id);
      continue;
    }
    const result = await importPluginWebBundle(meta.id, meta);
    if (result.ok) {
      activatedKeys.set(meta.id, key);
      activated.push(meta.id);
      changed = true;
    } else if (result.error) {
      errors.push(`${meta.name}: ${result.error}`);
      console.error(`[plugins] failed to load ${meta.id}:`, result.error);
    }
  }

  if (errors.length > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("godmode:plugin-load-errors", { detail: { errors } })
    );
  }

  if (changed) notifyPluginsChanged();

  return activated;
}

/** Force re-fetch of every installed web bundle (install / rebuild path). */
export function reloadWebPlugins(): Promise<string[]> {
  return loadWebPlugins({ force: true });
}
