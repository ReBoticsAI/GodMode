/**
 * GodMode metadata kernel vocabulary.
 *
 * - ObjectType — definition (fields, permissions, naming, storage)
 * - Field — column / property on an ObjectType
 * - Record — one instance of an ObjectType
 *
 * Do not call these DocTypes.
 */

export type FieldType =
  | "Data"
  | "Text"
  | "Int"
  | "Float"
  | "Check"
  | "Select"
  | "Link"
  | "JSON"
  | "ReadOnly";

export interface FieldDef {
  /** Stable field name (snake_case preferred for storage). */
  name: string;
  label: string;
  fieldType: FieldType;
  required?: boolean;
  /** For Select fields. */
  options?: string[];
  /** Runtime registry that supplies Select values (for example page kinds). */
  optionsSource?: "pageKinds";
  /** For Link fields — target ObjectType name. */
  linkTo?: string;
  /** Shown in list views by default. */
  inList?: boolean;
  /** Included in create/update tool params (default true except ReadOnly / id). */
  inForm?: boolean;
  description?: string;
  default?: unknown;
  /** Never serialize this field through generic Record APIs. */
  secret?: boolean;
}

export interface PermissionDef {
  role: PermissionRole;
  read?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}

export type PermissionRole = "viewer" | "editor" | "owner" | "intelligence";
export type ActionTarget = "record" | "collection" | "bulk";
export type ActionEffect = "read" | "write" | "destructive" | "external";
export type ActionExecution = "sync" | "async";

export interface ConfirmationPolicy {
  required: boolean;
  /** Maximum age of a confirmation grant. */
  ttlSeconds?: number;
}

export interface IdempotencyPolicy {
  required?: boolean;
  /** How long a completed action result may be reused. */
  ttlSeconds?: number;
}

export interface ActionEventDef {
  type: string;
  schema?: Record<string, unknown>;
}

export interface ActionDef {
  name: string;
  label: string;
  description?: string;
  target?: ActionTarget;
  effect?: ActionEffect;
  execution?: ActionExecution;
  contractVersion?: number;
  roles?: PermissionRole[];
  /** Compatibility shorthand. Prefer confirmation for new definitions. */
  confirm?: boolean;
  confirmation?: ConfirmationPolicy;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  errorSchema?: Record<string, unknown>;
  sensitiveInputPaths?: string[];
  sensitiveOutputPaths?: string[];
  idempotency?: IdempotencyPolicy;
  retry?: {
    maxAttempts: number;
    backoffMs?: number;
    retryableErrorCodes?: string[];
  };
  concurrency?: {
    required: boolean;
    versionField?: string;
  };
  timeoutMs?: number;
  cancellable?: boolean;
  events?: ActionEventDef[];
  deprecated?: {
    since: number;
    message: string;
    replacement?: string;
  };
}

export type ObjectTypeStorage =
  | {
      /** Maps onto an existing table / service (no second copy of data). */
      kind: "adapter";
      adapterId: string;
    }
  | {
      /** Physical SQLite table materialized from Field defs. */
      kind: "native";
      /** Optional explicit table name; default gm_ot_<snake_name>. */
      tableName?: string;
    };

export interface ObjectTypeDef {
  /** PascalCase type name, e.g. StructureNode. */
  name: string;
  label: string;
  description?: string;
  /** Plural label for lists. */
  labelPlural?: string;
  storage: ObjectTypeStorage;
  fields: FieldDef[];
  permissions?: PermissionDef[];
  /** Plugin id when contributed by a plugin. */
  pluginId?: string;
  /** Soft module / department hint for Discovery. */
  module?: string;
  /** Named, centrally enforced access policy for discovery and adapters. */
  accessPolicy?: string;
  /** Public metadata/action contract revision, independent from storage schema. */
  contractVersion?: number;
  /** Metadata/schema revision used by native additive migrations. */
  schemaVersion?: number;
  /** Database containing adapter records. Native ObjectTypes are tenant-local. */
  database?: "tenant" | "core";
  /** Operations exposed through generic Record APIs. */
  operations?: Array<"list" | "get" | "create" | "update" | "delete">;
  /** Named domain operations implemented by an adapter (moves, approvals, runs). */
  actions?: ActionDef[];
}

/** Serialized Record payload (field name → value). */
export type RecordData = Record<string, unknown>;

export interface RecordRow {
  id: string;
  objectType: string;
  data: RecordData;
}

export interface ListRecordsResult {
  objectType: string;
  records: RecordRow[];
  total: number;
}

export type ActionResult =
  | { status: "succeeded"; result: unknown }
  | { status: "accepted"; operationRunId: string }
  | { status: "confirmation_required"; confirmationId: string }
  | { status: "conflict"; code: string; message: string };
