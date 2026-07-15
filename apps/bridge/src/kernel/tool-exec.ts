import type { AppDatabase } from "../db.js";
import { perObjectTypeToolNames } from "@godmode/kernel";
import { listObjectTypes } from "./registry.js";
import type { OperationContext, RecordQuery } from "./adapter-registry.js";
import { listVisibleObjectTypes } from "./record-api.js";
import {
  createRecord,
  deleteRecord,
  executeCollectionAction,
  executeRecordAction,
  getRecord,
  KernelError,
  listRecords,
  updateRecord,
} from "./record-api.js";

function asData(args: Record<string, unknown>): Record<string, unknown> {
  const { data, ...rest } = args;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>) };
  }
  const { id: _id, objectType: _ot, ...fields } = rest;
  return fields;
}

function asQuery(args: Record<string, unknown>): RecordQuery {
  const parentId =
    args.parent_id === undefined
      ? undefined
      : args.parent_id == null || args.parent_id === ""
        ? null
        : String(args.parent_id);
  return {
    parentId,
    limit: args.limit != null ? Number(args.limit) : undefined,
    offset: args.offset != null ? Number(args.offset) : undefined,
    filters:
      args.filters && typeof args.filters === "object" && !Array.isArray(args.filters)
        ? (args.filters as Record<string, unknown>)
        : undefined,
    sort: typeof args.sort === "string" ? args.sort : undefined,
    direction:
      args.direction === "asc" || args.direction === "desc"
        ? args.direction
        : undefined,
  };
}

export function executeKernelTool(
  db: AppDatabase,
  name: string,
  args: Record<string, unknown>,
  ctx: OperationContext
): unknown | Promise<unknown> | undefined {
  if (name === "list_object_types") {
    return {
      objectTypes: listVisibleObjectTypes(ctx).map((d) => ({
        name: d.name,
        label: d.label,
        labelPlural: d.labelPlural,
        description: d.description,
        storage: d.storage,
        module: d.module,
        pluginId: d.pluginId,
        contractVersion: d.contractVersion,
        operations: d.operations,
        actions: d.actions,
        fields: d.fields.map((f) => ({
          name: f.name,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
        })),
      })),
    };
  }

  if (name === "list_records") {
    const objectType = String(args.objectType ?? "");
    return listRecords(db, objectType, asQuery(args), ctx);
  }

  if (name === "get_record") {
    return getRecord(db, String(args.objectType ?? ""), String(args.id ?? ""), ctx);
  }

  if (name === "create_record") {
    return createRecord(db, String(args.objectType ?? ""), asData(args), ctx);
  }

  if (name === "update_record") {
    return updateRecord(
      db,
      String(args.objectType ?? ""),
      String(args.id ?? ""),
      asData(args),
      ctx
    );
  }

  if (name === "delete_record") {
    deleteRecord(db, String(args.objectType ?? ""), String(args.id ?? ""), ctx);
    return { ok: true };
  }

  if (name === "run_record_action") {
    const objectType = String(args.objectType ?? "");
    const actionName = String(args.action ?? "");
    const def = listVisibleObjectTypes(ctx).find((item) => item.name === objectType);
    const action = def?.actions?.find((item) => item.name === actionName);
    const input =
      args.input && typeof args.input === "object" && !Array.isArray(args.input)
        ? (args.input as Record<string, unknown>)
        : {};
    return action?.target === "collection"
      ? executeCollectionAction(db, objectType, actionName, input, ctx)
      : executeRecordAction(
          db,
          objectType,
          String(args.id ?? ""),
          actionName,
          input,
          ctx
        );
  }

  for (const def of listVisibleObjectTypes(ctx)) {
    const names = perObjectTypeToolNames(def.name);
    if (name === names.list) {
      return listRecords(db, def.name, asQuery(args), ctx);
    }
    if (name === names.get) {
      return getRecord(db, def.name, String(args.id ?? ""), ctx);
    }
    if (name === names.create) {
      return createRecord(db, def.name, asData(args), ctx);
    }
    if (name === names.update) {
      return updateRecord(db, def.name, String(args.id ?? ""), asData(args), ctx);
    }
    if (name === names.delete) {
      deleteRecord(db, def.name, String(args.id ?? ""), ctx);
      return { ok: true };
    }
    for (const action of def.actions ?? []) {
      const base = def.name
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase();
      if (name !== `${base}_${action.name}`) continue;
      const { id: rawId, ...input } = args;
      return action.target === "collection"
        ? executeCollectionAction(db, def.name, action.name, input, ctx)
        : executeRecordAction(
            db,
            def.name,
            String(rawId ?? ""),
            action.name,
            input,
            ctx
          );
    }
  }

  return undefined;
}

export function isKernelToolName(name: string): boolean {
  if (
    [
      "list_object_types",
      "list_records",
      "get_record",
      "create_record",
      "update_record",
      "delete_record",
      "run_record_action",
    ].includes(name)
  ) {
    return true;
  }
  for (const def of listObjectTypes()) {
    const names = perObjectTypeToolNames(def.name);
    if (Object.values(names).includes(name)) return true;
    const base = def.name
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
    if (def.actions?.some((action) => `${base}_${action.name}` === name)) {
      return true;
    }
  }
  return false;
}

export function objectTypeForKernelTool(
  name: string,
  args: Record<string, unknown>
): string | undefined {
  if (
    [
      "list_records",
      "get_record",
      "create_record",
      "update_record",
      "delete_record",
      "run_record_action",
    ].includes(name)
  ) {
    return args.objectType != null ? String(args.objectType) : undefined;
  }
  for (const def of listObjectTypes()) {
    if (Object.values(perObjectTypeToolNames(def.name)).includes(name)) {
      return def.name;
    }
    const base = def.name
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
    if (def.actions?.some((action) => `${base}_${action.name}` === name)) {
      return def.name;
    }
  }
  return undefined;
}

export { KernelError };
