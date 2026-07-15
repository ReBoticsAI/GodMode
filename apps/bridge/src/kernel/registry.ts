import type { ObjectTypeDef } from "@godmode/kernel";
import {
  STRUCTURE_NODE_OBJECT_TYPE,
  validateObjectTypeDef,
} from "@godmode/kernel";
import { listPageKinds } from "./kind-registry.js";

const byName = new Map<string, ObjectTypeDef>();

function resolveRuntimeMetadata(def: ObjectTypeDef): ObjectTypeDef {
  return {
    ...def,
    fields: def.fields.map((f) =>
      f.optionsSource === "pageKinds"
        ? { ...f, fieldType: "Select" as const, options: listPageKinds() }
        : f
    ),
    actions: def.actions?.map((action) =>
      action.execution === "async" && action.cancellable == null
        ? { ...action, cancellable: false }
        : action
    ),
  };
}

export function registerObjectType(def: ObjectTypeDef): void {
  const resolved = resolveRuntimeMetadata(def);
  const errors = validateObjectTypeDef(resolved);
  if (errors.length) {
    throw new Error(`Invalid ObjectType ${def.name}: ${errors.join("; ")}`);
  }
  const existing = byName.get(def.name);
  if (existing && existing.pluginId !== def.pluginId) {
    throw new Error(
      `ObjectType ${def.name} is owned by ${existing.pluginId ?? "core"}`
    );
  }
  byName.set(def.name, resolved);
}

export function registerObjectTypes(defs: ObjectTypeDef[]): void {
  const resolvedDefs = defs.map(resolveRuntimeMetadata);
  for (const [index, def] of defs.entries()) {
    const errors = validateObjectTypeDef(resolvedDefs[index]!);
    if (errors.length) {
      throw new Error(`Invalid ObjectType ${def.name}: ${errors.join("; ")}`);
    }
    const existing = byName.get(def.name);
    if (existing && existing.pluginId !== def.pluginId) {
      throw new Error(
        `ObjectType ${def.name} is owned by ${existing.pluginId ?? "core"}`
      );
    }
  }
  for (const def of resolvedDefs) byName.set(def.name, def);
}

export function replaceObjectTypesByPlugin(
  pluginId: string,
  defs: ObjectTypeDef[]
): void {
  if (defs.some((def) => def.pluginId !== pluginId)) {
    throw new Error(`All replacement ObjectTypes must be owned by ${pluginId}`);
  }
  // Validate the complete replacement before changing the live registry.
  const resolvedDefs = defs.map(resolveRuntimeMetadata);
  for (const [index, def] of defs.entries()) {
    const errors = validateObjectTypeDef(resolvedDefs[index]!);
    if (errors.length) {
      throw new Error(`Invalid ObjectType ${def.name}: ${errors.join("; ")}`);
    }
    const existing = byName.get(def.name);
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(
        `ObjectType ${def.name} is owned by ${existing.pluginId ?? "core"}`
      );
    }
  }
  for (const [name, def] of byName) {
    if (def.pluginId === pluginId) byName.delete(name);
  }
  for (const def of resolvedDefs) byName.set(def.name, def);
}

export function unregisterObjectType(name: string): void {
  if (name === "StructureNode") return;
  byName.delete(name);
}

export function getObjectType(name: string): ObjectTypeDef | undefined {
  const def = byName.get(name);
  return def ? resolveRuntimeMetadata(def) : undefined;
}

export function listObjectTypes(): ObjectTypeDef[] {
  return [...byName.values()].map(resolveRuntimeMetadata);
}

export function unregisterObjectTypesByPlugin(pluginId: string): void {
  for (const [name, def] of byName) {
    if (def.pluginId === pluginId) byName.delete(name);
  }
}

export function hasObjectType(name: string): boolean {
  return byName.has(name);
}

/** Register built-ins. Call once at Bridge boot. */
export function bootstrapBuiltInObjectTypes(): void {
  if (!byName.has("StructureNode")) {
    registerObjectType(STRUCTURE_NODE_OBJECT_TYPE);
  }
}

bootstrapBuiltInObjectTypes();
