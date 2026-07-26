/**
 * Bridge-owned HTTP CONNECT proxy for Layer 3 terminal egress allowlist (#112).
 * Proxy-enforced (not kernel netns). Prefer over CODING_TERMINAL_NET=shared.
 */
import net from "node:net";
import { isIP } from "node:net";

export const DEFAULT_TERMINAL_EGRESS_HOSTS: readonly string[] = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
  "ghcr.io",
  "nodejs.org",
];

const ALLOWED_PORTS = new Set([80, 443]);

export function resolveEgressAllowlist(hosts?: string[]): string[] {
  const fromEnv = (hosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_TERMINAL_EGRESS_HOSTS];
}

/**
 * Exact match or leading `*.example.com` suffix rule.
 * Rejects empty hosts. IP literals and localhost are denied unless explicitly listed.
 */
export function isEgressHostAllowed(
  host: string,
  allowlist: readonly string[]
): boolean {
  const h = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!h) return false;

  const listedExact = allowlist.some((rule) => rule === h);
  const isLoopbackName =
    h === "localhost" || h === "localhost.localdomain" || h.endsWith(".localhost");
  const ipVersion = isIP(h);
  if ((ipVersion || isLoopbackName) && !listedExact) {
    return false;
  }

  for (const rule of allowlist) {
    const r = rule.trim().toLowerCase();
    if (!r) continue;
    if (r === h) return true;
    if (r.startsWith("*.")) {
      const suffix = r.slice(1); // .example.com
      if (h === r.slice(2) || h.endsWith(suffix)) return true;
    }
  }
  return false;
}

export type TerminalEgressProxyHandle = {
  host: string;
  port: number;
  proxyUrl: string;
  allowlist: string[];
  close: () => Promise<void>;
};

function writeHttpError(socket: net.Socket, status: number, message: string): void {
  const body = message;
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  );
  socket.end();
}

function parseConnectTarget(line: string): { host: string; port: number } | null {
  // CONNECT host:port HTTP/1.1
  const m = /^CONNECT\s+([^\s:]+):(\d+)\s+HTTP\/1\.[01]/i.exec(line);
  if (!m) return null;
  const host = m[1];
  const port = Number(m[2]);
  if (!host || !Number.isFinite(port)) return null;
  return { host, port };
}

export function startTerminalEgressProxy(opts?: {
  allowlist?: string[];
  host?: string;
}): Promise<TerminalEgressProxyHandle> {
  const allowlist = resolveEgressAllowlist(opts?.allowlist);
  if (allowlist.length === 0) {
    return Promise.reject(
      new Error("CODING_TERMINAL_NET=allowlist requires a non-empty egress host allowlist")
    );
  }
  const listenHost = opts?.host ?? "127.0.0.1";

  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      let buf = Buffer.alloc(0);
      let handedOff = false;

      const onData = (chunk: Buffer) => {
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

        const upstream = net.connect(
          { host: target.host, port: target.port },
          () => {
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (rest.length) upstream.write(rest);
            upstream.pipe(client);
            client.pipe(upstream);
          }
        );
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

      const cleanup = () => {
        client.removeListener("data", onData);
        client.destroy();
      };

      client.on("data", onData);
      client.on("error", () => cleanup());
    });

    server.once("error", reject);
    server.listen(0, listenHost, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to bind terminal egress proxy"));
        return;
      }
      const port = addr.port;
      const proxyUrl = `http://${listenHost}:${port}`;
      resolve({
        host: listenHost,
        port,
        proxyUrl,
        allowlist,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
