import type { ObjectTypeDef } from "./types.js";

/**
 * Built-in ObjectType for the Structure shell tree.
 * Storage is an adapter over structure_nodes (no second copy).
 *
 * Product UX still says department / division / page — those are tree roles,
 * not separate ObjectTypes.
 */
export const STRUCTURE_NODE_OBJECT_TYPE: ObjectTypeDef = {
  name: "StructureNode",
  label: "Structure Node",
  labelPlural: "Structure Nodes",
  description:
    "Page tree node for the GodMode shell (roots = departments, children = divisions/pages). Use Record CRUD or legacy create_department/create_division/create_page wrappers.",
  storage: {
    kind: "adapter",
    adapterId: "structure_nodes",
  },
  database: "tenant",
  accessPolicy: "tenant-local",
  module: "platform",
  contractVersion: 1,
  operations: ["list", "get", "create", "update", "delete"],
  fields: [
    {
      name: "id",
      label: "Id",
      fieldType: "Data",
      required: true,
      inList: true,
      description: "Stable id (roots = slug; children = parentId-slug)",
    },
    {
      name: "parent_id",
      label: "Parent",
      fieldType: "Link",
      linkTo: "StructureNode",
      inList: true,
      inForm: true,
      description: "Null for department roots",
    },
    {
      name: "label",
      label: "Label",
      fieldType: "Data",
      required: true,
      inList: true,
    },
    {
      name: "icon",
      label: "Icon",
      fieldType: "Data",
      required: true,
      inList: true,
      description: "lucide icon slug",
    },
    {
      name: "segment",
      label: "URL segment",
      fieldType: "Data",
      inList: true,
    },
    {
      name: "kind",
      label: "Page kind",
      fieldType: "Select",
      inList: true,
      description: "Renderer kind from the Kind registry (plugins may extend)",
      optionsSource: "pageKinds",
    },
    {
      name: "object_type",
      label: "ObjectType",
      fieldType: "Data",
      description: "Explicit ObjectType rendered by record-list / record-form",
    },
    {
      name: "right_sidebar",
      label: "Right sidebar",
      fieldType: "Data",
      description: "Plugin shell slot id, or empty",
    },
    {
      name: "agent_id",
      label: "Agent",
      fieldType: "Data",
      description: "Nav auto-chat agent id",
    },
    {
      name: "built_in",
      label: "Built-in",
      fieldType: "Check",
      inForm: false,
      inList: true,
    },
    {
      name: "sort_order",
      label: "Sort order",
      fieldType: "Int",
      inForm: false,
      inList: true,
    },
    {
      name: "tabs_json",
      label: "Tabs JSON",
      fieldType: "JSON",
      inForm: false,
    },
    {
      name: "path",
      label: "Path",
      fieldType: "ReadOnly",
      inList: true,
      inForm: false,
      description: "Derived URL path",
    },
  ],
  permissions: [
    { role: "viewer", read: true },
    { role: "editor", read: true, create: true, update: true },
    { role: "owner", read: true, create: true, update: true, delete: true },
    {
      role: "intelligence",
      read: true,
      create: true,
      update: true,
      delete: true,
    },
  ],
  actions: [
    {
      name: "set_agent",
      label: "Set Agent",
      target: "record",
      effect: "write",
      execution: "sync",
      roles: ["editor", "owner", "intelligence"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { agent_id: { type: ["string", "null"] } },
        required: ["agent_id"],
      },
    },
    {
      name: "move",
      label: "Move",
      target: "record",
      effect: "write",
      execution: "sync",
      roles: ["editor", "owner", "intelligence"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { parent_id: { type: ["string", "null"] } },
        required: ["parent_id"],
      },
    },
    {
      name: "reorder",
      label: "Reorder",
      target: "collection",
      effect: "write",
      execution: "sync",
      roles: ["editor", "owner", "intelligence"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          parent_id: { type: ["string", "null"] },
          ordered_ids: { type: "array", items: { type: "string" } },
        },
        required: ["ordered_ids"],
      },
    },
    {
      name: "save_layout",
      label: "Save Graph Layout",
      target: "collection",
      effect: "write",
      execution: "sync",
      roles: ["editor", "owner", "intelligence"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { layout: { type: "object" } },
        required: ["layout"],
      },
    },
  ],
};
