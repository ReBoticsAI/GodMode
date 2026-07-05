import { api } from "@/api";
import { webPluginRuntime } from "./runtime.js";

interface PluginManifestResponse {
  plugins: Array<{ id: string; version: string; name: string }>;
  loaded: Array<{ id: string; version: string; name: string; webBundle?: string }>;
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

async function importPluginWebBundle(
  id: string,
  meta: { version: string; name: string; webBundle?: string }
): Promise<{ ok: boolean; error?: string }> {
  const url = meta.webBundle ?? `/api/plugins/${id}/web.js`;
  try {
    const mod = (await dynamicImportModule(url)) as {
      default?: import("@godmode/plugin-api").GodModeWebPluginRegister;
      registerWeb?: import("@godmode/plugin-api").GodModeWebPluginRegister;
    };
    const registerFn = mod.default ?? mod.registerWeb;
    if (typeof registerFn !== "function") {
      return { ok: false, error: `Plugin ${id}: export is not a register function` };
    }
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
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    if (importShim()) return;
  }
}

const activatedPluginIds = new Set<string>();

export async function loadWebPlugins(): Promise<string[]> {
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
    await applyPluginImportMap({
      ...(data.sharedImports ?? {}),
      ...(data.packageImports ?? {}),
    });
  } catch {
    /* bridge not up yet or not signed in */
  }

  const activated: string[] = [];

  for (const meta of loaded) {
    if (activatedPluginIds.has(meta.id)) {
      activated.push(meta.id);
      continue;
    }
    const result = await importPluginWebBundle(meta.id, meta);
    if (result.ok) {
      activatedPluginIds.add(meta.id);
      activated.push(meta.id);
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

  return activated;
}
