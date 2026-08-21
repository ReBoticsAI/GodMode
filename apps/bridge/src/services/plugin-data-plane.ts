import type { GodmodePluginManifest } from "@godmode/plugin-api";
import { PluginLoopError } from "./plugin-loop-error.js";

/**
 * Fail closed: plugins must not materialize native ObjectType tables on the
 * workspace tenant DB unless they came from the records scaffold
 * (`scaffoldTemplate: "records"` + `dataPlane: "core-records"`).
 *
 * Setting only `dataPlane: "core-records"` is not enough (Cloud dogfood loophole).
 */
export function assertPluginDataPlane(manifest: GodmodePluginManifest): void {
  const natives = (manifest.objectTypes ?? []).filter(
    (ot) => !ot.storage || ot.storage.kind === "native"
  );
  if (!natives.length) return;

  const plane = manifest.dataPlane ?? "domain";
  const scaffold = manifest.scaffoldTemplate;
  const allowed =
    plane === "core-records" && scaffold === "records";
  if (allowed) return;

  const names = natives.map((ot) => ot.name).join(", ");
  throw new PluginLoopError(
    "manifest",
    `Plugin "${manifest.id}" declares native ObjectType(s) on the workspace DB (${names}). ` +
      `Plugin business data must use host.openPluginDb via scaffold_plugin template "domain" ` +
      `(or ObjectType adapters that façade into plugin SQLite). ` +
      `Do not set dataPlane: "core-records" to bypass this. ` +
      `Native workspace tables are only for scaffold_plugin template "records" ` +
      `(scaffoldTemplate: "records" and dataPlane: "core-records").`
  );
}

export function pluginHasNativeObjectTypes(
  manifest: GodmodePluginManifest
): boolean {
  return (manifest.objectTypes ?? []).some(
    (ot) => !ot.storage || ot.storage.kind === "native"
  );
}
