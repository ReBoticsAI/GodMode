import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgePort = Number(process.env.BRIDGE_PORT ?? 3847);
const publicPort = Number(process.env.GODMODE_PORT ?? 8080);
const webRoot = path.join(root, "apps", "web", "dist");
const release = JSON.parse(readFileSync(path.join(root, "release.json"), "utf8"));

process.env.NODE_ENV = "production";
process.env.GODMODE_VERSION = String(release.version);
process.env.GODMODE_COMMIT = String(release.commit);
process.env.INSTALLATION_SURFACE =
  process.env.INSTALLATION_SURFACE ??
  (process.platform === "win32" ? "windows_bare_metal" : "linux_bare_metal");
process.env.BRIDGE_HOST = "127.0.0.1";
process.env.BRIDGE_PORT = String(bridgePort);
const bridge = spawn(process.execPath, [path.join(root, "apps", "bridge", "dist", "index.js")], {
  env: process.env,
  stdio: "inherit",
});

const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

function proxy(req, res) {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: bridgePort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${bridgePort}` },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on("error", () => {
    res.writeHead(502);
    res.end("Bridge unavailable");
  });
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/") || req.url === "/ws") return proxy(req, res);
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const candidate = path.resolve(webRoot, `.${pathname}`);
  let file = candidate.startsWith(`${webRoot}${path.sep}`) ? candidate : path.join(webRoot, "index.html");
  try {
    if (!statSync(file).isFile()) file = path.join(webRoot, "index.html");
  } catch {
    file = path.join(webRoot, "index.html");
  }
  res.setHeader("Content-Type", mime.get(path.extname(file)) ?? "application/octet-stream");
  createReadStream(file).on("error", () => {
    res.writeHead(404);
    res.end("Not found");
  }).pipe(res);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: bridgePort,
    path: req.url,
    method: req.method,
    headers: req.headers,
  });
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(publicPort, process.env.GODMODE_HOST ?? "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    bridge.kill(signal);
  });
}
bridge.on("exit", (code) => process.exit(code ?? 1));
