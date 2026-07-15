import type { ObjectTypeDef } from "@godmode/kernel";
import { fieldsToJsonSchema, perObjectTypeToolNames } from "@godmode/kernel";
import { listObjectTypes } from "./registry.js";

/** Tool shape matches AiToolDef without importing the registry (avoids cycles). */
export interface KernelToolDef {
  name: string;
  description: string;
  mode: "auto" | "confirm";
  parameters?: Record<string, unknown>;
  category?: string;
  write?: boolean;
}

const GENERIC_OBJECT_TYPE_TOOLS: KernelToolDef[] = [
  {
    name: "list_object_types",
    description:
      "List registered ObjectTypes (metadata definitions). Prefer these over inventing schemas. Vocabulary: ObjectType / Field / Record — not DocType.",
    mode: "auto",
    category: "platform",
  },
  {
    name: "list_records",
    description:
      "List Records for an ObjectType. For StructureNode, returns the shell page tree rows.",
    mode: "auto",
    category: "platform",
    parameters: {
      type: "object",
      properties: {
        objectType: {
          type: "string",
          description: "ObjectType name (e.g. StructureNode)",
        },
        parent_id: {
          type: "string",
          description: "Optional parent filter for tree types",
        },
        limit: { type: "integer" },
        offset: { type: "integer" },
        filters: { type: "object", additionalProperties: true },
        sort: { type: "string" },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
      required: ["objectType"],
    },
  },
  {
    name: "get_record",
    description: "Get one Record by ObjectType + id.",
    mode: "auto",
    category: "platform",
    parameters: {
      type: "object",
      properties: {
        objectType: { type: "string" },
        id: { type: "string" },
      },
      required: ["objectType", "id"],
    },
  },
  {
    name: "create_record",
    description:
      "Create a Record for an ObjectType. StructureNode: pass parent_id null for a department root. Requires confirmation.",
    mode: "confirm",
    category: "platform",
    parameters: {
      type: "object",
      properties: {
        objectType: { type: "string" },
        data: {
          type: "object",
          description: "Field values for the ObjectType",
          additionalProperties: true,
        },
      },
      required: ["objectType", "data"],
    },
  },
  {
    name: "update_record",
    description: "Update a Record by ObjectType + id. Requires confirmation.",
    mode: "confirm",
    category: "platform",
    parameters: {
      type: "object",
      properties: {
        objectType: { type: "string" },
        id: { type: "string" },
        data: { type: "object", additionalProperties: true },
      },
      required: ["objectType", "id", "data"],
    },
  },
  {
    name: "delete_record",
    description: "Delete a Record by ObjectType + id. Requires confirmation.",
    mode: "confirm",
    category: "platform",
    parameters: {
      type: "object",
      properties: {
        objectType: { type: "string" },
        id: { type: "string" },
      },
      required: ["objectType", "id"],
    },
  },
  {
    name: "run_record_action",
    description:
      "Run an explicit adapter action declared by an ObjectType (for example a move, approval, or transition). Requires confirmation.",
    mode: "confirm",
    category: "platform",
    parameters: {
      type: "object",
      properties: {
        objectType: { type: "string" },
        id: { type: "string" },
        action: { type: "string" },
        input: { type: "object", additionalProperties: true },
      },
      required: ["objectType", "action"],
    },
  },
];

/** Core ObjectType tools always registered (not derived per type). */
export function genericObjectTypeToolDefs(): KernelToolDef[] {
  return GENERIC_OBJECT_TYPE_TOOLS;
}

function perTypeTools(def: ObjectTypeDef, existingNames: Set<string>): KernelToolDef[] {
  const names = perObjectTypeToolNames(def.name);
  const out: KernelToolDef[] = [];
  const createSchema = fieldsToJsonSchema(def.fields, { mode: "create", includeId: true });
  const updateSchema = fieldsToJsonSchema(def.fields, { mode: "update" });
  const listSchema = fieldsToJsonSchema(def.fields, { mode: "list" });

  if (def.operations?.includes("list") && !existingNames.has(names.list)) {
    out.push({
      name: names.list,
      description: `List ${def.labelPlural ?? def.label} Records (ObjectType ${def.name}).`,
      mode: "auto",
      category: "platform",
      parameters: listSchema,
    });
  }
  if (def.operations?.includes("get") && !existingNames.has(names.get)) {
    out.push({
      name: names.get,
      description: `Get one ${def.label} Record by id.`,
      mode: "auto",
      category: "platform",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    });
  }
  if (def.operations?.includes("create") && !existingNames.has(names.create)) {
    out.push({
      name: names.create,
      description: `Create a ${def.label} Record. Requires confirmation.`,
      mode: "confirm",
      category: "platform",
      parameters: createSchema,
    });
  }
  if (def.operations?.includes("update") && !existingNames.has(names.update)) {
    out.push({
      name: names.update,
      description: `Update a ${def.label} Record. Requires confirmation.`,
      mode: "confirm",
      category: "platform",
      parameters: updateSchema,
    });
  }
  if (def.operations?.includes("delete") && !existingNames.has(names.delete)) {
    out.push({
      name: names.delete,
      description: `Delete a ${def.label} Record. Requires confirmation.`,
      mode: "confirm",
      category: "platform",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    });
  }
  const base = def.name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  for (const action of def.actions ?? []) {
    const toolName = `${base}_${action.name}`;
    if (existingNames.has(toolName)) continue;
    const input = action.inputSchema ?? {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    const properties = {
      ...(input.properties && typeof input.properties === "object"
        ? (input.properties as Record<string, unknown>)
        : {}),
      ...(action.target === "collection"
        ? {}
        : { id: { type: "string", description: `${def.label} record id` } }),
    };
    const required = new Set(
      Array.isArray(input.required)
        ? input.required.filter((item): item is string => typeof item === "string")
        : []
    );
    if (action.target !== "collection") required.add("id");
    out.push({
      name: toolName,
      description:
        action.description ??
        `${action.label} for ${def.label}.`,
      mode:
        action.confirmation?.required || action.confirm
          ? "confirm"
          : "auto",
      category: "platform",
      write: action.effect !== "read",
      parameters: {
        ...input,
        type: "object",
        properties,
        required: required.size ? [...required] : undefined,
      },
    });
  }
  return out;
}

/**
 * Per-ObjectType CRUD tools. Skips names already present in the static registry
 * (e.g. StructureNode skips update_structure_node / delete_structure_node).
 */
export function objectTypeAutoToolDefs(existingCoreNames: Set<string>): KernelToolDef[] {
  const out: KernelToolDef[] = [];
  const used = new Set(existingCoreNames);
  // Plugin ObjectTypes use the generic Record tools. Per-type tools would leak
  // their presence because the legacy tool registry is not tenant-aware.
  for (const def of listObjectTypes().filter((item) => !item.pluginId)) {
    const generated = perTypeTools(def, used);
    for (const tool of generated) {
      if (used.has(tool.name)) {
        throw new Error(`Generated ObjectType tool collision: ${tool.name}`);
      }
      used.add(tool.name);
      out.push(tool);
    }
  }
  return out;
}

export function allKernelToolDefs(existingCoreNames: Set<string>): KernelToolDef[] {
  return [...genericObjectTypeToolDefs(), ...objectTypeAutoToolDefs(existingCoreNames)];
}

export const KERNEL_GENERIC_TOOL_NAMES = new Set(
  GENERIC_OBJECT_TYPE_TOOLS.map((t) => t.name)
);
