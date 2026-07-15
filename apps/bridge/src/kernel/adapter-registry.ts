import type { EventEmitter } from "node:events";
import type { AppDatabase } from "../db.js";
import type {
  ActionDef,
  ListRecordsResult,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";

export type RecordOperation = "list" | "get" | "create" | "update" | "delete";

export interface RecordQuery {
  parentId?: string | null;
  limit?: number;
  offset?: number;
  filters?: Record<string, unknown>;
  sort?: string;
  direction?: "asc" | "desc";
}

export interface OperationContext {
  tenantId?: string;
  userId?: string;
  isAdmin?: boolean;
  role: "viewer" | "editor" | "owner" | "intelligence";
  agentId?: string;
  source: "http" | "agent" | "plugin" | "system";
  bus?: EventEmitter;
  /** Plugin ids installed for the active tenant. */
  installedPluginIds?: ReadonlySet<string>;
  requestId?: string;
  idempotencyKey?: string;
  expectedVersion?: string;
  confirmation?: {
    actorId: string;
    objectType: string;
    action: string;
    inputHash: string;
    expiresAt: string;
    recordId?: string;
    resourceVersion?: string;
  };
  confirmationId?: string;
  /** Set only after the existing agent confirmation policy approved this call. */
  trustedConfirmation?: boolean;
  signal?: AbortSignal;
  data?: {
    tenantDb: AppDatabase;
    coreDb: AppDatabase;
    declaredDatabase: "tenant" | "core";
  };
  /** Set only by the Bridge's internal system-context factory. */
  systemCapability?: symbol;
}

export interface RecordPolicy {
  authorize?(
    operation: RecordOperation | "action",
    def: ObjectTypeDef,
    ctx: OperationContext,
    row?: RecordRow | null,
    action?: ActionDef
  ): boolean | void;
  project?(def: ObjectTypeDef, row: RecordRow, ctx: OperationContext): RecordRow;
}

export interface RecordAdapter {
  id: string;
  policy?: RecordPolicy;
  list?(db: AppDatabase, def: ObjectTypeDef, query: RecordQuery, ctx: OperationContext): ListRecordsResult;
  get?(db: AppDatabase, def: ObjectTypeDef, id: string, ctx: OperationContext): RecordRow | null;
  create?(db: AppDatabase, def: ObjectTypeDef, data: RecordData, ctx: OperationContext): RecordRow;
  update?(
    db: AppDatabase,
    def: ObjectTypeDef,
    id: string,
    data: RecordData,
    ctx: OperationContext
  ): RecordRow;
  delete?(db: AppDatabase, def: ObjectTypeDef, id: string, ctx: OperationContext): void;
  actions?: Record<
    string,
    (
      db: AppDatabase,
      def: ObjectTypeDef,
      id: string,
      input: RecordData,
      ctx: OperationContext
    ) => unknown | Promise<unknown>
  >;
}

const adapters = new Map<string, RecordAdapter>();
let kernelBus: EventEmitter | undefined;

export function setKernelEventBus(bus: EventEmitter): void {
  kernelBus = bus;
}

export function withKernelEventBus(ctx: OperationContext): OperationContext {
  return ctx.bus || !kernelBus ? ctx : { ...ctx, bus: kernelBus };
}

export function registerRecordAdapter(adapter: RecordAdapter): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`Record adapter already registered: ${adapter.id}`);
  }
  adapters.set(adapter.id, adapter);
}

export function getRecordAdapter(id: string): RecordAdapter | undefined {
  return adapters.get(id);
}

export function hasRecordAdapter(id: string): boolean {
  return adapters.has(id);
}

export function unregisterRecordAdapter(id: string): void {
  adapters.delete(id);
}
