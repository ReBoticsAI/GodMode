import type { GodmodePluginManifest } from "@godmode/plugin-api";
import { PluginLoopError } from "./plugin-loop-error.js";

/**
 * Fail closed: plugins must not materialize native ObjectType tables on the
 * workspace tenant DB unless they opt into core-records (personal-OS entities).
 */
export function assertPluginDataPlane(manifest: GodmodePluginManifest): void {
  const plane = manifest.dataPlane ?? "domain";
  if (plane === "core-records") return;
  const natives = (manifest.objectTypes ?? []).filter(
    (ot) => !ot.storage || ot.storage.kind === "native"
  );
  if (!natives.length) return;
  const names = natives.map((ot) => ot.name).join(", ");
  throw new PluginLoopError(
    "manifest",
    `Plugin "${manifest.id}" declares native ObjectType(s) on the workspace DB (${names}). ` +
      `Plugin business data must use host.openPluginDb (dataPlane "domain") or ObjectType adapters that façade into plugin SQLite. ` +
      `Only true Core personal-OS entities may set dataPlane: "core-records".`
  );
}

export function pluginHasNativeObjectTypes(
  manifest: GodmodePluginManifest
): boolean {
  return (manifest.objectTypes ?? []).some(
    (ot) => !ot.storage || ot.storage.kind === "native"
  );
}
