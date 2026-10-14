/**
 * WebSocket stream of Browser stage frames for watch UI (#852).
 * Path: /ws/browser?session=<id>
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { browserStageAllowed } from "./browser-access.js";
import {
  getBrowserSession,
  subscribeBrowserFrames,
} from "./browser-session.js";

function sessionFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url, "http://localhost");
    return String(u.searchParams.get("session") ?? "").trim();
  } catch {
    return "";
  }
}

export function attachBrowserWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    if (!browserStageAllowed()) {
      socket.close(4403, "browser disabled");
      return;
    }
    const sessionId = sessionFromUrl(req.url);
    if (!sessionId || !getBrowserSession(sessionId)) {
      socket.close(4404, "session not found");
      return;
    }

    const unsub = subscribeBrowserFrames(sessionId, (frame) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "frame", ...frame }));
      }
    });

    socket.send(
      JSON.stringify({
        type: "hello",
        sessionId,
        session: getBrowserSession(sessionId),
      })
    );

    socket.on("close", () => {
      unsub();
    });
    socket.on("error", () => {
      unsub();
    });
  });
}

export function handleBrowserWsUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
}
