import type { FieldDef, FieldType, ObjectTypeDef } from "./types.js";

const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const FIELD_RE = /^[a-z][a-z0-9_]*$/;
const ROLES = new Set(["viewer", "editor", "owner", "intelligence"]);
const ACTION_TARGETS = new Set(["record", "collection"]);
const ACTION_EFFECTS = new Set(["read", "write", "destructive", "external"]);
const ACTION_EXECUTIONS = new Set(["sync", "async"]);

function isSchema(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function objectTypeToSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

export function defaultNativeTableName(objectTypeName: string): string {
  return `gm_ot_${objectTypeToSnake(objectTypeName)}`;
}

export function validateObjectTypeDef(def: ObjectTypeDef): string[] {
  const errors: string[] = [];
  if (!NAME_RE.test(def.name)) {
    errors.push(`ObjectType name must be PascalCase (got ${def.name})`);
  }
  if (!def.label?.trim()) errors.push("label required");
  if (!def.fields?.length) errors.push("at least one field required");
  const seen = new Set<string>();
  for (const f of def.fields ?? []) {
    if (!FIELD_RE.test(f.name)) {
      errors.push(`field name must be snake_case: ${f.name}`);
    }
    if (seen.has(f.name)) errors.push(`duplicate field: ${f.name}`);
    seen.add(f.name);
    if (
      f.fieldType === "Select" &&
      (!f.options || f.options.length === 0) &&
      !f.optionsSource
    ) {
      errors.push(`Select field ${f.name} needs options`);
    }
    if (f.fieldType === "Link" && !f.linkTo) {
      errors.push(`Link field ${f.name} needs linkTo`);
    }
  }
  if (!def.fields?.some((f) => f.name === "id")) {
    errors.push("ObjectType must include an id field");
  }
  if (!def.storage || !["adapter", "native"].includes(def.storage.kind)) {
    errors.push("storage kind must be adapter or native");
  } else if (def.storage.kind === "adapter" && !def.storage.adapterId) {
    errors.push("adapter storage requires adapterId");
  }
  const idField = def.fields?.find((f) => f.name === "id");
  if (idField && idField.fieldType !== "Data") {
    errors.push("id field must use Data");
  }
  if (def.storage?.kind === "native" && def.database === "core") {
    errors.push("native ObjectTypes must be tenant-local");
  }
  if (def.database != null && !["tenant", "core"].includes(def.database)) {
    errors.push("database must be tenant or core");
  }
  if (def.contractVersion != null && (!Number.isInteger(def.contractVersion) || def.contractVersion < 1)) {
    errors.push("contractVersion must be a positive integer");
  }
  if (def.schemaVersion != null && (!Number.isInteger(def.schemaVersion) || def.schemaVersion < 1)) {
    errors.push("schemaVersion must be a positive integer");
  }
  if (def.versionField) {
    const versionField = def.fields?.find((field) => field.name === def.versionField);
    if (!versionField) errors.push(`versionField is not a declared field: ${def.versionField}`);
    else if (versionField.secret) errors.push("versionField must not be secret");
  }
  if (
    def.deprecated &&
    (!Number.isInteger(def.deprecated.since) ||
      def.deprecated.since < 1 ||
      !def.deprecated.message?.trim())
  ) {
    errors.push("deprecated requires a positive since version and message");
  }
  const permissionRoles = new Set<string>();
  for (const permission of def.permissions ?? []) {
    if (!ROLES.has(permission.role)) errors.push(`invalid permission role: ${permission.role}`);
    if (permissionRoles.has(permission.role)) {
      errors.push(`duplicate permission role: ${permission.role}`);
    }
    permissionRoles.add(permission.role);
  }
  if (def.permissions && def.permissions.length === 0) {
    errors.push("permissions must not be empty");
  }
  if (def.operations && new Set(def.operations).size !== def.operations.length) {
    errors.push("operations must be unique");
  }
  if (!def.operations?.length && !def.actions?.length) {
    errors.push("at least one operation or action must be declared");
  }
  const actionNames = new Set<string>();
  for (const action of def.actions ?? []) {
    if (!FIELD_RE.test(action.name)) {
      errors.push(`action name must be snake_case: ${action.name}`);
    }
    if (actionNames.has(action.name)) {
      errors.push(`duplicate action: ${action.name}`);
    }
    actionNames.add(action.name);
    if (!action.label?.trim()) errors.push(`action ${action.name} label required`);
    if (!action.target) {
      errors.push(`action ${action.name} must declare target`);
    } else if (!ACTION_TARGETS.has(action.target)) {
      errors.push(`action ${action.name} has invalid target`);
    }
    if (action.effect && !ACTION_EFFECTS.has(action.effect)) {
      errors.push(`action ${action.name} has invalid effect`);
    }
    if (action.execution && !ACTION_EXECUTIONS.has(action.execution)) {
      errors.push(`action ${action.name} has invalid execution`);
    }
    if (action.roles?.some((role) => !ROLES.has(role))) {
      errors.push(`action ${action.name} has invalid role`);
    }
    if (!action.roles?.length) {
      errors.push(`action ${action.name} must declare roles`);
    }
    if (action.roles && new Set(action.roles).size !== action.roles.length) {
      errors.push(`action ${action.name} roles must be unique`);
    }
    if (
      action.contractVersion != null &&
      (!Number.isInteger(action.contractVersion) || action.contractVersion < 1)
    ) {
      errors.push(`action ${action.name} contractVersion must be positive`);
    }
    if (
      action.retry &&
      (!Number.isInteger(action.retry.maxAttempts) ||
        action.retry.maxAttempts < 1)
    ) {
      errors.push(`action ${action.name} retry.maxAttempts must be positive`);
    }
    if (action.retry?.backoffMs != null && (!Number.isFinite(action.retry.backoffMs) || action.retry.backoffMs < 0)) {
      errors.push(`action ${action.name} retry.backoffMs must be non-negative`);
    }
    if (
      action.retry?.retryableErrorCodes &&
      new Set(action.retry.retryableErrorCodes).size !==
        action.retry.retryableErrorCodes.length
    ) {
      errors.push(`action ${action.name} retryable error codes must be unique`);
    }
    if (action.timeoutMs != null && (!Number.isFinite(action.timeoutMs) || action.timeoutMs <= 0)) {
      errors.push(`action ${action.name} timeoutMs must be positive`);
    }
    if (
      action.confirmation?.ttlSeconds != null &&
      (!Number.isFinite(action.confirmation.ttlSeconds) ||
        action.confirmation.ttlSeconds <= 0)
    ) {
      errors.push(`action ${action.name} confirmation ttlSeconds must be positive`);
    }
    if (
      action.idempotency?.ttlSeconds != null &&
      (!Number.isFinite(action.idempotency.ttlSeconds) ||
        action.idempotency.ttlSeconds <= 0)
    ) {
      errors.push(`action ${action.name} idempotency ttlSeconds must be positive`);
    }
    if (action.concurrency?.required && action.target === "collection") {
      errors.push(`collection action ${action.name} cannot require record concurrency`);
    }
    for (const [label, schema] of [
      ["inputSchema", action.inputSchema],
      ["outputSchema", action.outputSchema],
      ["errorSchema", action.errorSchema],
    ] as const) {
      if (schema != null && !isSchema(schema)) {
        errors.push(`action ${action.name} ${label} must be an object`);
      }
    }
    if (action.execution === "async" && action.cancellable == null) {
      errors.push(`async action ${action.name} must declare cancellable`);
    }
    if (action.execution === "sync" && action.cancellable != null) {
      errors.push(`sync action ${action.name} cannot declare cancellable`);
    }
    if (
      action.deprecated &&
      (!Number.isInteger(action.deprecated.since) ||
        action.deprecated.since < 1 ||
        !action.deprecated.message?.trim())
    ) {
      errors.push(`action ${action.name} deprecated metadata is invalid`);
    }
    if (action.concurrency?.versionField) {
      const versionField = def.fields.find(
        (field) => field.name === action.concurrency?.versionField
      );
      if (!versionField || versionField.secret) {
        errors.push(`action ${action.name} concurrency versionField is invalid`);
      }
    }
  }
  return errors;
}

function jsonSchemaType(fieldType: FieldType): Record<string, unknown> {
  switch (fieldType) {
    case "Int":
      return { type: "integer" };
    case "Float":
      return { type: "number" };
    case "Check":
      return { type: "boolean" };
    case "JSON":
      return {};
    default:
      return { type: "string" };
  }
}

/** JSON Schema object for create/update tool parameters from Field metadata. */
export function fieldsToJsonSchema(
  fields: FieldDef[],
  opts?: { mode?: "create" | "update" | "list"; includeId?: boolean }
): Record<string, unknown> {
  const mode = opts?.mode ?? "create";
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const f of fields) {
    if (f.fieldType === "ReadOnly" && mode !== "list") continue;
    if (f.inForm === false && mode !== "list") continue;
    if (f.name === "id" && mode === "create" && !opts?.includeId) continue;
    if (f.name === "id" && mode === "update") {
      properties.id = {
        type: "string",
        description: f.description ?? "Record id",
      };
      required.push("id");
      continue;
    }

    const prop: Record<string, unknown> = {
      ...jsonSchemaType(f.fieldType),
      description: f.description ?? f.label,
    };
    if (f.fieldType === "Select" && f.options?.length) {
      prop.enum = [...f.options];
    }
    properties[f.name] = prop;
    if (mode === "create" && f.required && f.name !== "id") {
      required.push(f.name);
    }
  }

  if (mode === "list") {
    return {
      type: "object",
      properties: {
        parent_id: {
          type: "string",
          description: "Optional parent filter (tree types)",
        },
        limit: { type: "integer" },
        offset: { type: "integer" },
        filters: {
          type: "object",
          description: "Exact-match filters keyed by Field name",
          additionalProperties: true,
        },
        sort: { type: "string", description: "Field name to sort by" },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
    };
  }

  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
  };
}

export function toolBaseName(objectTypeName: string): string {
  return objectTypeToSnake(objectTypeName);
}

export function perObjectTypeToolNames(objectTypeName: string): {
  list: string;
  get: string;
  create: string;
  update: string;
  delete: string;
} {
  const base = toolBaseName(objectTypeName);
  const plural =
    base.endsWith("s") ||
    base.endsWith("x") ||
    base.endsWith("ch") ||
    base.endsWith("sh")
      ? `${base}es`
      : base.endsWith("y") && !/[aeiou]y$/.test(base)
        ? `${base.slice(0, -1)}ies`
        : `${base}s`;
  return {
    list: `list_${plural}`,
    get: `get_${base}`,
    create: `create_${base}`,
    update: `update_${base}`,
    delete: `delete_${base}`,
  };
}
