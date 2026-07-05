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
import { setPluginHost, type PluginHostServices, type SierraPb1SchedulerHost, type TenantDb } from "@godmode/plugin-host";
import { config } from "../config.js";

let pingScHealthImpl: (() => Promise<{ ok: boolean; detail?: string }>) | null = null;
let enqueueScLineImpl: ((line: string, chartbookKey?: string) => string) | null = null;
let sierraPb1Scheduler: SierraPb1SchedulerHost | null = null;
const systemEventHandlers: Array<(event: import("@godmode/plugin-api").SystemEventRow) => void> = [];
let autonomousRunnerKick: ((reason?: string) => void) | null = null;

export function setScHealthPing(
  fn: () => Promise<{ ok: boolean; detail?: string }>
): void {
  pingScHealthImpl = fn;
}

function upsertTradingDepartment(db: AppDatabase): void {
  db.prepare(
    `INSERT OR IGNORE INTO structure_nodes
       (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
     VALUES ('trading', NULL, 'Trading', 'trending-up', 'trading', 'placeholder', NULL, NULL, 1, 0, NULL)`
  ).run();
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
    async pingScHealth() {
      if (pingScHealthImpl) return pingScHealthImpl();
      return { ok: false, detail: "sierra plugin not loaded" };
    },
    registerScHealthPing(fn: () => Promise<{ ok: boolean; detail?: string }>) {
      pingScHealthImpl = fn;
    },
    enqueueScLine(line, chartbookKey) {
      if (!enqueueScLineImpl) {
        throw new Error("sierra plugin not loaded — SC command queue unavailable");
      }
      return enqueueScLineImpl(line, chartbookKey);
    },
    registerEnqueueScLine(fn) {
      enqueueScLineImpl = fn;
    },
    getSierraPb1Scheduler() {
      return sierraPb1Scheduler;
    },
    registerSierraPb1Scheduler(api) {
      sierraPb1Scheduler = api;
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
