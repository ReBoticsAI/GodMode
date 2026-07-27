/**
 * WebSocket attach for shared PTY sessions (#162).
 * Path: /ws/terminal
 */
import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";
import { config } from "./config.js";
import { authenticateWsClient } from "./ws-broker.js";
import { getOperatorTenantIdCached } from "./services/auth/middleware.js";
import {
  parseWsSessionFromUrl,
  parseWsTenantIdFromUrl,
} from "./services/ws-auth.js";
import { codingUiAllowed } from "./services/coding/coding-ui-access.js";
import {
  attachTerminalWs,
  detachTerminalWs,
  resizeTerminalSession,
  writeTerminalSession,
} from "./services/coding/terminal-session-manager.js";

type TerminalClientMsg = {
  type?: string;
  sessionId?: string;
  data?: string;
  cols?: number;
  rows?: number;
};

export function attachTerminalWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!codingUiAllowed()) {
      ws.close(4403, "Coding disabled");
      return;
    }

    if (!config.auth.allowAnonymous && config.isProduction) {
      const querySession = config.isProduction
        ? undefined
        : parseWsSessionFromUrl(req.url);
      const hasCookie = Boolean(
        req.headers.cookie?.includes("godmode_session=")
      );
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
    const querySession = config.isProduction
      ? undefined
      : parseWsSessionFromUrl(req.url);
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
      } else {
        ws.close(4401, "Authentication required");
        return;
      }
    }

    let attachedSessionId: string | null = null;

    ws.send(
      JSON.stringify({
        type: "connected",
        tenantId: meta.tenantId,
        authenticated: Boolean(meta.userId),
      })
    );

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as TerminalClientMsg;
        const sessionId = String(msg.sessionId ?? "").trim();
        if (msg.type === "attach") {
          if (!sessionId) {
            ws.send(JSON.stringify({ type: "error", error: "sessionId required" }));
            return;
          }
          if (attachedSessionId) {
            detachTerminalWs(ws, {
              sessionId: attachedSessionId,
              tenantId: meta.tenantId,
            });
          }
          const result = attachTerminalWs(ws, {
            sessionId,
            tenantId: meta.tenantId,
          });
          if (!result.ok) {
            ws.send(JSON.stringify({ type: "error", error: result.error }));
            return;
          }
          attachedSessionId = sessionId;
          ws.send(JSON.stringify({ type: "attached", sessionId }));
          return;
        }
        if (msg.type === "detach") {
          if (attachedSessionId) {
            detachTerminalWs(ws, {
              sessionId: attachedSessionId,
              tenantId: meta.tenantId,
            });
            attachedSessionId = null;
          }
          ws.send(JSON.stringify({ type: "detached" }));
          return;
        }
        if (msg.type === "stdin") {
          const id = sessionId || attachedSessionId;
          if (!id) {
            ws.send(JSON.stringify({ type: "error", error: "not attached" }));
            return;
          }
          writeTerminalSession({
            sessionId: id,
            tenantId: meta.tenantId,
            data: String(msg.data ?? ""),
          });
          return;
        }
        if (msg.type === "resize") {
          const id = sessionId || attachedSessionId;
          if (!id) return;
          resizeTerminalSession({
            sessionId: id,
            tenantId: meta.tenantId,
            cols: Number(msg.cols ?? 80),
            rows: Number(msg.rows ?? 24),
          });
        }
      } catch {
        /* ignore */
      }
    });

    ws.on("close", () => {
      if (attachedSessionId) {
        detachTerminalWs(ws, {
          sessionId: attachedSessionId,
          tenantId: meta.tenantId,
        });
      }
    });
  });
}
