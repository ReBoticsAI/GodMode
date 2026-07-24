import {
  Router,
  type Express,
  type IRouter,
  type NextFunction,
  type RequestHandler,
} from "express";
import type { EventEmitter } from "node:events";
import type { ObjectTypeDef, RecordData } from "@godmode/kernel";
import type { AppDatabase } from "../db.js";
import type {
  GodModePluginApi,
  GodModePluginRegister,
  GodmodePluginManifest,
  PluginBootContext,
  PluginHookName,
  PluginTenantContext,
  PluginToolDef,
  PluginRecordAdapter,
  PluginRecordContext,
} from "@godmode/plugin-api";
import { KERNEL_CLIENT_API_VERSION } from "@godmode/plugin-api";
import { getPluginHost } from "@godmode/plugin-host";
import { registerPageKinds } from "../kernel/kind-registry.js";
import {
  registerRecordAdapter,
  unregisterRecordAdapter,
  type OperationContext,
  type RecordAdapter,
} from "../kernel/adapter-registry.js";
import {
  registerObjectType,
  unregisterObjectType,
} from "../kernel/registry.js";
import {
  createRecord,
  deleteRecord,
  executeCollectionAction,
  executeRecordAction,
  getRecord,
  listRecords,
  updateRecord,
} from "../kernel/record-api.js";
import { getTenantDb } from "../tenant-registry.js";

type HookHandler = (ctx: PluginBootContext & PluginTenantContext) => void | Promise<void>;

export interface PluginRuntimeConfig {
  operatorTenantId: string;
  bus: EventEmitter;
}

export interface LoadedPlugin {
  manifest: GodmodePluginManifest;
  pluginRoot: string;
  api: GodModePluginApi;
}

interface PluginHookEntry {
  pluginId: string;
  handler: HookHandler;
}

interface PluginRouterEntry {
  pluginId: string;
  path: string;
  router: IRouter;
}

interface PluginMiddlewareEntry {
  pluginId: string;
  middleware: RequestHandler;
}

/**
 * Express cannot remove `app.use` layers. Keep a stable shell mounted once and
 * swap the active handler so plugin install/reload updates routes in-process.
 */
class RouteSlot {
  private active: RequestHandler = (_req, _res, next) => next();
  readonly shell: RequestHandler = (req, res, next) => this.active(req, res, next);
  mounted = false;

  swap(handler: RequestHandler | IRouter): void {
    this.active = handler as RequestHandler;
  }

  clear(): void {
    this.active = (_req, _res, next) => next();
  }
}

class MiddlewareSlot {
  private active: RequestHandler[] = [];
  readonly shell: RequestHandler = (req, res, next) => {
    let index = 0;
    const run = (err?: unknown) => {
      if (err !== undefined && err !== null) {
        next(err);
        return;
      }
      const mw = this.active[index++];
      if (!mw) {
        next();
        return;
      }
      try {
        mw(req, res, run as NextFunction);
      } catch (error) {
        next(error);
      }
    };
    run();
  };
  mounted = false;

  swap(handlers: RequestHandler[]): void {
    this.active = [...handlers];
  }

  clear(): void {
    this.active = [];
  }
}

export class PluginRuntime {
  private readonly hooks = new Map<PluginHookName, PluginHookEntry[]>();
  private readonly routers: PluginRouterEntry[] = [];
  private readonly middleware: PluginMiddlewareEntry[] = [];
  private readonly routeSlots = new Map<string, RouteSlot>();
  private readonly middlewareSlot = new MiddlewareSlot();
  private readonly tools: PluginToolDef[] = [];
  private readonly objectTypeDisposers: Array<{
    pluginId: string;
    dispose: () => void;
  }> = [];
  readonly loaded: LoadedPlugin[] = [];
  private config: PluginRuntimeConfig | null = null;
  private app: Express | null = null;

  configure(config: PluginRuntimeConfig): void {
    this.config = config;
  }

  /** Retain the Express app so post-boot install/reload can sync route slots. */
  setApp(app: Express): void {
    this.app = app;
  }

  hasApp(): boolean {
    return this.app !== null;
  }

  register(manifest: GodmodePluginManifest, pluginRoot: string, registerFn: GodModePluginRegister): void {
    const api = this.createApi(manifest, pluginRoot);
    registerFn(api);
    this.loaded.push({ manifest, pluginRoot, api });
  }

  registerManifestOnly(
    manifest: GodmodePluginManifest,
    pluginRoot: string
  ): void {
    if (this.hasPlugin(manifest.id)) this.unregister(manifest.id);
    const api = this.createApi(manifest, pluginRoot);
    this.loaded.push({ manifest, pluginRoot, api });
  }

  /**
   * Drop a loaded plugin's tools/hooks/routes/loaded entry so it can be
   * re-registered after a rebuild. Route slots stay mounted; inners are cleared
   * or swapped via {@link syncPluginRoutes}.
   */
  unregister(pluginId: string): boolean {
    const before = this.loaded.length;
    const affectedPaths = this.routers
      .filter((entry) => entry.pluginId === pluginId)
      .map((entry) => entry.path);
    this.loaded.splice(
      0,
      this.loaded.length,
      ...this.loaded.filter((p) => p.manifest.id !== pluginId)
    );
    for (let i = this.tools.length - 1; i >= 0; i--) {
      if (this.tools[i].pluginId === pluginId) this.tools.splice(i, 1);
    }
    for (let i = this.routers.length - 1; i >= 0; i--) {
      if (this.routers[i].pluginId === pluginId) this.routers.splice(i, 1);
    }
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      if (this.middleware[i].pluginId === pluginId) this.middleware.splice(i, 1);
    }
    for (const [name, entries] of this.hooks) {
      const next = entries.filter((e) => e.pluginId !== pluginId);
      if (next.length) this.hooks.set(name, next);
      else this.hooks.delete(name);
    }
    for (let index = this.objectTypeDisposers.length - 1; index >= 0; index -= 1) {
      const entry = this.objectTypeDisposers[index]!;
      if (entry.pluginId !== pluginId) continue;
      entry.dispose();
      this.objectTypeDisposers.splice(index, 1);
    }
    if (this.app) {
      this.syncPluginRoutes(undefined, affectedPaths);
    }
    return this.loaded.length < before;
  }

  hasPlugin(id: string): boolean {
    return this.loaded.some((p) => p.manifest.id === id);
  }

  getPlugin(id: string): LoadedPlugin | undefined {
    return this.loaded.find((p) => p.manifest.id === id);
  }

  allTools(): PluginToolDef[] {
    return [...this.tools];
  }

  getToolHandler(name: string): PluginToolDef | undefined {
    return this.tools.find((t) => t.name === name);
  }

  /**
   * Record a plugin route (same as `api.routes.mount`) and sync slots when the
   * app is already attached. Preferred over raw `ctx.app.use` in hooks.
   */
  mountPluginRoute(pluginId: string, path: string, router: IRouter): void {
    this.routers.push({ pluginId, path, router });
    if (this.app) this.syncPluginRoutes(pluginId);
  }

  /**
   * Ensure Express has stable shells for plugin middleware/paths and swap the
   * active handlers from the current registry. Safe to call after boot.
   */
  syncPluginRoutes(pluginId?: string, extraPaths: string[] = []): void {
    if (!this.app) return;

    this.ensureMiddlewareSlotMounted();
    this.middlewareSlot.swap(this.middleware.map((entry) => entry.middleware));

    const paths = new Set<string>(extraPaths);
    for (const entry of this.routers) {
      if (pluginId && entry.pluginId !== pluginId) continue;
      paths.add(entry.path);
    }
    if (!pluginId) {
      for (const path of this.routeSlots.keys()) paths.add(path);
      for (const entry of this.routers) paths.add(entry.path);
    }

    for (const path of paths) {
      this.ensureRouteSlotMounted(path);
      const routersForPath = this.routers.filter((entry) => entry.path === path);
      const slot = this.routeSlots.get(path)!;
      if (routersForPath.length === 0) {
        slot.clear();
        continue;
      }
      if (routersForPath.length === 1) {
        slot.swap(routersForPath[0]!.router);
        continue;
      }
      const composite = Router();
      for (const entry of routersForPath) {
        composite.use(entry.router);
      }
      slot.swap(composite);
    }
  }

  mountOn(app: Express): void {
    this.setApp(app);
    this.syncPluginRoutes();
  }

  private ensureMiddlewareSlotMounted(): void {
    if (!this.app || this.middlewareSlot.mounted) return;
    this.app.use(this.middlewareSlot.shell);
    this.middlewareSlot.mounted = true;
  }

  private ensureRouteSlotMounted(path: string): void {
    if (!this.app) return;
    let slot = this.routeSlots.get(path);
    if (!slot) {
      slot = new RouteSlot();
      this.routeSlots.set(path, slot);
    }
    if (slot.mounted) return;
    this.app.use(path, slot.shell);
    slot.mounted = true;
  }

  private bootContext(partial: Partial<PluginTenantContext> = {}): PluginBootContext & PluginTenantContext {
    if (!this.config) {
      throw new Error("PluginRuntime.configure() must be called first");
    }
    return {
      operatorTenantId: this.config.operatorTenantId,
      bus: this.config.bus,
      host: getPluginHost(),
      tenantId: partial.tenantId ?? this.config.operatorTenantId,
      userId: partial.userId,
      ...partial,
    } as PluginBootContext & PluginTenantContext;
  }

  async emitHook(
    name: PluginHookName,
    ctx: PluginBootContext & Partial<PluginTenantContext>
  ): Promise<void> {
    const handlers = this.hooks.get(name) ?? [];
    for (const { handler } of handlers) {
      await handler(ctx as PluginBootContext & PluginTenantContext);
    }
  }

  async emitHookForPlugin(
    pluginId: string,
    name: PluginHookName,
    ctx: PluginBootContext & Partial<PluginTenantContext>
  ): Promise<void> {
    const handlers = this.hooks.get(name) ?? [];
    for (const entry of handlers) {
      if (entry.pluginId !== pluginId) continue;
      await entry.handler(ctx as PluginBootContext & PluginTenantContext);
    }
  }

  async installTenant(tenantId: string, userId?: string): Promise<void> {
    for (const plugin of this.loaded) {
      await this.installPluginForTenant(plugin.manifest.id, tenantId, userId);
    }
  }

  async installPluginForTenant(pluginId: string, tenantId: string, userId?: string): Promise<void> {
    await this.emitHookForPlugin(pluginId, "tenant:install", this.bootContext({ tenantId, userId }));
  }

  buildToolContext(
    partial: Partial<PluginTenantContext> = {}
  ): PluginBootContext & PluginTenantContext {
    return this.bootContext(partial);
  }

  async uninstallPluginForTenant(pluginId: string, tenantId: string, userId?: string): Promise<void> {
    await this.emitHookForPlugin(pluginId, "tenant:uninstall", this.bootContext({ tenantId, userId }));
  }

  private createApi(manifest: GodmodePluginManifest, pluginRoot: string): GodModePluginApi {
    const self = this;
    const pluginId = manifest.id;
    const host = getPluginHost();
    const kernelContext = (ctx: PluginRecordContext): OperationContext => ({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      agentId: ctx.activeAgentId,
      role: ctx.role,
      source: "plugin",
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
      expectedVersion: ctx.expectedVersion,
      confirmationId: ctx.confirmationId,
      installedPluginIds: new Set([pluginId]),
      signal: ctx.signal,
      bus: self.config?.bus,
    });
    const kernelDb = (ctx: PluginRecordContext) =>
      host.getTenantDb(ctx.tenantId) as AppDatabase;
    const api: GodModePluginApi = {
      manifest: { id: manifest.id, version: manifest.version, name: manifest.name },
      pluginRoot,
      host,
      kernel: {
        apiVersion: KERNEL_CLIENT_API_VERSION,
        list(objectType, query, ctx) {
          return listRecords(
            kernelDb(ctx),
            objectType,
            query,
            kernelContext(ctx)
          );
        },
        get(objectType, id, ctx) {
          return getRecord(kernelDb(ctx), objectType, id, kernelContext(ctx));
        },
        create(objectType, data, ctx) {
          return createRecord(
            kernelDb(ctx),
            objectType,
            data,
            kernelContext(ctx)
          );
        },
        update(objectType, id, data, ctx) {
          return updateRecord(
            kernelDb(ctx),
            objectType,
            id,
            data,
            kernelContext(ctx)
          );
        },
        delete(objectType, id, ctx) {
          deleteRecord(kernelDb(ctx), objectType, id, kernelContext(ctx));
        },
        async runAction(objectType, action, input, ctx, id) {
          return id
            ? executeRecordAction(
                kernelDb(ctx),
                objectType,
                id,
                action,
                input,
                kernelContext(ctx)
              )
            : executeCollectionAction(
                kernelDb(ctx),
                objectType,
                action,
                input,
                kernelContext(ctx)
              );
        },
      },
      routes: {
        mount(path: string, router: IRouter) {
          self.mountPluginRoute(pluginId, path, router);
        },
        use(middleware: RequestHandler) {
          self.middleware.push({ pluginId, middleware });
          if (self.app) self.syncPluginRoutes(pluginId);
        },
      },
      tools: {
        register(tools: PluginToolDef[]) {
          for (const t of tools) {
            self.tools.push({
              ...t,
              pluginId,
              departments: t.departments ?? manifest.departments,
            });
          }
        },
      },
      pageKinds: {
        register(kinds: string[]) {
          registerPageKinds(kinds);
        },
      },
      objectTypes: {
        register(definition, pluginAdapter: PluginRecordAdapter) {
          const adapterId = `plugin:${pluginId}:${definition.name}`;
          const actions = definition.actions ?? [];
          for (const action of actions) {
            if (!pluginAdapter.actions?.[action.name]) {
              throw new Error(
                `Plugin ${pluginId} did not implement ${definition.name}.${action.name}`
              );
            }
          }
          const operationMethod = {
            list: pluginAdapter.list,
            get: pluginAdapter.get,
            create: pluginAdapter.create,
            update: pluginAdapter.update,
            delete: pluginAdapter.delete,
          };
          for (const operation of definition.operations ?? []) {
            if (!operationMethod[operation]) {
              throw new Error(
                `Plugin ${pluginId} did not implement ${definition.name}.${operation}`
              );
            }
          }
          const pluginContext = (ctx: OperationContext): PluginRecordContext => ({
            tenantId: ctx.tenantId ?? self.config?.operatorTenantId ?? "",
            userId: ctx.userId,
            activeAgentId: ctx.agentId,
            role: ctx.role,
            source: ctx.source,
            requestId: ctx.requestId,
            idempotencyKey: ctx.idempotencyKey,
            expectedVersion: ctx.expectedVersion,
            confirmationId: ctx.confirmationId,
            signal: ctx.signal,
          });
          const adapter: RecordAdapter = {
            id: adapterId,
            list: pluginAdapter.list
              ? (_db, _def, query, ctx) =>
                  pluginAdapter.list!(query, pluginContext(ctx))
              : undefined,
            get: pluginAdapter.get
              ? (_db, _def, id, ctx) =>
                  pluginAdapter.get!(id, pluginContext(ctx))
              : undefined,
            create: pluginAdapter.create
              ? (_db, _def, data, ctx) =>
                  pluginAdapter.create!(data, pluginContext(ctx))
              : undefined,
            update: pluginAdapter.update
              ? (_db, _def, id, data, ctx) =>
                  pluginAdapter.update!(id, data, pluginContext(ctx))
              : undefined,
            delete: pluginAdapter.delete
              ? (_db, _def, id, ctx) =>
                  pluginAdapter.delete!(id, pluginContext(ctx))
              : undefined,
            actions: Object.fromEntries(
              Object.entries(pluginAdapter.actions ?? {}).map(
                ([name, handler]) => [
                  name,
                  (
                    _db: AppDatabase,
                    _def: ObjectTypeDef,
                    id: string,
                    input: RecordData,
                    ctx: OperationContext
                  ) =>
                    handler(id, input, pluginContext(ctx)),
                ]
              )
            ),
          };
          registerRecordAdapter(adapter);
          const permissions =
            definition.permissions ??
            [
              { role: "viewer" as const, read: true },
              {
                role: "editor" as const,
                read: true,
                create: Boolean(pluginAdapter.create),
                update: Boolean(pluginAdapter.update),
                delete: Boolean(pluginAdapter.delete),
              },
              {
                role: "owner" as const,
                read: true,
                create: Boolean(pluginAdapter.create),
                update: Boolean(pluginAdapter.update),
                delete: Boolean(pluginAdapter.delete),
              },
              {
                role: "intelligence" as const,
                read: true,
                create: Boolean(pluginAdapter.create),
                update: Boolean(pluginAdapter.update),
                delete: Boolean(pluginAdapter.delete),
              },
            ];
          try {
            registerObjectType({
              ...definition,
              contractVersion: definition.contractVersion ?? 1,
              permissions,
              pluginId,
              storage: { kind: "adapter", adapterId },
            });
          } catch (error) {
            unregisterRecordAdapter(adapterId);
            throw error;
          }
          let disposed = false;
          const dispose = () => {
            if (disposed) return;
            disposed = true;
            unregisterObjectType(definition.name);
            unregisterRecordAdapter(adapterId);
          };
          self.objectTypeDisposers.push({ pluginId, dispose });
          return { dispose };
        },
      },
      hooks: {
        on(name: PluginHookName, handler: HookHandler) {
          const list = self.hooks.get(name) ?? [];
          list.push({ pluginId, handler });
          self.hooks.set(name, list);
        },
      },
      async installTenant(tenantId: string, userId?: string) {
        await executeCollectionAction(
          getTenantDb(tenantId),
          "CatalogInstall",
          "install_plugin",
          { plugin_id: pluginId },
          {
            tenantId,
            userId,
            agentId: userId ? undefined : `plugin:${pluginId}`,
            role: "owner",
            source: "plugin",
            installedPluginIds: new Set([pluginId]),
            bus: self.config?.bus,
          }
        );
      },
    };
    return api;
  }
}

export const pluginRuntime = new PluginRuntime();
