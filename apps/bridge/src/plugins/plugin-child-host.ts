import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type RequestHandler } from "express";
import { getPluginHost } from "@godmode/plugin-host";
import type { GodmodePluginManifest } from "@godmode/plugin-api";
import { registerPageKinds } from "../kernel/kind-registry.js";
import {
  createRecord,
  deleteRecord,
  executeCollectionAction,
  executeRecordAction,
  getRecord,
  listRecords,
  updateRecord,
} from "../kernel/record-api.js";
import type { AppDatabase } from "../db.js";
import type { OperationContext } from "../kernel/adapter-registry.js";
import { getTenantDb } from "../tenant-registry.js";
import { config } from "../config.js";
import {
  assertExternalUrlAllowed,
  assertRecordAllowed,
  assertToolAllowed,
  resolveCapabilityGrants,
} from "../services/plugin-capabilities.js";
import { notifyPluginLoopFailure } from "../services/plugin-loop-error.js";
import type { CoreDatabase } from "../core-db.js";
import { applyCommunityStructureInsert } from "./community-structure-seed.js";
import { pluginRuntime } from "./runtime.js";
import {
  RpcPeer,
  isRpcMsg,
  serializeFetchResponse,
  type RpcMsg,
} from "./plugin-rpc.js";
import {
  getPluginChild,
  registerPluginChild,
  unregisterPluginChild,
} from "./plugin-child-registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const liveChildren = new Map<string, ChildProcess>();

export type PluginChildFailureNotify = {
  db?: CoreDatabase;
  tenantId?: string;
  userId?: string;
};

let failureNotify: PluginChildFailureNotify | null = null;

export function setPluginChildFailureNotify(
  ctx: PluginChildFailureNotify | null
): void {
  failureNotify = ctx;
}

function childScriptPath(): string {
  const ts = path.join(here, "plugin-child.ts");
  const js = path.join(here, "plugin-child.js");
  return fs.existsSync(js) ? js : ts;
}

function serializeInit(init: unknown): RequestInit | undefined {
  if (!init || typeof init !== "object") return undefined;
  const obj = init as Record<string, unknown>;
  return {
    method: typeof obj.method === "string" ? obj.method : undefined,
    headers: obj.headers as RequestInit["headers"],
    body: typeof obj.body === "string" ? obj.body : undefined,
  };
}

function sendChildMsg(child: ChildProcess, msg: RpcMsg): void {
  if (!child.connected) return;
  try {
    child.send(msg, () => {
      /* ignore EPIPE after the child has already exited */
    });
  } catch {
    /* ignore */
  }
}

function childStillRunning(child: ChildProcess): boolean {
  return child.exitCode == null && child.signalCode == null;
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs = 2_000
): Promise<void> {
  if (!childStillRunning(child)) return;
  const done = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  sendChildMsg(child, { kind: "req", id: 0, method: "shutdown" });
  child.kill("SIGTERM");
  const killer = setTimeout(() => {
    if (childStillRunning(child)) child.kill("SIGKILL");
  }, timeoutMs);
  await done;
  clearTimeout(killer);
}

function childRouteProxy(port: number): RequestHandler {
  return (req, res) => {
    const headers = { ...req.headers };
    delete headers.connection;
    headers.host = `127.0.0.1:${port}`;
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: req.originalUrl,
        method: req.method,
        headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      }
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: err.message });
        return;
      }
      res.end();
    });
    req.pipe(upstream);
  };
}

function marketplacePluginsRoot(): string {
  return config.marketplace.pluginsDir;
}

function kernelOp(
  pluginId: string,
  pluginRoot: string,
  op: string,
  args: unknown[]
): unknown {
  const grants = resolveCapabilityGrants({
    pluginRoot,
    marketplacePluginsRoot: marketplacePluginsRoot(),
  });
  const objectType = String(args[0] ?? "");
  assertRecordAllowed(grants, objectType);
  const ctxRaw = (args[args.length - 1] ?? {}) as Record<string, unknown>;
  const tenantId = String(ctxRaw.tenantId ?? "");
  if (!tenantId) throw new Error("kernel RPC requires ctx.tenantId");
  const db = getTenantDb(tenantId) as AppDatabase;
  const opCtx: OperationContext = {
    tenantId,
    userId: typeof ctxRaw.userId === "string" ? ctxRaw.userId : undefined,
    agentId:
      typeof ctxRaw.activeAgentId === "string" ? ctxRaw.activeAgentId : undefined,
    role:
      ctxRaw.role === "viewer" ||
      ctxRaw.role === "editor" ||
      ctxRaw.role === "owner" ||
      ctxRaw.role === "intelligence"
        ? ctxRaw.role
        : "intelligence",
    source: "plugin",
    requestId: typeof ctxRaw.requestId === "string" ? ctxRaw.requestId : undefined,
    installedPluginIds: new Set([pluginId]),
  };
  if (op === "list") {
    return listRecords(db, objectType, (args[1] ?? {}) as never, opCtx);
  }
  if (op === "get") {
    return getRecord(db, objectType, String(args[1]), opCtx);
  }
  if (op === "create") {
    return createRecord(db, objectType, (args[1] ?? {}) as never, opCtx);
  }
  if (op === "update") {
    return updateRecord(
      db,
      objectType,
      String(args[1]),
      (args[2] ?? {}) as never,
      opCtx
    );
  }
  if (op === "delete") {
    deleteRecord(db, objectType, String(args[1]), opCtx);
    return { ok: true };
  }
  if (op === "runAction") {
    const action = String(args[1]);
    const input = (args[2] ?? {}) as never;
    const id = args[4] != null ? String(args[4]) : undefined;
    return id
      ? executeRecordAction(db, objectType, id, action, input, opCtx)
      : executeCollectionAction(db, objectType, action, input, opCtx);
  }
  throw new Error(`Unknown kernel op: ${op}`);
}

export async function loadCommunityPluginInChild(opts: {
  manifest: GodmodePluginManifest;
  pluginRoot: string;
  entryPath: string;
}): Promise<{ pid: number }> {
  const { manifest, pluginRoot, entryPath } = opts;
  const pluginId = manifest.id;
  const previous = liveChildren.get(pluginId);
  if (previous && childStillRunning(previous)) {
    await waitForChildExit(previous);
  }
  unregisterPluginChild(pluginId)?.kill();

  const script = childScriptPath();
  const child: ChildProcess = fork(script, [], {
    execArgv: script.endsWith(".ts") ? ["--import", "tsx"] : [],
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      GODMODE_PLUGIN_ROOT: pluginRoot,
      GODMODE_PLUGIN_ENTRY: entryPath,
      GODMODE_PLUGIN_ID: pluginId,
    },
  });
  if (!child.pid) {
    throw new Error(`Failed to fork Community plugin child for ${pluginId}`);
  }
  liveChildren.set(pluginId, child);
  child.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
    console.warn(`[plugin-child ${pluginId}]`, err.message);
  });

  let expectedExit = false;
  let ready = false;
  const grants = resolveCapabilityGrants({
    pluginRoot,
    marketplacePluginsRoot: marketplacePluginsRoot(),
  });

  const peer = new RpcPeer((msg) => {
    sendChildMsg(child, msg);
  }, async (method, params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "host.externalFetch") {
      const allowed = assertExternalUrlAllowed(grants, String(p.url ?? ""));
      const res = await fetch(allowed, serializeInit(p.init));
      return await serializeFetchResponse(res);
    }
    if (method === "host.bridgeFetch") {
      const res = await getPluginHost().bridgeFetch(
        String(p.path ?? ""),
        serializeInit(p.init)
      );
      return await serializeFetchResponse(res);
    }
    if (method.startsWith("kernel.")) {
      return kernelOp(pluginId, pluginRoot, method.slice("kernel.".length), Array.isArray(p.args) ? p.args : []);
    }
    if (method === "tools.register") {
      assertToolAllowed(grants, String(p.name ?? ""));
      pluginRuntime.registerChildTool(pluginId, {
        name: String(p.name),
        description: String(p.description ?? ""),
        mode: p.mode === "confirm" ? "confirm" : "auto",
        departments: Array.isArray(p.departments)
          ? p.departments.map(String)
          : manifest.departments,
        parameters:
          p.parameters && typeof p.parameters === "object"
            ? (p.parameters as Record<string, unknown>)
            : undefined,
      });
      return { ok: true };
    }
    if (method === "hooks.on") {
      pluginRuntime.attachChildHook(pluginId, String(p.name ?? ""));
      return { ok: true };
    }
    if (method === "pageKinds.register") {
      const kinds = Array.isArray(p.kinds) ? p.kinds.map(String) : [];
      registerPageKinds(kinds);
      return { ok: true };
    }
    if (method === "routes.mount") {
      const mountPath = String(p.path ?? "");
      const port = Number(p.port);
      if (!mountPath || !Number.isFinite(port)) {
        throw new Error("routes.mount requires path and port");
      }
      const router = Router();
      router.use(childRouteProxy(port));
      pluginRuntime.mountPluginRoute(pluginId, mountPath, router);
      return { ok: true };
    }
    if (method === "installTenant") {
      await pluginRuntime.installPluginForTenant(
        pluginId,
        String(p.tenantId ?? ""),
        typeof p.userId === "string" ? p.userId : undefined
      );
      return { ok: true };
    }
    if (method === "structure.insertIgnore") {
      const tenantId = String(p.tenantId ?? "").trim();
      if (!tenantId) {
        throw new Error("structure.insertIgnore requires tenantId");
      }
      const sql = String(p.sql ?? "");
      const params = Array.isArray(p.params) ? p.params : [];
      return applyCommunityStructureInsert(
        getTenantDb(tenantId) as AppDatabase,
        sql,
        params
      );
    }
    throw new Error(`Unknown parent RPC: ${method}`);
  });

  const handle = {
    pid: child.pid,
    kill() {
      expectedExit = true;
      sendChildMsg(child, { kind: "req", id: 0, method: "shutdown" });
      child.kill("SIGTERM");
    },
    call: (method: string, params?: unknown) => peer.call(method, params),
  };
  registerPluginChild(pluginId, handle);

  let settleReady: (() => void) | undefined;
  let failReady: ((err: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    failReady = reject;
  });

  child.on("message", (raw) => {
    if (!isRpcMsg(raw)) return;
    if (raw.kind === "evt" && raw.method === "ready") {
      ready = true;
      settleReady?.();
      return;
    }
    if (raw.kind === "evt" && raw.method === "fatal") {
      const message =
        raw.params && typeof raw.params === "object" && "message" in raw.params
          ? String((raw.params as { message: unknown }).message)
          : "plugin child fatal";
      peer.rejectAll(new Error(message));
      failReady?.(new Error(message));
      return;
    }
    peer.handle(raw);
  });

  child.on("exit", (code, signal) => {
    if (liveChildren.get(pluginId) === child) {
      liveChildren.delete(pluginId);
    }
    const current = getPluginChild(pluginId);
    if (current?.pid === child.pid) {
      unregisterPluginChild(pluginId);
    }
    peer.rejectAll(new Error(`plugin child exited (${code ?? signal ?? "unknown"})`));
    if (!ready) {
      failReady?.(
        new Error(`Community plugin child exited before ready (${code})`)
      );
    }
    if (!expectedExit && ready) {
      notifyPluginLoopFailure({
        failureClass: "install",
        pluginId,
        message: `Community plugin child exited (${code ?? signal ?? "unknown"})`,
        tenantId: failureNotify?.tenantId,
        userId: failureNotify?.userId,
        db: failureNotify?.db,
      });
      if (pluginRuntime.hasPlugin(pluginId)) {
        pluginRuntime.unregister(pluginId);
      }
    }
  });

  const timer = setTimeout(() => {
    expectedExit = true;
    child.kill("SIGKILL");
    failReady?.(
      new Error(`Community plugin child did not become ready: ${pluginId}`)
    );
  }, 30_000);
  try {
    await readyPromise;
  } finally {
    clearTimeout(timer);
  }

  pluginRuntime.markChildLoaded(manifest, pluginRoot);
  return { pid: child.pid };
}

export function killPluginChild(pluginId: string): void {
  unregisterPluginChild(pluginId)?.kill();
}

export function communityPluginChildPid(
  pluginId: string
): number | undefined {
  return getPluginChild(pluginId)?.pid;
}

export async function callPluginChild(
  pluginId: string,
  method: string,
  params?: unknown
): Promise<unknown> {
  const child = getPluginChild(pluginId);
  if (!child) throw new Error(`No Community plugin child for ${pluginId}`);
  return child.call(method, params);
}
