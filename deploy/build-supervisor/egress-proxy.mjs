/**
 * TCP CONNECT allowlist proxy for Layer 4 build containers (#167).
 * Listens on 127.0.0.1; build containers reach it via host.docker.internal.
 */
import net from "node:net";
import {
  DEFAULT_BUILD_EGRESS_HOSTS,
  isEgressHostAllowed,
  resolveBuildEgressHosts,
} from "./lib.mjs";

const ALLOWED_PORTS = new Set([80, 443]);

function writeHttpError(socket, status, message) {
  const body = message;
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  );
  socket.end();
}

function parseConnectTarget(line) {
  const m = /^CONNECT\s+([^\s:]+):(\d+)\s+HTTP\/1\.[01]/i.exec(line);
  if (!m) return null;
  const host = m[1];
  const port = Number(m[2]);
  if (!host || !Number.isFinite(port)) return null;
  return { host, port };
}

function attachEgressConnectHandler(client, allowlist) {
  let buf = Buffer.alloc(0);
  let handedOff = false;

  const cleanup = () => {
    client.removeListener("data", onData);
    client.destroy();
  };

  const onData = (chunk) => {
    if (handedOff) return;
    buf = Buffer.concat([buf, chunk]);
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      if (buf.length > 16_384) {
        writeHttpError(client, 400, "Header too large");
        cleanup();
      }
      return;
    }
    const headerText = buf.subarray(0, headerEnd).toString("utf8");
    const firstLine = headerText.split(/\r?\n/)[0] ?? "";
    const target = parseConnectTarget(firstLine);
    if (!target) {
      writeHttpError(client, 400, "Only CONNECT is supported");
      cleanup();
      return;
    }
    if (!ALLOWED_PORTS.has(target.port)) {
      writeHttpError(client, 403, "Port not allowed");
      cleanup();
      return;
    }
    if (!isEgressHostAllowed(target.host, allowlist)) {
      writeHttpError(client, 403, `Host not allowlisted: ${target.host}`);
      cleanup();
      return;
    }

    handedOff = true;
    client.removeListener("data", onData);
    const rest = buf.subarray(headerEnd + 4);

    const upstream = net.connect({ host: target.host, port: target.port }, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (rest.length) upstream.write(rest);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => {
      try {
        writeHttpError(client, 502, "Upstream connect failed");
      } catch {
        client.destroy();
      }
    });
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  };

  client.on("data", onData);
  client.on("error", () => cleanup());
}

/**
 * @returns {Promise<{ port: number, allowlist: string[], close: () => Promise<void> }>}
 */
export function startBuildEgressProxy(opts = {}) {
  const allowlist = resolveBuildEgressHosts(opts.hosts);
  const host = opts.host || "127.0.0.1";
  const preferredPort = Number(opts.port || 0);

  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      attachEgressConnectHandler(client, allowlist);
    });
    server.on("error", reject);
    server.listen(preferredPort, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : preferredPort;
      resolve({
        port,
        allowlist,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

export { DEFAULT_BUILD_EGRESS_HOSTS, isEgressHostAllowed, resolveBuildEgressHosts };
