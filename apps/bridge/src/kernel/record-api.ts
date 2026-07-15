import type { AppDatabase } from "../db.js";
import { createHash, randomUUID } from "node:crypto";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type {
  ActionDef,
  ListRecordsResult,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import { getCoreDb } from "../core-db.js";
import { insertEvent } from "../services/data-management-migration.js";
import { getObjectType, listObjectTypes } from "./registry.js";
import {
  getRecordAdapter,
  hasRecordAdapter,
  registerRecordAdapter,
  withKernelEventBus,
  type OperationContext,
  type RecordOperation,
  type RecordQuery,
} from "./adapter-registry.js";
import { structureNodeAdapter } from "./adapters/structure-node.js";
import {
  createNativeRecord,
  deleteNativeRecord,
  ensureNativeTable,
  getNativeRecord,
  listNativeRecords,
  updateNativeRecord,
} from "./native-storage.js";

export class KernelError extends Error {
  status: number;
  code: string;
  details?: unknown;
  retryable: boolean;
  constructor(
    status: number,
    message: string,
    opts: { code?: string; details?: unknown; retryable?: boolean } = {}
  ) {
    super(message);
    this.status = status;
    this.code = opts.code ?? `KERNEL_${status}`;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

const SYSTEM_CAPABILITY = Symbol("godmode.kernel.system");
const ajv = new Ajv2020({ allErrors: true, strict: false });
const compiledSchemas = new WeakMap<object, ValidateFunction>();

export function createSystemOperationContext(
  overrides: Partial<OperationContext> = {}
): OperationContext {
  return {
    role: "owner",
    source: "system",
    agentId: "system",
    ...overrides,
    systemCapability: SYSTEM_CAPABILITY,
  };
}

function requireContext(ctx: OperationContext | undefined): OperationContext {
  if (!ctx) {
    throw new KernelError(500, "Explicit OperationContext required", {
      code: "KERNEL_CONTEXT_REQUIRED",
    });
  }
  if (
    ctx.source === "system" &&
    ctx.systemCapability !== SYSTEM_CAPABILITY
  ) {
    throw new KernelError(403, "Invalid system capability", {
      code: "KERNEL_INVALID_SYSTEM_CAPABILITY",
    });
  }
  if (ctx.source !== "system" && !ctx.userId && !ctx.agentId) {
    throw new KernelError(401, "Authenticated principal required", {
      code: "KERNEL_PRINCIPAL_REQUIRED",
    });
  }
  return ctx;
}

function withDataContext(
  db: AppDatabase,
  def: ObjectTypeDef,
  ctx: OperationContext
): OperationContext {
  return {
    ...ctx,
    data: {
      tenantDb: db,
      coreDb: getCoreDb(),
      declaredDatabase: def.database ?? "tenant",
    },
  };
}

function auditMutation(
  db: AppDatabase,
  ctx: OperationContext,
  action: string,
  payload: unknown,
  result = "ok"
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      scope TEXT,
      payload_hash TEXT,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      actor_agent_id TEXT,
      subject TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      dispatched INTEGER NOT NULL DEFAULT 0
    );
  `);
  const agentId = ctx.agentId ?? (ctx.userId ? `user:${ctx.userId}` : "system");
  const payloadHash = createHash("sha256")
    .update(stableJson(payload))
    .digest("hex")
    .slice(0, 16);
  db.prepare(
    `INSERT INTO platform_action_log (agent_id, action, scope, payload_hash, result)
     VALUES (?, ?, ?, ?, ?)`
  ).run(agentId, action, ctx.tenantId ?? null, payloadHash, result);
  insertEvent(db, {
    id: randomUUID(),
    type: "platform.action",
    actorAgentId: agentId,
    subject: ctx.tenantId ?? null,
    payload: {
      action,
      result,
      payloadHash,
      requestId: ctx.requestId,
    },
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function auditKernelFailure(
  db: AppDatabase,
  ctx: OperationContext,
  action: string,
  payload: unknown,
  error: unknown
): KernelError {
  const normalized = normalizeKernelError(error);
  try {
    db.transaction(() => {
      auditMutation(
        db,
        requireContext(ctx),
        action,
        { payload, errorCode: normalized.code },
        normalized.status === 401 || normalized.status === 403
          ? "denied"
          : "error"
      );
    })();
  } catch {
    // Preserve the original operation error if the audit store is unavailable.
  }
  return normalized;
}

function inputHash(input: unknown): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function validateSchema(
  schema: Record<string, unknown> | undefined,
  value: unknown,
  label: string
): void {
  if (!schema) return;
  const validate: ValidateFunction =
    compiledSchemas.get(schema) ?? ajv.compile(schema);
  compiledSchemas.set(schema, validate);
  if (!validate(value)) {
    throw new KernelError(400, `${label} failed schema validation`, {
      code: "KERNEL_SCHEMA_INVALID",
      details: (validate.errors ?? []).map((error: ErrorObject) => ({
        path: error.instancePath,
        keyword: error.keyword,
        message: error.message,
      })),
    });
  }
}

function projectRow(
  def: ObjectTypeDef,
  row: RecordRow,
  ctx: OperationContext,
  adapter?: ReturnType<typeof getRecordAdapter>
): RecordRow {
  const policyRow = adapter?.policy?.project?.(def, row, ctx) ?? row;
  const fields = new Map(def.fields.map((field) => [field.name, field]));
  const data: RecordData = {};
  for (const [name, value] of Object.entries(policyRow.data ?? {})) {
    const field = fields.get(name);
    if (field && !field.secret) data[name] = value;
  }
  return { id: String(policyRow.id), objectType: def.name, data };
}

function resourceVersion(row: RecordRow | null | undefined): string | undefined {
  const value =
    row?.data.version ??
    row?.data.updated_at ??
    row?.data.revision ??
    undefined;
  return value == null ? undefined : String(value);
}

function requireExpectedVersion(
  row: RecordRow | null | undefined,
  ctx: OperationContext
): void {
  if (!ctx.expectedVersion) return;
  const expected = ctx.expectedVersion.replace(/^W\//, "").replace(/^"|"$/g, "");
  const actual = resourceVersion(row);
  if (!actual || actual !== expected) {
    throw new KernelError(412, "Resource version does not match If-Match", {
      code: "KERNEL_VERSION_CONFLICT",
      details: { expected, actual },
    });
  }
}

function authorize(
  adapter: ReturnType<typeof getRecordAdapter>,
  operation: RecordOperation | "action",
  def: ObjectTypeDef,
  ctx: OperationContext,
  row?: RecordRow | null,
  action?: ActionDef
): void {
  const decision = adapter?.policy?.authorize?.(
    operation,
    def,
    ctx,
    row,
    action
  );
  if (decision === false) {
    throw new KernelError(403, "Resource policy denied the operation", {
      code: "KERNEL_POLICY_DENIED",
    });
  }
}

if (!hasRecordAdapter(structureNodeAdapter.id)) {
  registerRecordAdapter(structureNodeAdapter);
}

function isVisible(def: ObjectTypeDef, ctx: OperationContext): boolean {
  return (
    !def.pluginId ||
    ctx.source === "system" ||
    ctx.installedPluginIds?.has(def.pluginId) === true
  );
}

function requireOt(name: string, ctx: OperationContext): ObjectTypeDef {
  const def = getObjectType(name);
  if (!def || !isVisible(def, ctx)) {
    throw new KernelError(404, `Unknown ObjectType: ${name}`);
  }
  return def;
}

function requireOperation(
  def: ObjectTypeDef,
  operation: RecordOperation,
  ctx: OperationContext
): void {
  if (!def.operations?.includes(operation)) {
    throw new KernelError(405, `${operation} is disabled for ${def.name}`);
  }
  if (
    ctx.source === "system" &&
    ctx.systemCapability === SYSTEM_CAPABILITY
  ) {
    return;
  }
  if (
    def.accessPolicy === "platform-admin" &&
    !ctx.isAdmin &&
    ctx.role !== "intelligence"
  ) {
    throw new KernelError(403, "Platform administrator access required", {
      code: "KERNEL_ADMIN_REQUIRED",
    });
  }
  if (
    ["tenant-member", "tenant-local"].includes(def.accessPolicy ?? "") &&
    !ctx.tenantId
  ) {
    throw new KernelError(403, "Tenant membership context required", {
      code: "KERNEL_TENANT_REQUIRED",
    });
  }
  if (def.accessPolicy === "user-private" && !ctx.userId) {
    throw new KernelError(403, "User principal required", {
      code: "KERNEL_USER_REQUIRED",
    });
  }
  if (
    def.accessPolicy === "relationship-scoped" &&
    !ctx.userId &&
    !ctx.agentId
  ) {
    throw new KernelError(403, "Relationship principal required", {
      code: "KERNEL_RELATIONSHIP_PRINCIPAL_REQUIRED",
    });
  }
  const permission = def.permissions?.find((p) => p.role === ctx.role);
  const permissionKey =
    operation === "list" || operation === "get" ? "read" : operation;
  if (!permission || permission[permissionKey] !== true) {
    throw new KernelError(403, `${ctx.role} cannot ${operation} ${def.name}`);
  }
}

function validateRecordData(
  def: ObjectTypeDef,
  data: RecordData,
  mode: "create" | "update"
): RecordData {
  const fields = new Map(def.fields.map((f) => [f.name, f]));
  const clean: RecordData = {};
  for (const [name, value] of Object.entries(data)) {
    const field = fields.get(name);
    if (!field) throw new KernelError(400, `Unknown field ${def.name}.${name}`);
    if (field.secret) {
      throw new KernelError(400, `${field.label} cannot be written through Record API`);
    }
    if (field.fieldType === "ReadOnly" || field.inForm === false) {
      if (name === "id" && mode === "create") clean[name] = value;
      else throw new KernelError(400, `${field.label} is read-only`);
      continue;
    }
    if (value != null) {
      if (field.fieldType === "Int" && !Number.isInteger(value)) {
        throw new KernelError(400, `${field.label} must be an integer`);
      }
      if (
        field.fieldType === "Float" &&
        (typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new KernelError(400, `${field.label} must be a finite number`);
      }
      if (field.fieldType === "Check" && typeof value !== "boolean") {
        throw new KernelError(400, `${field.label} must be true or false`);
      }
      if (
        ["Data", "Select", "Link"].includes(field.fieldType) &&
        typeof value !== "string"
      ) {
        throw new KernelError(400, `${field.label} must be text`);
      }
    }
    if (
      field.fieldType === "Select" &&
      value != null &&
      value !== "" &&
      field.options?.length &&
      !field.options.includes(String(value))
    ) {
      throw new KernelError(400, `Invalid ${field.label}: ${String(value)}`);
    }
    if (
      field.fieldType === "Link" &&
      value != null &&
      value !== "" &&
      field.linkTo &&
      !getObjectType(field.linkTo)
    ) {
      throw new KernelError(400, `Unknown Link target ${field.linkTo}`);
    }
    clean[name] = value;
  }
  if (mode === "create") {
    for (const field of def.fields) {
      if (
        field.required &&
        field.name !== "id" &&
        (clean[field.name] === undefined ||
          clean[field.name] === null ||
          clean[field.name] === "")
      ) {
        throw new KernelError(400, `${field.label} is required`);
      }
      if (clean[field.name] === undefined && field.default !== undefined) {
        clean[field.name] = field.default;
      }
    }
  }
  return clean;
}

export function ensureObjectTypeStorage(db: AppDatabase, def: ObjectTypeDef): void {
  if (def.storage.kind === "native") {
    ensureNativeTable(db, def);
  }
}

export function materializeAllNativeTypes(
  db: AppDatabase,
  ctx: OperationContext
): void {
  ctx = requireContext(ctx);
  for (const def of listObjectTypes().filter((d) => isVisible(d, ctx))) {
    ensureObjectTypeStorage(db, def);
  }
}

export function listRecords(
  db: AppDatabase,
  objectType: string,
  opts: RecordQuery = {},
  ctx: OperationContext
): ListRecordsResult {
  ctx = withKernelEventBus(requireContext(ctx));
  const def = requireOt(objectType, ctx);
  ctx = withDataContext(db, def, ctx);
  requireOperation(def, "list", ctx);
  const query = {
    ...opts,
    limit: Math.min(Math.max(Number(opts.limit) || 100, 1), 500),
    offset: Math.max(Number(opts.offset) || 0, 0),
  };
  if (def.storage.kind === "adapter") {
    const adapter = getRecordAdapter(def.storage.adapterId);
    if (!adapter?.list) throw new KernelError(405, `list is not supported for ${objectType}`);
    authorize(adapter, "list", def, ctx);
    const result = adapter.list(db, def, query, ctx);
    return {
      ...result,
      records: result.records.map((row) => projectRow(def, row, ctx, adapter)),
    };
  }
  if (def.storage.kind === "native") {
    const { records, total } = listNativeRecords(db, def, query);
    return {
      objectType: def.name,
      records: records.map((row) => projectRow(def, row, ctx)),
      total,
    };
  }
  throw new KernelError(501, `No adapter for ObjectType ${objectType}`);
}

export function getRecord(
  db: AppDatabase,
  objectType: string,
  id: string,
  ctx: OperationContext
): RecordRow {
  ctx = withKernelEventBus(requireContext(ctx));
  const def = requireOt(objectType, ctx);
  ctx = withDataContext(db, def, ctx);
  requireOperation(def, "get", ctx);
  let row: RecordRow | null = null;
  if (def.storage.kind === "adapter") {
    const adapter = getRecordAdapter(def.storage.adapterId);
    if (!adapter?.get) throw new KernelError(405, `get is not supported for ${objectType}`);
    row = adapter.get(db, def, id, ctx);
    authorize(adapter, "get", def, ctx, row);
    if (row) row = projectRow(def, row, ctx, adapter);
  } else if (def.storage.kind === "native") {
    row = getNativeRecord(db, def, id);
    if (row) row = projectRow(def, row, ctx);
  } else {
    throw new KernelError(501, `No adapter for ObjectType ${objectType}`);
  }
  if (!row) throw new KernelError(404, `${objectType} record not found: ${id}`);
  return row;
}

function createRecordImpl(
  db: AppDatabase,
  objectType: string,
  data: RecordData,
  ctx: OperationContext
): RecordRow {
  ctx = withKernelEventBus(requireContext(ctx));
  const def = requireOt(objectType, ctx);
  ctx = withDataContext(db, def, ctx);
  requireOperation(def, "create", ctx);
  const validated = validateRecordData(def, data, "create");
  try {
    if (def.storage.kind === "adapter") {
      const adapter = getRecordAdapter(def.storage.adapterId);
      if (!adapter?.create) throw new KernelError(405, `create is not supported for ${objectType}`);
      authorize(adapter, "create", def, ctx);
      const row = db.transaction(() => {
        const created = adapter.create!(db, def, validated, ctx);
        auditMutation(db, ctx, `object.create.${objectType}`, {
          recordId: created.id,
        });
        return created;
      })();
      ctx.bus?.emit("object.record.created", {
        objectType,
        recordId: row.id,
        tenantId: ctx.tenantId,
        actorId: ctx.agentId ?? ctx.userId,
        source: ctx.source,
      });
      return projectRow(def, row, ctx, adapter);
    }
    if (def.storage.kind === "native") {
      const row = db.transaction(() => {
        const created = createNativeRecord(db, def, validated);
        auditMutation(db, ctx, `object.create.${objectType}`, {
          recordId: created.id,
        });
        return created;
      })();
      ctx.bus?.emit("object.record.created", {
        objectType,
        recordId: row.id,
        tenantId: ctx.tenantId,
        actorId: ctx.agentId ?? ctx.userId,
        source: ctx.source,
      });
      return projectRow(def, row, ctx);
    }
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) {
      throw new KernelError(
        Number((err as { status: number }).status),
        err instanceof Error ? err.message : "error"
      );
    }
    throw err;
  }
  throw new KernelError(501, `No adapter for ObjectType ${objectType}`);
}

export function createRecord(
  db: AppDatabase,
  objectType: string,
  data: RecordData,
  ctx: OperationContext
): RecordRow {
  try {
    return createRecordImpl(db, objectType, data, ctx);
  } catch (error) {
    throw auditKernelFailure(
      db,
      ctx,
      `object.create.${objectType}`,
      { data },
      error
    );
  }
}

function updateRecordImpl(
  db: AppDatabase,
  objectType: string,
  id: string,
  data: RecordData,
  ctx: OperationContext
): RecordRow {
  ctx = withKernelEventBus(requireContext(ctx));
  const def = requireOt(objectType, ctx);
  ctx = withDataContext(db, def, ctx);
  requireOperation(def, "update", ctx);
  const validated = validateRecordData(def, data, "update");
  try {
    if (def.storage.kind === "adapter") {
      const adapter = getRecordAdapter(def.storage.adapterId);
      if (!adapter?.update) throw new KernelError(405, `update is not supported for ${objectType}`);
      const current = adapter.get?.(db, def, id, ctx) ?? null;
      authorize(adapter, "update", def, ctx, current);
      requireExpectedVersion(current, ctx);
      const row = db.transaction(() => {
        const updated = adapter.update!(db, def, id, validated, ctx);
        auditMutation(db, ctx, `object.update.${objectType}`, { recordId: id });
        return updated;
      })();
      ctx.bus?.emit("object.record.updated", {
        objectType,
        recordId: id,
        tenantId: ctx.tenantId,
        actorId: ctx.agentId ?? ctx.userId,
        source: ctx.source,
      });
      return projectRow(def, row, ctx, adapter);
    }
    if (def.storage.kind === "native") {
      requireExpectedVersion(getNativeRecord(db, def, id), ctx);
      const row = db.transaction(() => {
        const updated = updateNativeRecord(db, def, id, validated);
        auditMutation(db, ctx, `object.update.${objectType}`, { recordId: id });
        return updated;
      })();
      ctx.bus?.emit("object.record.updated", {
        objectType,
        recordId: id,
        tenantId: ctx.tenantId,
        actorId: ctx.agentId ?? ctx.userId,
        source: ctx.source,
      });
      return projectRow(def, row, ctx);
    }
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) {
      throw new KernelError(
        Number((err as { status: number }).status),
        err instanceof Error ? err.message : "error"
      );
    }
    throw err;
  }
  throw new KernelError(501, `No adapter for ObjectType ${objectType}`);
}

export function updateRecord(
  db: AppDatabase,
  objectType: string,
  id: string,
  data: RecordData,
  ctx: OperationContext
): RecordRow {
  try {
    return updateRecordImpl(db, objectType, id, data, ctx);
  } catch (error) {
    throw auditKernelFailure(
      db,
      ctx,
      `object.update.${objectType}`,
      { recordId: id, data },
      error
    );
  }
}

function deleteRecordImpl(
  db: AppDatabase,
  objectType: string,
  id: string,
  ctx: OperationContext
): void {
  ctx = withKernelEventBus(requireContext(ctx));
  const def = requireOt(objectType, ctx);
  ctx = withDataContext(db, def, ctx);
  requireOperation(def, "delete", ctx);
  try {
    if (def.storage.kind === "adapter") {
      const adapter = getRecordAdapter(def.storage.adapterId);
      if (!adapter?.delete) throw new KernelError(405, `delete is not supported for ${objectType}`);
      const current = adapter.get?.(db, def, id, ctx) ?? null;
      authorize(adapter, "delete", def, ctx, current);
      requireExpectedVersion(current, ctx);
      db.transaction(() => {
        adapter.delete!(db, def, id, ctx);
        auditMutation(db, ctx, `object.delete.${objectType}`, { recordId: id });
      })();
      ctx.bus?.emit("object.record.deleted", {
        objectType,
        recordId: id,
        tenantId: ctx.tenantId,
        actorId: ctx.agentId ?? ctx.userId,
        source: ctx.source,
      });
      return;
    }
    if (def.storage.kind === "native") {
      requireExpectedVersion(getNativeRecord(db, def, id), ctx);
      db.transaction(() => {
        deleteNativeRecord(db, def, id);
        auditMutation(db, ctx, `object.delete.${objectType}`, { recordId: id });
      })();
      ctx.bus?.emit("object.record.deleted", {
        objectType,
        recordId: id,
        tenantId: ctx.tenantId,
        actorId: ctx.agentId ?? ctx.userId,
        source: ctx.source,
      });
      return;
    }
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) {
      throw new KernelError(
        Number((err as { status: number }).status),
        err instanceof Error ? err.message : "error"
      );
    }
    throw err;
  }
  throw new KernelError(501, `No adapter for ObjectType ${objectType}`);
}

export function deleteRecord(
  db: AppDatabase,
  objectType: string,
  id: string,
  ctx: OperationContext
): void {
  try {
    deleteRecordImpl(db, objectType, id, ctx);
  } catch (error) {
    throw auditKernelFailure(
      db,
      ctx,
      `object.delete.${objectType}`,
      { recordId: id },
      error
    );
  }
}

const confirmationGrants = new Map<
  string,
  {
    actorId: string;
    objectType: string;
    recordId: string;
    action: string;
    inputHash: string;
    resourceVersion?: string;
    expiresAt: number;
  }
>();
const operationControllers = new Map<string, AbortController>();

function actorId(ctx: OperationContext): string {
  return ctx.agentId ?? (ctx.userId ? `user:${ctx.userId}` : "system");
}

function ensureActionTables(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kernel_action_idempotency (
      key TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action_name TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (key, actor_id, object_type, record_id, action_name)
    );
    CREATE TABLE IF NOT EXISTS kernel_operation_runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      actor_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      record_id TEXT,
      action_name TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
  `);
}

function requireActionPermission(
  action: ActionDef,
  def: ObjectTypeDef,
  ctx: OperationContext
): void {
  if (
    ctx.source === "system" &&
    ctx.systemCapability === SYSTEM_CAPABILITY
  ) {
    return;
  }
  if (!action.roles?.includes(ctx.role)) {
    throw new KernelError(403, `${ctx.role} cannot run ${def.name}.${action.name}`, {
      code: "KERNEL_ACTION_FORBIDDEN",
    });
  }
}

function requireConfirmation(
  action: ActionDef,
  objectType: string,
  recordId: string,
  input: RecordData,
  ctx: OperationContext,
  version?: string
): void {
  const policy = action.confirmation ?? {
    required: action.confirm === true,
    ttlSeconds: 300,
  };
  if (
    !policy.required ||
    ctx.source === "system" ||
    (ctx.source === "agent" && ctx.trustedConfirmation === true)
  ) {
    return;
  }
  const hash = inputHash(input);
  const id = ctx.confirmationId;
  const grant = id ? confirmationGrants.get(id) : undefined;
  if (
    grant &&
    grant.actorId === actorId(ctx) &&
    grant.objectType === objectType &&
    grant.recordId === recordId &&
    grant.action === action.name &&
    grant.inputHash === hash &&
    grant.resourceVersion === version &&
    grant.expiresAt > Date.now()
  ) {
    confirmationGrants.delete(id!);
    return;
  }
  const confirmationId = randomUUID();
  confirmationGrants.set(confirmationId, {
    actorId: actorId(ctx),
    objectType,
    recordId,
    action: action.name,
    inputHash: hash,
    resourceVersion: version,
    expiresAt: Date.now() + (policy.ttlSeconds ?? 300) * 1000,
  });
  throw new KernelError(428, "Action confirmation required", {
    code: "KERNEL_CONFIRMATION_REQUIRED",
    details: { confirmationId, expiresAt: new Date(confirmationGrants.get(confirmationId)!.expiresAt).toISOString() },
  });
}

async function executeRecordActionImpl(
  db: AppDatabase,
  objectType: string,
  id: string,
  actionName: string,
  input: RecordData,
  ctx: OperationContext
): Promise<unknown> {
  ctx = withKernelEventBus(requireContext(ctx));
  const def = requireOt(objectType, ctx);
  ctx = withDataContext(db, def, ctx);
  const action = def.actions?.find((item) => item.name === actionName);
  if (!action) {
    throw new KernelError(404, `Unknown ${objectType} action: ${actionName}`);
  }
  if (def.storage.kind !== "adapter") {
    throw new KernelError(405, `${objectType} actions require a service adapter`);
  }
  const adapter = getRecordAdapter(def.storage.adapterId);
  const handler = adapter?.actions?.[actionName];
  if (!handler) {
    throw new KernelError(501, `${objectType} action is not implemented: ${actionName}`);
  }
  requireActionPermission(action, def, ctx);
  const current = action.target === "collection" ? null : adapter?.get?.(db, def, id, ctx) ?? null;
  if (action.target !== "collection" && !current) {
    throw new KernelError(404, `${objectType} record not found: ${id}`);
  }
  authorize(adapter, "action", def, ctx, current, action);
  if (action.concurrency?.required && !ctx.expectedVersion) {
    throw new KernelError(428, "If-Match required for this action", {
      code: "KERNEL_IF_MATCH_REQUIRED",
    });
  }
  if (action.concurrency?.required) requireExpectedVersion(current, ctx);
  validateSchema(action.inputSchema, input, `${objectType}.${actionName} input`);
  ensureActionTables(db);

  const hash = inputHash(input);
  const idem = action.idempotency;
  if (idem?.required && !ctx.idempotencyKey) {
    throw new KernelError(400, "Idempotency-Key required", {
      code: "KERNEL_IDEMPOTENCY_REQUIRED",
    });
  }
  if (ctx.idempotencyKey) {
    const existing = db
      .prepare(
        `SELECT input_hash, status, result_json FROM kernel_action_idempotency
         WHERE key=? AND actor_id=? AND object_type=? AND record_id=? AND action_name=?`
      )
      .get(ctx.idempotencyKey, actorId(ctx), objectType, id, actionName) as
      | { input_hash: string; status: string; result_json: string | null }
      | undefined;
    if (existing) {
      if (existing.input_hash !== hash) {
        throw new KernelError(409, "Idempotency key reused with different input", {
          code: "KERNEL_IDEMPOTENCY_CONFLICT",
        });
      }
      if (existing.status === "succeeded") {
        return existing.result_json ? JSON.parse(existing.result_json) : null;
      }
      throw new KernelError(409, "Action already in progress", {
        code: "KERNEL_ACTION_IN_PROGRESS",
        retryable: true,
      });
    }
    requireConfirmation(
      action,
      objectType,
      id,
      input,
      ctx,
      resourceVersion(current)
    );
    db.prepare(
      `INSERT INTO kernel_action_idempotency
       (key, actor_id, object_type, record_id, action_name, input_hash, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', datetime('now', ?))`
    ).run(
      ctx.idempotencyKey,
      actorId(ctx),
      objectType,
      id,
      actionName,
      hash,
      `+${idem?.ttlSeconds ?? 86400} seconds`
    );
  } else {
    requireConfirmation(
      action,
      objectType,
      id,
      input,
      ctx,
      resourceVersion(current)
    );
  }

  if (action.execution === "async") {
    const operationRunId = randomUUID();
    const controller = new AbortController();
    operationControllers.set(operationRunId, controller);
    db.prepare(
      `INSERT INTO kernel_operation_runs
       (id, tenant_id, actor_id, object_type, record_id, action_name, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    ).run(operationRunId, ctx.tenantId ?? null, actorId(ctx), objectType, id || null, actionName);
    queueMicrotask(async () => {
      try {
        db.prepare(
          `UPDATE kernel_operation_runs SET status='running', updated_at=datetime('now') WHERE id=?`
        ).run(operationRunId);
        const raw = await handler(db, def, id, input, {
          ...ctx,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        validateSchema(action.outputSchema, raw, `${objectType}.${actionName} output`);
        const result = redactActionOutput(raw, action);
        db.transaction(() => {
          db.prepare(
            `UPDATE kernel_operation_runs
             SET status='succeeded', result_json=?, updated_at=datetime('now'), finished_at=datetime('now')
             WHERE id=?`
          ).run(JSON.stringify(result ?? null), operationRunId);
          if (ctx.idempotencyKey) {
            db.prepare(
              `UPDATE kernel_action_idempotency
               SET status='succeeded', result_json=?, updated_at=datetime('now')
               WHERE key=? AND actor_id=? AND object_type=? AND record_id=? AND action_name=?`
            ).run(
              JSON.stringify({ status: "accepted", operationRunId }),
              ctx.idempotencyKey,
              actorId(ctx),
              objectType,
              id,
              actionName
            );
          }
          auditMutation(db, ctx, `object.action.${objectType}.${actionName}`, {
            recordId: id,
            operationRunId,
            input: redactActionInput(input, action),
          });
          appendDeclaredActionEvents(
            db,
            ctx,
            action,
            objectType,
            id,
            result
          );
        })();
        emitAction(ctx, objectType, id, actionName, operationRunId);
      } catch (error) {
        if (controller.signal.aborted) return;
        const normalized = normalizeKernelError(error);
        db.transaction(() => {
          db.prepare(
            `UPDATE kernel_operation_runs
             SET status='failed', error_code=?, error_message=?, updated_at=datetime('now'), finished_at=datetime('now')
             WHERE id=?`
          ).run(normalized.code, normalized.message, operationRunId);
          if (ctx.idempotencyKey) {
            db.prepare(
              `UPDATE kernel_action_idempotency
               SET status='failed', updated_at=datetime('now')
               WHERE key=? AND actor_id=? AND object_type=? AND record_id=? AND action_name=?`
            ).run(
              ctx.idempotencyKey,
              actorId(ctx),
              objectType,
              id,
              actionName
            );
          }
          auditMutation(
            db,
            ctx,
            `object.action.${objectType}.${actionName}`,
            { recordId: id, operationRunId, errorCode: normalized.code },
            "error"
          );
        })();
      } finally {
        operationControllers.delete(operationRunId);
      }
    });
    return { status: "accepted", operationRunId };
  }

  try {
    const raw = await handler(db, def, id, input, ctx);
    validateSchema(action.outputSchema, raw, `${objectType}.${actionName} output`);
    const result = redactActionOutput(raw, action);
    db.transaction(() => {
      auditMutation(db, ctx, `object.action.${objectType}.${actionName}`, {
        recordId: id,
        input: redactActionInput(input, action),
      });
      appendDeclaredActionEvents(db, ctx, action, objectType, id, result);
      if (ctx.idempotencyKey) {
        db.prepare(
          `UPDATE kernel_action_idempotency
           SET status='succeeded', result_json=?, updated_at=datetime('now')
           WHERE key=? AND actor_id=? AND object_type=? AND record_id=? AND action_name=?`
        ).run(
          JSON.stringify(result ?? null),
          ctx.idempotencyKey,
          actorId(ctx),
          objectType,
          id,
          actionName
        );
      }
    })();
    emitAction(ctx, objectType, id, actionName);
    return result;
  } catch (error) {
    if (ctx.idempotencyKey) {
      db.prepare(
        `UPDATE kernel_action_idempotency SET status='failed', updated_at=datetime('now')
         WHERE key=? AND actor_id=? AND object_type=? AND record_id=? AND action_name=?`
      ).run(ctx.idempotencyKey, actorId(ctx), objectType, id, actionName);
    }
    throw normalizeKernelError(error);
  }
}

export async function executeRecordAction(
  db: AppDatabase,
  objectType: string,
  id: string,
  actionName: string,
  input: RecordData,
  ctx: OperationContext
): Promise<unknown> {
  try {
    return await executeRecordActionImpl(
      db,
      objectType,
      id,
      actionName,
      input,
      ctx
    );
  } catch (error) {
    const normalized = normalizeKernelError(error);
    try {
      db.transaction(() => {
        auditMutation(
          db,
          requireContext(ctx),
          `object.action.${objectType}.${actionName}`,
          {
            recordId: id,
            input,
            errorCode: normalized.code,
          },
          normalized.status === 401 || normalized.status === 403
            ? "denied"
            : "error"
        );
      })();
    } catch {
      // Preserve the operation error if the audit store is unavailable.
    }
    throw normalized;
  }
}

export function cancelOperationRun(
  db: AppDatabase,
  operationRunId: string,
  ctx: OperationContext
): boolean {
  ctx = requireContext(ctx);
  ensureActionTables(db);
  const row = db
    .prepare(
      `SELECT tenant_id, actor_id, status FROM kernel_operation_runs WHERE id=?`
    )
    .get(operationRunId) as
    | { tenant_id: string | null; actor_id: string; status: string }
    | undefined;
  if (!row) throw new KernelError(404, `OperationRun not found: ${operationRunId}`);
  if (
    ctx.source !== "system" &&
    ctx.role !== "intelligence" &&
    ctx.role !== "owner" &&
    row.actor_id !== actorId(ctx)
  ) {
    throw new KernelError(403, "Cannot cancel another principal's operation", {
      code: "KERNEL_OPERATION_CANCEL_FORBIDDEN",
    });
  }
  if (ctx.tenantId && row.tenant_id && ctx.tenantId !== row.tenant_id) {
    throw new KernelError(404, `OperationRun not found: ${operationRunId}`);
  }
  if (!["pending", "running"].includes(row.status)) return false;
  operationControllers.get(operationRunId)?.abort();
  db.transaction(() => {
    db.prepare(
      `UPDATE kernel_operation_runs
       SET status='cancelled', updated_at=datetime('now'), finished_at=datetime('now')
       WHERE id=?`
    ).run(operationRunId);
    auditMutation(db, ctx, "object.action.OperationRun.cancel", {
      operationRunId,
    });
  })();
  return true;
}

export function recoverInterruptedOperationRuns(db: AppDatabase): number {
  ensureActionTables(db);
  return db
    .prepare(
      `UPDATE kernel_operation_runs
       SET status='failed',
           error_code='KERNEL_RESTART_INTERRUPTED',
           error_message='Bridge restarted before this operation completed',
           updated_at=datetime('now'),
           finished_at=datetime('now')
       WHERE status IN ('pending', 'running')`
    )
    .run().changes;
}

export function executeCollectionAction(
  db: AppDatabase,
  objectType: string,
  actionName: string,
  input: RecordData,
  ctx: OperationContext
): Promise<unknown> {
  return executeRecordAction(db, objectType, "", actionName, input, ctx);
}

function emitAction(
  ctx: OperationContext,
  objectType: string,
  recordId: string,
  action: string,
  operationRunId?: string
): void {
  ctx.bus?.emit("object.record.action", {
    objectType,
    recordId: recordId || undefined,
    action,
    operationRunId,
    tenantId: ctx.tenantId,
    actorId: ctx.agentId ?? ctx.userId,
    source: ctx.source,
  });
}

function appendDeclaredActionEvents(
  db: AppDatabase,
  ctx: OperationContext,
  action: ActionDef,
  objectType: string,
  recordId: string,
  result: unknown
): void {
  for (const event of action.events ?? []) {
    const payload = {
      objectType,
      recordId: recordId || null,
      action: action.name,
      result,
    };
    validateSchema(event.schema, payload, `${objectType}.${action.name} event`);
    insertEvent(db, {
      id: randomUUID(),
      type: event.type,
      actorAgentId: actorId(ctx),
      subject: recordId || objectType,
      payload,
    });
  }
}

function redactPaths(value: unknown, paths: string[] | undefined): unknown {
  if (!paths?.length || !value || typeof value !== "object") return value;
  const copy = structuredClone(value);
  for (const path of paths) {
    const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
    let cursor: unknown = copy;
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor =
        cursor && typeof cursor === "object"
          ? (cursor as Record<string, unknown>)[parts[index]!]
          : undefined;
    }
    if (cursor && typeof cursor === "object" && parts.length) {
      (cursor as Record<string, unknown>)[parts.at(-1)!] = "[REDACTED]";
    }
  }
  return copy;
}

function redactActionInput(input: unknown, action: ActionDef): unknown {
  return redactPaths(input, action.sensitiveInputPaths);
}

function redactActionOutput(output: unknown, action: ActionDef): unknown {
  return redactPaths(output, action.sensitiveOutputPaths);
}

function normalizeKernelError(error: unknown): KernelError {
  if (error instanceof KernelError) return error;
  if (error && typeof error === "object" && "status" in error) {
    return new KernelError(
      Number((error as { status: number }).status),
      error instanceof Error ? error.message : "Kernel operation failed",
      { code: "KERNEL_ADAPTER_ERROR" }
    );
  }
  return new KernelError(
    500,
    error instanceof Error ? error.message : "Kernel operation failed",
    { code: "KERNEL_INTERNAL_ERROR", retryable: true }
  );
}

/** Seed Records from plugin manifest after ObjectTypes are registered. */
export function seedRecords(
  db: AppDatabase,
  seeds: Array<{ objectType: string; data: RecordData }>,
  ctx: OperationContext
): RecordRow[] {
  ctx = requireContext(ctx);
  const tx = db.transaction(() => {
    const out: RecordRow[] = [];
    for (const seed of seeds) {
      if (seed.data.id == null || !String(seed.data.id).trim()) {
        throw new KernelError(400, `Seed for ${seed.objectType} requires deterministic data.id`);
      }
      let existing: RecordRow | null = null;
      try {
        existing = getRecord(db, seed.objectType, String(seed.data.id), ctx);
      } catch (err) {
        if (!(err instanceof KernelError) || err.status !== 404) throw err;
      }
      if (existing) {
        out.push(updateRecord(db, seed.objectType, existing.id, seed.data, ctx));
      } else {
        out.push(createRecord(db, seed.objectType, seed.data, ctx));
      }
    }
    return out;
  });
  return tx();
}

export function listVisibleObjectTypes(ctx: OperationContext): ObjectTypeDef[] {
  ctx = requireContext(ctx);
  return listObjectTypes().filter((def) => isVisible(def, ctx));
}
