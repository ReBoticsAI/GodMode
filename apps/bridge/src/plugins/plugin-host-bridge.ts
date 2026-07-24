import { Router } from "express";
import { getTenantDb } from "../tenant-registry.js";
import type { AppDatabase } from "../db.js";
import { tenantDbMiddleware } from "../services/auth/middleware.js";
import { getTimeseriesStore } from "../services/timeseries-store.js";
import { emitEvent } from "../services/event-bus.js";
import {
  appendCardComment,
  findCardsAwaitingRef,
  markCardAwaitingTerminal,
} from "../services/card-awaiting.js";
import {
  setPluginHost,
  type PluginHostServices,
  type PluginSchedulerHost,
  type TenantDb,
  type HealthProbeFn,
  type IpcEnqueueFn,
} from "@godmode/plugin-host";
import { config } from "../config.js";
import {
  createRecord,
  createSystemOperationContext,
  KernelError,
} from "../kernel/index.js";
import { pluginRuntime } from "./runtime.js";

const healthProbes = new Map<string, HealthProbeFn>();
const ipcEnqueues = new Map<string, IpcEnqueueFn>();
const pluginSchedulers = new Map<string, PluginSchedulerHost>();
const systemEventHandlers: Array<(event: import("@godmode/plugin-api").SystemEventRow) => void> = [];
let autonomousRunnerKick: ((reason?: string) => void) | null = null;

function upsertTradingDepartment(db: AppDatabase): void {
  try {
    createRecord(
      db,
      "StructureNode",
      {
        id: "trading",
        parent_id: null,
        label: "Trading",
        icon: "trending-up",
        segment: "trading",
        kind: "placeholder",
        built_in: true,
        sort_order: 0,
      },
      createSystemOperationContext()
    );
  } catch (error) {
    if (error instanceof KernelError && error.status === 409) return;
    throw error;
  }
}

export function initPluginHost(): PluginHostServices {
  const host: PluginHostServices = {
    getTenantDb(tenantId: string) {
      return getTenantDb(tenantId) as TenantDb;
    },
    getReqTenantDb(req) {
      const db = (req as { tenantDb?: AppDatabase }).tenantDb;
      if (!db) throw new Error("tenantDb missing on request");
      return db as TenantDb;
    },
    createPluginRouter() {
      const router = Router();
      router.use(tenantDbMiddleware);
      return router;
    },
    mountPluginRoute(pluginId, path, router) {
      pluginRuntime.mountPluginRoute(pluginId, path, router);
    },
    getTimeseriesStore() {
      return getTimeseriesStore();
    },
    bootstrapTradingDepartment(db) {
      upsertTradingDepartment(db as AppDatabase);
    },
    async bridgeFetch(path, init) {
      const url = `http://127.0.0.1:${config.port}${path.startsWith("/") ? path : `/${path}`}`;
      return fetch(url, init);
    },
    emitPlatformEvent(input: {
      type: string;
      actor: { kind: string; id?: string | null };
      payload?: Record<string, unknown>;
      tenantId?: string | null;
    }) {
      emitEvent({
        type: input.type,
        actor: { kind: input.actor.kind as "system" | "agent" | "user", id: input.actor.id },
        payload: input.payload,
        tenantId: input.tenantId,
      });
    },
    registerHealthProbe(id, fn) {
      healthProbes.set(id, fn);
    },
    async pingHealthProbe(id) {
      const fn = healthProbes.get(id);
      if (fn) return fn();
      return { ok: false, detail: `health probe "${id}" not registered` };
    },
    registerIpcEnqueue(id, fn) {
      ipcEnqueues.set(id, fn);
    },
    enqueueIpcLine(id, line, chartbookKey) {
      const fn = ipcEnqueues.get(id);
      if (!fn) {
        throw new Error(`IPC enqueue "${id}" not registered — plugin not loaded`);
      }
      return fn(line, chartbookKey);
    },
    getPluginScheduler(id) {
      return pluginSchedulers.get(id) ?? null;
    },
    registerPluginScheduler(id, api) {
      pluginSchedulers.set(id, api);
    },
    registerSystemEventHandler(fn) {
      systemEventHandlers.push(fn);
    },
    dispatchSystemEventHandlers(event) {
      for (const fn of systemEventHandlers) {
        try {
          fn(event);
        } catch (err) {
          console.error("[plugin-host] system event handler failed", err);
        }
      }
    },
    cardAwaiting: {
      findCardsAwaitingRef(db, kind, refId) {
        return findCardsAwaitingRef(db as AppDatabase, kind as "backtest", refId);
      },
      markCardAwaitingTerminal(db, cardId, payload) {
        markCardAwaitingTerminal(db as AppDatabase, cardId, payload as Parameters<typeof markCardAwaitingTerminal>[2]);
      },
      appendCardComment(db, cardId, text, kind) {
        appendCardComment(db as AppDatabase, cardId, text, kind as "result" | "action" | "note");
      },
    },
    kickAutonomousRunner(reason) {
      autonomousRunnerKick?.(reason);
    },
    registerAutonomousRunnerKick(fn) {
      autonomousRunnerKick = fn;
    },
  };
  setPluginHost(host);
  return host;
}
