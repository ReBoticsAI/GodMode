import type { GodmodePluginManifest } from "@godmode/plugin-api";
import type { AppDatabase } from "../db.js";
import {
  createSystemOperationContext,
  ensureObjectTypeStorage,
  seedRecords,
} from "./record-api.js";
import { replaceObjectTypesByPlugin } from "./registry.js";
import { registerPageKinds } from "../kernel/kind-registry.js";

/** Register ObjectTypes from a plugin manifest (idempotent overwrite by name). */
export function registerPluginObjectTypes(manifest: GodmodePluginManifest): void {
  // Executable plugins register adapter-backed definitions through
  // api.objectTypes.register(). A manifest with no declarative ObjectTypes must
  // not erase those live registrations during lifecycle reconciliation.
  if (manifest.objectTypes === undefined) return;
  const defs = (manifest.objectTypes ?? []).map((ot) => ({
    ...ot,
    pluginId: ot.pluginId ?? manifest.id,
  }));
  replaceObjectTypesByPlugin(manifest.id, defs);
  for (const ot of defs) {
    // Collect Select options that look like page kinds from Structure seeds — no-op for most.
    if (ot.name === "StructureNode") {
      const kindField = ot.fields.find((f) => f.name === "kind");
      if (kindField?.options?.length) registerPageKinds(kindField.options);
    }
  }
}

/** Materialize native tables + apply declarative Record seeds for a tenant. */
export function applyPluginObjectTypeSeeds(
  db: AppDatabase,
  manifest: GodmodePluginManifest
): void {
  for (const ot of manifest.objectTypes ?? []) {
    ensureObjectTypeStorage(db, ot);
  }
  if (manifest.records?.length) {
    seedRecords(db, manifest.records, createSystemOperationContext());
  }
}
