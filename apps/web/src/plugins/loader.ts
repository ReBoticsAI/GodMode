import { webPluginRuntime } from "./runtime.js";

interface PluginManifestResponse {
  plugins: Array<{ id: string; version: string; name: string }>;
  loaded: Array<{ id: string; version: string; name: string; webBundle?: string }>;
}

async function importPluginWebBundle(
  id: string,
  meta: { version: string; name: string; webBundle?: string }
): Promise<{ ok: boolean; error?: string }> {
  const url = meta.webBundle ?? `/api/plugins/${id}/web.js`;
  try {
    const mod = (await import(/* @vite-ignore */ url)) as {
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

export async function loadWebPlugins(): Promise<string[]> {
  const errors: string[] = [];
  let loaded: PluginManifestResponse["loaded"] = [];
  try {
    const res = await fetch("/api/plugins/manifest", { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as PluginManifestResponse;
      loaded = data.loaded;
    }
  } catch {
    /* bridge not up yet */
  }

  const activated: string[] = [];

  for (const meta of loaded) {
    const result = await importPluginWebBundle(meta.id, meta);
    if (result.ok) {
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
