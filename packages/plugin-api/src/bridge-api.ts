import type { Express, IRouter, RequestHandler } from "express";
import type { EventEmitter } from "node:events";
import type { PluginHostServices } from "./host-services.js";

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

export interface GodModePluginApi {
  readonly manifest: { id: string; version: string; name: string };
  readonly pluginRoot: string;
  readonly host: PluginHostServices;

  routes: {
    mount(path: string, router: IRouter): void;
    use(middleware: RequestHandler): void;
  };

  tools: {
    register(tools: PluginToolDef[]): void;
  };

  hooks: {
    on(hook: PluginHookName, handler: (ctx: PluginBootContext & PluginTenantContext) => void | Promise<void>): void;
  };

  installTenant(tenantId: string, userId?: string): Promise<void>;
}

export type GodModePluginRegister = (api: GodModePluginApi) => void | Promise<void>;
