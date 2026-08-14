/**
 * HTTP upgrade routing for multiple `ws` servers (#210).
 */
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import {
  attachWsUpgradeRouter,
  wsUpgradePathname,
} from "../../ws-upgrade-router.js";

describe("wsUpgradePathname", () => {
  it("strips query and returns pathname", () => {
    expect(wsUpgradePathname("/ws/terminal?tenantId=abc")).toBe("/ws/terminal");
    expect(wsUpgradePathname("/ws/chat?tenantId=abc")).toBe("/ws/chat");
    expect(wsUpgradePathname("/ws")).toBe("/ws");
  });

  it("returns null for empty", () => {
    expect(wsUpgradePathname(undefined)).toBeNull();
  });
});

describe("attachWsUpgradeRouter", () => {
  let server: http.Server | null = null;
  let mainWss: WebSocketServer | null = null;
  let termWss: WebSocketServer | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const closeWs = (wss: WebSocketServer | null) =>
        new Promise<void>((r) => {
          if (!wss) return r();
          wss.close(() => r());
        });
      void Promise.all([closeWs(mainWss), closeWs(termWss)]).then(() => {
        if (!server) return resolve();
        server.close(() => resolve());
      });
    });
    server = null;
    mainWss = null;
    termWss = null;
  });

  it("routes /ws, /ws/terminal, and /ws/chat without aborting other paths", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    mainWss = new WebSocketServer({ noServer: true });
    termWss = new WebSocketServer({ noServer: true });
    const chatWss = new WebSocketServer({ noServer: true });
    attachWsUpgradeRouter(server, [
      { path: "/ws", wss: mainWss },
      { path: "/ws/terminal", wss: termWss },
      { path: "/ws/chat", wss: chatWss },
    ]);

    mainWss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "main" }));
    });
    termWss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "terminal" }));
    });
    chatWss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "chat" }));
    });

    await new Promise<void>((resolve, reject) => {
      server!.listen(0, "127.0.0.1", () => resolve());
      server!.on("error", reject);
    });
    const { port } = server.address() as { port: number };

    const recv = (url: string) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(url);
        const t = setTimeout(() => {
          ws.terminate();
          reject(new Error(`timeout ${url}`));
        }, 3000);
        ws.on("message", (data) => {
          clearTimeout(t);
          resolve(String(data));
          ws.close();
        });
        ws.on("unexpected-response", (_req, res) => {
          clearTimeout(t);
          reject(new Error(`unexpected ${res.statusCode} for ${url}`));
        });
        ws.on("error", (err) => {
          clearTimeout(t);
          reject(err);
        });
      });

    expect(JSON.parse(await recv(`ws://127.0.0.1:${port}/ws`))).toEqual({
      type: "main",
    });
    expect(
      JSON.parse(await recv(`ws://127.0.0.1:${port}/ws/terminal`))
    ).toEqual({ type: "terminal" });
    expect(JSON.parse(await recv(`ws://127.0.0.1:${port}/ws/chat`))).toEqual({
      type: "chat",
    });

    await new Promise<void>((resolve) => chatWss.close(() => resolve()));
  });
});
