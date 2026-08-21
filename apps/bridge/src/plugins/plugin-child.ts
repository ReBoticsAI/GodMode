/**
 * Community plugin child process (#559).
 * No Bridge DB, no getPluginHost() live services, no shared heap.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import express, { Router, type Express } from "express";
import { setPluginHost } from "@godmode/plugin-host";
import type {
  GodModePluginApi,
  GodModePluginRegister,
  PluginBootContext,
  PluginHookName,
  PluginHostServices,
  PluginTenantContext,
  PluginToolDef,
  PublisherConnectorDef,
} from "@godmode/plugin-api";
import { KERNEL_CLIENT_API_VERSION } from "@godmode/plugin-api";
import {
  RpcPeer,
  deserializeFetchResponse,
  type SerializedFetchResult,
} from "./plugin-rpc.js";

const pluginRoot = process.env.GODMODE_PLUGIN_ROOT;
const entryPath = process.env.GODMODE_PLUGIN_ENTRY;
const pluginId = process.env.GODMODE_PLUGIN_ID;

if (!pluginRoot || !entryPath || !pluginId) {
  console.error("[plugin-child] missing GODMODE_PLUGIN_ROOT/ENTRY/ID");
  process.exit(1);
}

if (!process.send) {
  console.error("[plugin-child] IPC channel missing");
  process.exit(1);
}

const bootWork: Promise<unknown>[] = [];

function track(work: Promise<unknown>): void {
  bootWork.push(work);
}

const sendParent = (msg: unknown) => {
  process.send?.(msg);
};

const hookHandlers = new Map<
  PluginHookName,
  Array<(ctx: PluginBootContext & PluginTenantContext) => void | Promise<void>>
>();
const toolHandlers = new Map<string, PluginToolDef["handler"]>();

/** Serial host RPCs so parent INSERT OR IGNORE order is preserved (FK parents first). */
let hostQueue: Promise<unknown> = Promise.resolve();
const pendingHostWork: Promise<unknown>[] = [];

function enqueueHost(work: () => Promise<unknown>): void {
  hostQueue = hostQueue.then(work);
  pendingHostWork.push(hostQueue);
}

async function flushHostWork(): Promise<void> {
  try {
    await Promise.all(pendingHostWork.splice(0, pendingHostWork.length));
  } finally {
    hostQueue = Promise.resolve();
  }
}

let httpApp: Express | null = null;
let httpPort: number | null = null;
let httpReady: Promise<number> | null = null;

function denied(name: string): never {
  throw new Error(
    `Community plugin child cannot use ${name}. Use grant-gated host/kernel IPC instead.`
  );
}

async function ensureHttpPort(): Promise<number> {
  if (httpPort != null) return httpPort;
  if (httpReady) return httpReady;
  httpApp = express();
  httpApp.use(express.json({ limit: "2mb" }));
  httpReady = new Promise((resolve, reject) => {
    const server = createServer(httpApp!);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error("plugin child HTTP listen failed"));
        return;
      }
      httpPort = addr.port;
      resolve(addr.port);
    });
    server.on("error", reject);
  });
  return httpReady;
}

const peer = new RpcPeer(sendParent, async (method, params) => {
  const p = (params ?? {}) as Record<string, unknown>;
  if (method === "tools.call") {
    const handler = toolHandlers.get(String(p.name ?? ""));
    if (!handler) throw new Error(`Unknown child tool: ${String(p.name)}`);
    const ctx = {
      ...(typeof p.ctx === "object" && p.ctx ? p.ctx : {}),
      host: childHost,
    } as PluginBootContext & PluginTenantContext;
    try {
      const result = await handler(p.args as Record<string, unknown>, ctx);
      await flushHostWork();
      return result;
    } catch (err) {
      await flushHostWork().catch(() => undefined);
      throw err;
    }
  }
  if (method === "hooks.emit") {
    const name = p.name as PluginHookName;
    const handlers = hookHandlers.get(name) ?? [];
    const ctx = {
      ...(typeof p.ctx === "object" && p.ctx ? p.ctx : {}),
      host: childHost,
    } as PluginBootContext & PluginTenantContext;
    try {
      for (const handler of handlers) {
        await handler(ctx);
      }
      await flushHostWork();
    } catch (err) {
      await flushHostWork().catch(() => undefined);
      throw err;
    }
    return { ok: true };
  }
  if (method === "shutdown") {
    setTimeout(() => process.exit(0), 10);
    return { ok: true };
  }
  throw new Error(`Unknown child method: ${method}`);
});

process.on("message", (raw) => peer.handle(raw));

function structureSeedDb(tenantId: string) {
  return {
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          enqueueHost(() =>
            peer.call("structure.insertIgnore", { tenantId, sql, params })
          );
          return { changes: 1 };
        },
        get() {
          denied("host.getTenantDb.get");
        },
        all() {
          denied("host.getTenantDb.all");
        },
        iterate() {
          denied("host.getTenantDb.iterate");
        },
      };
    },
    exec() {
      denied("host.getTenantDb.exec");
    },
    pragma() {
      denied("host.getTenantDb.pragma");
    },
    transaction() {
      denied("host.getTenantDb.transaction");
    },
  };
}

const childHost: PluginHostServices = {
  getTenantDb(tenantId: string) {
    if (!tenantId.trim()) {
      throw new Error("host.getTenantDb requires tenantId");
    }
    return structureSeedDb(tenantId);
  },
  getReqTenantDb: () => denied("host.getReqTenantDb"),
  openPluginDb: () => denied("host.openPluginDb"),
  createPluginRouter: () => Router(),
  getTimeseriesStore: () => denied("host.getTimeseriesStore"),
  bootstrapTradingDepartment: () => denied("host.bootstrapTradingDepartment"),
  async bridgeFetch(path: string, init?: RequestInit) {
    const result = (await peer.call("host.bridgeFetch", {
      path,
      init: serializeInit(init),
    })) as SerializedFetchResult;
    return deserializeFetchResponse(result);
  },
  async externalFetch(url: string | URL, init?: RequestInit) {
    const result = (await peer.call("host.externalFetch", {
      url: String(url),
      init: serializeInit(init),
    })) as SerializedFetchResult;
    return deserializeFetchResponse(result);
  },
  mountPluginRoute() {
    denied("host.mountPluginRoute");
  },
  emitPlatformEvent() {
    denied("host.emitPlatformEvent");
  },
  registerHealthProbe() {
    denied("host.registerHealthProbe");
  },
  registerIpcEnqueue() {
    denied("host.registerIpcEnqueue");
  },
  enqueueIpcLine() {
    denied("host.enqueueIpcLine");
  },
  getPluginScheduler() {
    return null;
  },
  registerPluginScheduler() {
    denied("host.registerPluginScheduler");
  },
  registerSystemEventHandler() {
    denied("host.registerSystemEventHandler");
  },
};

setPluginHost(childHost);

function serializeInit(init?: RequestInit): unknown {
  if (!init) return undefined;
  return {
    method: init.method,
    headers: init.headers,
    body: typeof init.body === "string" ? init.body : undefined,
  };
}

function kernelCall(op: string) {
  return (...args: unknown[]) => peer.call(`kernel.${op}`, { args });
}

const api: GodModePluginApi = {
  manifest: { id: pluginId, version: "0", name: pluginId },
  pluginRoot,
  host: childHost,
  kernel: {
    apiVersion: KERNEL_CLIENT_API_VERSION,
    list: kernelCall("list") as unknown as GodModePluginApi["kernel"]["list"],
    get: kernelCall("get") as unknown as GodModePluginApi["kernel"]["get"],
    create: kernelCall("create") as unknown as GodModePluginApi["kernel"]["create"],
    update: kernelCall("update") as unknown as GodModePluginApi["kernel"]["update"],
    delete: kernelCall("delete") as unknown as GodModePluginApi["kernel"]["delete"],
    runAction: kernelCall("runAction") as unknown as GodModePluginApi["kernel"]["runAction"],
  },
  routes: {
    mount(routePath, router) {
      track(
        (async () => {
          const port = await ensureHttpPort();
          httpApp!.use(routePath, router);
          await peer.call("routes.mount", { path: routePath, port });
        })()
      );
    },
    use() {
      denied("routes.use");
    },
  },
  tools: {
    register(tools: PluginToolDef[]) {
      for (const tool of tools) {
        if (tool.handler) toolHandlers.set(tool.name, tool.handler);
        track(
          peer.call("tools.register", {
            name: tool.name,
            description: tool.description,
            mode: tool.mode,
            departments: tool.departments,
            parameters: tool.parameters,
          })
        );
      }
    },
  },
  pageKinds: {
    register(kinds: string[]) {
      track(peer.call("pageKinds.register", { kinds }));
    },
  },
  publisherConnectors: {
    register(connectors: PublisherConnectorDef[]) {
      track(peer.call("publisherConnectors.register", { connectors }));
    },
  },
  objectTypes: {
    register() {
      denied("objectTypes.register");
    },
  },
  hooks: {
    on(hook, handler) {
      const list = hookHandlers.get(hook) ?? [];
      list.push(handler);
      hookHandlers.set(hook, list);
      track(peer.call("hooks.on", { name: hook }));
    },
  },
  async installTenant(tenantId: string, userId?: string) {
    await peer.call("installTenant", { tenantId, userId });
  },
};

async function main(): Promise<void> {
  const url = pathToFileURL(entryPath!).href;
  const mod = (await import(url)) as {
    default?: GodModePluginRegister;
    register?: GodModePluginRegister;
  };
  const register = mod.default ?? mod.register;
  if (typeof register !== "function") {
    throw new Error(`Plugin entry must export default or register: ${entryPath}`);
  }
  await Promise.resolve(register(api));
  await Promise.all(bootWork);
  sendParent({ kind: "evt", method: "ready" });
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  sendParent({ kind: "evt", method: "fatal", params: { message } });
  process.exit(1);
});
