/**
 * Route HTTP upgrades to the correct `ws` WebSocketServer.
 * Multiple `WebSocketServer({ server, path })` instances on one HTTP server race:
 * a non-matching path calls abortHandshake(400), so `/ws` rejects `/ws/terminal`.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Server } from "node:http";
import type { WebSocketServer } from "ws";

export type WsUpgradeRoute = {
  /** Exact pathname (no query), e.g. `/ws` or `/ws/terminal`. */
  path: string;
  wss: WebSocketServer;
};

/** Pathname only (query stripped). Returns null for invalid URLs. */
export function wsUpgradePathname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    const q = url.indexOf("?");
    return q === -1 ? url : url.slice(0, q);
  }
}

/**
 * Attach a single `upgrade` listener that dispatches by exact pathname.
 * Servers must be created with `{ noServer: true }`.
 */
export function attachWsUpgradeRouter(
  server: Server,
  routes: readonly WsUpgradeRoute[]
): void {
  const byPath = new Map(routes.map((r) => [r.path, r.wss]));

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = wsUpgradePathname(req.url);
    const wss = pathname ? byPath.get(pathname) : undefined;
    if (!wss) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
}
