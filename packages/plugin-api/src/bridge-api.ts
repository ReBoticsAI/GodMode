import type { Express, IRouter, RequestHandler } from "express";
import type { EventEmitter } from "node:events";
import type { PluginHostServices } from "./host-services.js";
import type {
  ListRecordsResult,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import type { KernelClientApiVersion } from "./kernel-client.js";

export type PluginHookName =
  | "boot"
  | "tenant:install"
  | "tenant:uninstall"
  | "server:beforeListen"
  | "server:afterListen"
  | "server:shutdown";

export interface PluginBootContext {
  operatorTenantId: string;
  bus: EventEmitter;
  operatorDb?: unknown;
  host: PluginHostServices;
  app?: Express;
  broadcast?: (payload: object) => void;
}

export interface PluginTenantContext {
  tenantId: string;
  userId?: string;
  activeAgentId?: string;
  activeSubtaskCardId?: string;
  activeTaskCardId?: string;
}

export type PluginToolHandler = (
  args: Record<string, unknown>,
  ctx: PluginBootContext & PluginTenantContext
) => Promise<unknown> | unknown;

export interface PluginToolDef {
  name: string;
  description: string;
  mode?: "auto" | "confirm";
  departments?: string[];
  parameters?: Record<string, unknown>;
  handler?: PluginToolHandler;
  pluginId?: string;
}

export interface PluginRecordContext extends PluginTenantContext {
  role: "viewer" | "editor" | "owner" | "intelligence";
  source: "http" | "agent" | "plugin" | "system";
  requestId?: string;
  idempotencyKey?: string;
  expectedVersion?: string;
  confirmationId?: string;
  signal?: AbortSignal;
}

export interface PluginRecordQuery {
  parentId?: string | null;
  limit?: number;
  offset?: number;
  filters?: Record<string, unknown>;
  sort?: string;
  direction?: "asc" | "desc";
}

export interface PluginRecordAdapter {
  list?(
    query: PluginRecordQuery,
    ctx: PluginRecordContext
  ): ListRecordsResult;
  get?(
    id: string,
    ctx: PluginRecordContext
  ): RecordRow | null;
  create?(
    data: RecordData,
    ctx: PluginRecordContext
  ): RecordRow;
  update?(
    id: string,
    data: RecordData,
    ctx: PluginRecordContext
  ): RecordRow;
  delete?(id: string, ctx: PluginRecordContext): void;
  actions?: Record<
    string,
    (
      id: string,
      input: RecordData,
      ctx: PluginRecordContext
    ) => unknown | Promise<unknown>
  >;
}

export interface PluginRegistration {
  dispose(): void;
}

export interface PluginKernelClient {
  readonly apiVersion: KernelClientApiVersion;
  list(
    objectType: string,
    query: PluginRecordQuery,
    ctx: PluginRecordContext
  ): ListRecordsResult;
  get(
    objectType: string,
    id: string,
    ctx: PluginRecordContext
  ): RecordRow;
  create(
    objectType: string,
    data: RecordData,
    ctx: PluginRecordContext
  ): RecordRow;
  update(
    objectType: string,
    id: string,
    data: RecordData,
    ctx: PluginRecordContext
  ): RecordRow;
  delete(
    objectType: string,
    id: string,
    ctx: PluginRecordContext
  ): void;
  runAction(
    objectType: string,
    action: string,
    input: RecordData,
    ctx: PluginRecordContext,
    id?: string
  ): Promise<unknown>;
}

export interface GodModePluginApi {
  readonly manifest: { id: string; version: string; name: string };
  readonly pluginRoot: string;
  readonly host: PluginHostServices;
  readonly kernel: PluginKernelClient;

  routes: {
    mount(path: string, router: IRouter): void;
    use(middleware: RequestHandler): void;
  };

  tools: {
    register(tools: PluginToolDef[]): void;
  };

  /** Register renderer kind names on Bridge for metadata/tool validation. */
  pageKinds: {
    register(kinds: string[]): void;
  };

  objectTypes: {
    register(
      definition: ObjectTypeDef,
      adapter: PluginRecordAdapter
    ): PluginRegistration;
  };

  hooks: {
    on(hook: PluginHookName, handler: (ctx: PluginBootContext & PluginTenantContext) => void | Promise<void>): void;
  };

  installTenant(tenantId: string, userId?: string): Promise<void>;
}

export type GodModePluginRegister = (api: GodModePluginApi) => void | Promise<void>;
