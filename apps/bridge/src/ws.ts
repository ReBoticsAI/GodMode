import type { WebSocketServer, WebSocket } from "ws";
import type { EventEmitter } from "node:events";
import {
  authenticateWsClient,
  getShareBroker,
  type WsClientMeta,
} from "./ws-broker.js";
import { config } from "./config.js";
import { getOperatorTenantIdCached } from "./services/auth/middleware.js";
import {
  canJoinResourceRoom,
  canJoinRoom,
  parseWsSessionFromUrl,
  parseWsTenantIdFromUrl,
} from "./services/ws-auth.js";
import { markUserOffline, markUserOnline } from "./services/presence.js";

const clients = new Set<WsClientMeta>();

export function attachWebSocket(
  wss: WebSocketServer,
  bus: EventEmitter
): (payload: object, tenantId?: string) => void {
  wss.on("connection", (ws, req) => {
    if (!config.auth.allowAnonymous && config.isProduction) {
      const querySession = config.isProduction ? undefined : parseWsSessionFromUrl(req.url);
      const hasCookie = Boolean(req.headers.cookie?.includes("godmode_session="));
      if (!querySession && !hasCookie && !req.headers.authorization) {
        ws.close(4401, "Authentication required");
        return;
      }
    }

    const tenantHeader =
      typeof req.headers["x-tenant-id"] === "string"
        ? req.headers["x-tenant-id"]
        : undefined;
    const queryTenant = parseWsTenantIdFromUrl(req.url);
    const querySession = config.isProduction ? undefined : parseWsSessionFromUrl(req.url);
    const meta = authenticateWsClient(
      ws,
      req.headers.cookie,
      tenantHeader,
      queryTenant,
      querySession
    );

    if (!meta.userId && !config.auth.allowAnonymous) {
      ws.close(4401, "Authentication required");
      return;
    }

    if (!meta.tenantId) {
      if (meta.userId) {
        ws.close(4403, "Tenant required");
        return;
      }
      if (config.auth.allowAnonymous) {
        meta.tenantId = getOperatorTenantIdCached();
        meta.rooms.add(`tenant:${meta.tenantId}`);
      } else {
        ws.close(4401, "Authentication required");
        return;
      }
    } else if (meta.userId) {
      meta.rooms.add(`tenant:${meta.tenantId}`);
    }
    clients.add(meta);
    getShareBroker().registerClient(meta);
    markUserOnline(meta.userId);
    if (meta.userId) {
      getShareBroker().joinRoom(meta, `user:${meta.userId}`);
    }

    ws.send(
      JSON.stringify({
        type: "connected",
        timestamp: Date.now(),
        tenantId: meta.tenantId,
        authenticated: Boolean(meta.userId),
      })
    );

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          type?: string;
          room?: string;
          kind?: string;
          resourceId?: string;
        };
        const broker = getShareBroker();
        if (msg.type === "join_room" && typeof msg.room === "string") {
          if (!canJoinRoom(meta.userId, meta.tenantId, msg.room)) {
            ws.send(JSON.stringify({ type: "error", error: "forbidden", room: msg.room }));
            return;
          }
          broker.joinRoom(meta, msg.room);
          ws.send(JSON.stringify({ type: "joined", room: msg.room }));
        }
        if (msg.type === "leave_room" && typeof msg.room === "string") {
          broker.leaveRoom(meta, msg.room);
        }
        if (
          msg.type === "join_resource" &&
          typeof msg.kind === "string" &&
          typeof msg.resourceId === "string"
        ) {
          if (!canJoinResourceRoom(meta.userId, meta.tenantId, msg.kind, msg.resourceId)) {
            ws.send(JSON.stringify({ type: "error", error: "forbidden", kind: msg.kind }));
            return;
          }
          const room = `resource:${msg.kind}:${msg.resourceId}`;
          broker.joinRoom(meta, room);
          ws.send(JSON.stringify({ type: "joined", room }));
        }
      } catch {
        /* ignore */
      }
    });

    ws.on("close", () => {
      clients.delete(meta);
      getShareBroker().unregisterClient(meta);
      markUserOffline(meta.userId);
    });
  });

  const broadcast = (payload: object, tenantId?: string) => {
    const msg = JSON.stringify(payload);
    const targetTenant = tenantId ?? getOperatorTenantIdCached();

    for (const client of clients) {
      if (client.ws.readyState !== 1) continue;
      if (!config.auth.allowAnonymous && !client.userId) continue;
      const inTenant =
        client.tenantId === targetTenant ||
        client.rooms.has(`tenant:${targetTenant}`);
      if (inTenant) client.ws.send(msg);
    }
  };

  bus.on("fill", (data) => broadcast({ type: "fill", data }));
  bus.on("order", (data) => broadcast({ type: "order", data }));
  bus.on("deployment", (data) => broadcast({ type: "deployment", data }));
  bus.on("status", (data) => broadcast({ type: "status", data }));
  bus.on("ipc", (data) => broadcast({ type: "ipc", data }));
  bus.on("sc_trade", (data) => broadcast({ type: "sc_trade", data }));
  bus.on("sc_trade_stats", (data) => broadcast({ type: "sc_trade_stats", data }));
  bus.on("sc_trade_reset", (data) => broadcast({ type: "sc_trade_reset", data }));
  bus.on("sc_position", (data) => broadcast({ type: "sc_position", data }));
  bus.on("sc_fill", (data) => broadcast({ type: "sc_fill", data }));
  bus.on("sc_fill_reset", (data) => broadcast({ type: "sc_fill_reset", data }));
  bus.on("pb_cmd_ack", (data) => broadcast({ type: "pb_cmd_ack", data }));
  bus.on("data_audit", (data) => broadcast({ type: "data_audit", data }));
  bus.on("sc_account", (data) => broadcast({ type: "sc_account", data }));
  bus.on("sc_market", (data) => broadcast({ type: "sc_market", data }));
  bus.on("sc_level", (data) => broadcast({ type: "sc_level", data }));
  bus.on("sc_levels_refresh", () => broadcast({ type: "sc_levels_refresh" }));
  bus.on("master_symbol", (data) => broadcast({ type: "master_symbol", data }));
  bus.on("sc_quote", (data) => broadcast({ type: "sc_quote", data }));
  bus.on("sc_tick", (data) => broadcast({ type: "sc_tick", data }));
  bus.on("sc_ticks", (data) => broadcast({ type: "sc_ticks", data }));
  bus.on("sc_dom", (data) => broadcast({ type: "sc_dom", data }));
  bus.on("sc_signal", (data) => broadcast({ type: "sc_signal", data }));
  bus.on("pb_signal", (data) => broadcast({ type: "pb_signal", data }));
  bus.on("pb_zone", (data) => broadcast({ type: "pb_zone", data }));
  bus.on("setup_phase", (data) => broadcast({ type: "setup_phase", data }));
  bus.on("study_inputs", (data) => broadcast({ type: "study_inputs", data }));
  bus.on("order_lifecycle", (data) => broadcast({ type: "order_lifecycle", data }));
  bus.on("backtest_progress", (data) =>
    broadcast({ type: "backtest_progress", data })
  );
  bus.on("sc_charts_refreshed", (data) =>
    broadcast({ type: "sc_charts_refreshed", data })
  );
  bus.on("sc_profile", (data) => broadcast({ type: "sc_profile", data }));
  bus.on("sc_footprint", (data) => broadcast({ type: "sc_footprint", data }));
  bus.on("sc_chart_props", (data) => broadcast({ type: "sc_chart_props", data }));
  bus.on("sc_replay_state", (data) => broadcast({ type: "sc_replay_state", data }));
  bus.on("sc_drawing", (data) => broadcast({ type: "sc_drawing", data }));
  bus.on("sc_drawings_refresh", (data) =>
    broadcast({ type: "sc_drawings_refresh", data })
  );
  bus.on("ai_queue", (data) => broadcast({ type: "ai_queue", data }));
  bus.on("ai_notification", (data) => broadcast({ type: "ai_notification", data }));
  bus.on("structure_changed", (data) => {
    const tenantId = (data as { tenantId?: string })?.tenantId;
    if (tenantId) {
      getShareBroker().broadcastTenant(tenantId, { type: "structure_changed", data });
    }
    broadcast({ type: "structure_changed", data }, tenantId);
  });

  return broadcast;
}
