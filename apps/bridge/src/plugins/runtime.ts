import type { Express, IRouter, RequestHandler } from "express";
import type { EventEmitter } from "node:events";
import type {
  GodModePluginApi,
  GodModePluginRegister,
  GodmodePluginManifest,
  PluginBootContext,
  PluginHookName,
  PluginTenantContext,
  PluginToolDef,
} from "@godmode/plugin-api";
import { getPluginHost } from "@godmode/plugin-host";

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

export class PluginRuntime {
  private readonly hooks = new Map<PluginHookName, PluginHookEntry[]>();
  private readonly routers: Array<{ path: string; router: IRouter }> = [];
  private readonly middleware: RequestHandler[] = [];
  private readonly tools: PluginToolDef[] = [];
  readonly loaded: LoadedPlugin[] = [];
  private config: PluginRuntimeConfig | null = null;

  configure(config: PluginRuntimeConfig): void {
    this.config = config;
  }

  register(manifest: GodmodePluginManifest, pluginRoot: string, registerFn: GodModePluginRegister): void {
    const api = this.createApi(manifest, pluginRoot);
    registerFn(api);
    this.loaded.push({ manifest, pluginRoot, api });
  }

  /**
   * Drop a loaded plugin's tools/hooks/loaded entry so it can be re-registered
   * after a rebuild. Does not unmount Express routes already attached at boot.
   */
  unregister(pluginId: string): boolean {
    const before = this.loaded.length;
    this.loaded.splice(
      0,
      this.loaded.length,
      ...this.loaded.filter((p) => p.manifest.id !== pluginId)
    );
    for (let i = this.tools.length - 1; i >= 0; i--) {
      if (this.tools[i].pluginId === pluginId) this.tools.splice(i, 1);
    }
    for (const [name, entries] of this.hooks) {
      const next = entries.filter((e) => e.pluginId !== pluginId);
      if (next.length) this.hooks.set(name, next);
      else this.hooks.delete(name);
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

  mountOn(app: Express): void {
    for (const mw of this.middleware) {
      app.use(mw);
    }
    for (const { path, router } of this.routers) {
      app.use(path, router);
    }
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
    const api: GodModePluginApi = {
      manifest: { id: manifest.id, version: manifest.version, name: manifest.name },
      pluginRoot,
      host,
      routes: {
        mount(path: string, router: IRouter) {
          self.routers.push({ path, router });
        },
        use(middleware: RequestHandler) {
          self.middleware.push(middleware);
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
      hooks: {
        on(name: PluginHookName, handler: HookHandler) {
          const list = self.hooks.get(name) ?? [];
          list.push({ pluginId, handler });
          self.hooks.set(name, list);
        },
      },
      async installTenant(tenantId: string, userId?: string) {
        await self.installPluginForTenant(pluginId, tenantId, userId);
      },
    };
    return api;
  }
}

export const pluginRuntime = new PluginRuntime();
