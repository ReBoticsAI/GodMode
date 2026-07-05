import type { WebSocket } from "ws";
import type { EventEmitter } from "node:events";
import { parseSessionCookie, resolveSession } from "./services/auth/session-store.js";
import { getCoreDb } from "./core-db.js";
import { listUserTenants } from "./services/tenant-bootstrap.js";
import {
  parseWsSessionFromUrl,
  parseWsTenantIdFromUrl,
  resolveWsTenantId,
} from "./services/ws-auth.js";

export interface WsClientMeta {
  ws: WebSocket;
  userId?: string;
  tenantId?: string;
  rooms: Set<string>;
}

let broker: ShareBroker | null = null;

export class ShareBroker {
  private clients = new Set<WsClientMeta>();

  registerClient(meta: WsClientMeta): void {
    this.clients.add(meta);
  }

  unregisterClient(meta: WsClientMeta): void {
    this.clients.delete(meta);
  }

  joinRoom(meta: WsClientMeta, room: string): void {
    meta.rooms.add(room);
  }

  leaveRoom(meta: WsClientMeta, room: string): void {
    meta.rooms.delete(room);
  }

  broadcastToRoom(room: string, payload: object): void {
    const msg = JSON.stringify({ room, ...payload });
    for (const client of this.clients) {
      if (client.rooms.has(room) && client.ws.readyState === 1) {
        client.ws.send(msg);
      }
    }
  }

  broadcastTenant(tenantId: string, payload: object): void {
    this.broadcastToRoom(`tenant:${tenantId}`, payload);
  }

  broadcastResource(kind: string, resourceId: string, payload: object): void {
    this.broadcastToRoom(`resource:${kind}:${resourceId}`, payload);
  }
}

export function getShareBroker(): ShareBroker {
  if (!broker) broker = new ShareBroker();
  return broker;
}

/**
 * Broadcast a lightweight Kanban "activity" ping to a tenant's WS room so live
 * chat/Active-Work panels can refetch their scoped view without a manual
 * refresh. Fired whenever a card comment is appended or a card materially
 * changes (status/phase). Best-effort: never throws into the caller, and is a
 * no-op without a tenant (the web panel also polls as a backstop).
 */
export function broadcastCardActivity(
  tenantId: string | null | undefined,
  data: {
    cardId?: string | null;
    agentId?: string | null;
    chatId?: string | null;
    reason?: string;
  } = {}
): void {
  if (!tenantId) return;
  try {
    getShareBroker().broadcastTenant(tenantId, {
      type: "card_activity",
      data: { ...data, tenantId },
      timestamp: Date.now(),
    });
  } catch {
    /* best-effort */
  }
}

export function authenticateWsClient(
  ws: WebSocket,
  cookieHeader: string | undefined,
  tenantHeader: string | undefined,
  queryTenant?: string,
  querySession?: string
): WsClientMeta {
  const meta: WsClientMeta = { ws, rooms: new Set() };
  const core = getCoreDb();
  const sessionId =
    parseSessionCookie(cookieHeader) ?? querySession?.trim() ?? undefined;
  const resolved = resolveSession(core, sessionId);
  if (resolved) {
    meta.userId = resolved.user.id;
    const tenants = listUserTenants(core, resolved.user.id);
    meta.tenantId = resolveWsTenantId(resolved.user.id, {
      headerTenant: tenantHeader,
      queryTenant,
      fallbackTenantId: tenants[0]?.id,
    });
    if (meta.tenantId) {
      meta.rooms.add(`tenant:${meta.tenantId}`);
    }
  }
  return meta;
}

export function attachWebSocketRooms(
  wss: import("ws").WebSocketServer,
  bus: EventEmitter,
  globalBroadcast: (payload: object, tenantId?: string) => void
): ShareBroker {
  const shareBroker = getShareBroker();

  wss.on("connection", (ws, req) => {
    const tenantHeader =
      typeof req.headers["x-tenant-id"] === "string"
        ? req.headers["x-tenant-id"]
        : undefined;
    const queryTenant = parseWsTenantIdFromUrl(req.url);
    const querySession = parseWsSessionFromUrl(req.url);
    const meta = authenticateWsClient(
      ws,
      req.headers.cookie,
      tenantHeader,
      queryTenant,
      querySession
    );
    shareBroker.registerClient(meta);

    ws.send(
      JSON.stringify({
        type: "connected",
        timestamp: Date.now(),
        tenantId: meta.tenantId ?? null,
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
        if (msg.type === "join_room" && typeof msg.room === "string") {
          shareBroker.joinRoom(meta, msg.room);
          ws.send(JSON.stringify({ type: "joined", room: msg.room }));
        }
        if (msg.type === "leave_room" && typeof msg.room === "string") {
          shareBroker.leaveRoom(meta, msg.room);
        }
        if (
          msg.type === "join_resource" &&
          typeof msg.kind === "string" &&
          typeof msg.resourceId === "string"
        ) {
          const room = `resource:${msg.kind}:${msg.resourceId}`;
          shareBroker.joinRoom(meta, room);
          ws.send(JSON.stringify({ type: "joined", room }));
        }
      } catch {
        /* ignore malformed */
      }
    });

    ws.on("close", () => shareBroker.unregisterClient(meta));
  });

  bus.on("structure_changed", (data) => {
    const tenantId = (data as { tenantId?: string })?.tenantId;
    if (tenantId) {
      shareBroker.broadcastTenant(tenantId, { type: "structure_changed", data });
    }
    globalBroadcast({ type: "structure_changed", data }, tenantId);
  });

  return shareBroker;
}
