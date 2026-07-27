/**
 * Bridge-owned HTTP CONNECT proxy for Layer 3 terminal egress allowlist (#112 / #157).
 * Kernel-enforced path: bwrap --unshare-net + UDS proxy (no IP egress from the jail).
 * In-jail TCP→UDS bridge keeps npm/curl/git on http://127.0.0.1:<port>.
 */
import fs from "node:fs";
import net from "node:net";
import { isIP } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

/** Loopback port used inside the network namespace for HTTP(S)_PROXY. */
export const JAIL_EGRESS_PROXY_PORT = 9418;

export const EGRESS_DIR_NAME = ".godmode-egress";
export const EGRESS_BRIDGE_SCRIPT = "tcp-to-uds.mjs";

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
  /** Absolute UDS path on the host (under coding root). */
  socketPath: string;
  /** Relative to coding root, for docs/tests. */
  socketRel: string;
  /** Proxy URL for processes inside the jail (via TCP→UDS bridge). */
  jailProxyUrl: string;
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
  const m = /^CONNECT\s+([^\s:]+):(\d+)\s+HTTP\/1\.[01]/i.exec(line);
  if (!m) return null;
  const host = m[1];
  const port = Number(m[2]);
  if (!host || !Number.isFinite(port)) return null;
  return { host, port };
}

/** Attach CONNECT allowlist handling to a client socket (UDS or TCP). */
export function attachEgressConnectHandler(
  client: net.Socket,
  allowlist: readonly string[]
): void {
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
}

/** Tiny in-jail script: TCP 127.0.0.1:port ↔ host UDS CONNECT proxy. */
export const TCP_TO_UDS_BRIDGE_SOURCE = `#!/usr/bin/env node
import net from "node:net";

const uds = process.argv[2];
const port = Number(process.argv[3] || "${JAIL_EGRESS_PROXY_PORT}");
if (!uds) {
  console.error("usage: tcp-to-uds.mjs <uds-path> [port]");
  process.exit(2);
}

const server = net.createServer((client) => {
  const upstream = net.createConnection(uds);
  const fail = () => {
    try { client.destroy(); } catch {}
    try { upstream.destroy(); } catch {}
  };
  client.on("error", fail);
  upstream.on("error", fail);
  client.pipe(upstream);
  upstream.pipe(client);
});

server.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
server.listen(port, "127.0.0.1");
`;

/** Ensure the TCP→UDS bridge script exists under the coding root. */
export function ensureEgressBridgeScript(codingRoot: string): {
  scriptAbs: string;
  scriptRel: string;
} {
  const dir = path.join(codingRoot, EGRESS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const scriptAbs = path.join(dir, EGRESS_BRIDGE_SCRIPT);
  fs.writeFileSync(scriptAbs, TCP_TO_UDS_BRIDGE_SOURCE, "utf8");
  return {
    scriptAbs,
    scriptRel: `${EGRESS_DIR_NAME}/${EGRESS_BRIDGE_SCRIPT}`.replace(/\\/g, "/"),
  };
}

/**
 * Start CONNECT proxy on a Unix domain socket under codingRoot/.godmode-egress/.
 */
export function startTerminalEgressProxy(opts: {
  codingRoot: string;
  allowlist?: string[];
}): Promise<TerminalEgressProxyHandle> {
  const allowlist = resolveEgressAllowlist(opts.allowlist);
  if (allowlist.length === 0) {
    return Promise.reject(
      new Error("CODING_TERMINAL_NET=allowlist requires a non-empty egress host allowlist")
    );
  }
  const codingRoot = path.resolve(opts.codingRoot);
  const dir = path.join(codingRoot, EGRESS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  ensureEgressBridgeScript(codingRoot);

  const sockName = `proxy-${randomUUID()}.sock`;
  const socketPath = path.join(dir, sockName);
  const socketRel = `${EGRESS_DIR_NAME}/${sockName}`.replace(/\\/g, "/");
  try {
    fs.unlinkSync(socketPath);
  } catch {
    /* ignore */
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      attachEgressConnectHandler(client, allowlist);
    });

    server.once("error", reject);
    server.listen(socketPath, () => {
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch {
        /* ignore */
      }
      resolve({
        socketPath,
        socketRel,
        jailProxyUrl: `http://127.0.0.1:${JAIL_EGRESS_PROXY_PORT}`,
        allowlist,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => {
              try {
                fs.unlinkSync(socketPath);
              } catch {
                /* ignore */
              }
              if (err) rej(err);
              else res();
            });
          }),
      });
    });
  });
}

/** Wrap a user command so the in-jail TCP→UDS bridge starts first. */
export function wrapAllowlistCommand(opts: {
  codingRoot: string;
  socketRel: string;
  command: string;
  jailProxyPort?: number;
}): string {
  const port = opts.jailProxyPort ?? JAIL_EGRESS_PROXY_PORT;
  const scriptRel = `${EGRESS_DIR_NAME}/${EGRESS_BRIDGE_SCRIPT}`.replace(
    /\\/g,
    "/"
  );
  const sockRel = opts.socketRel.replace(/\\/g, "/");
  // codingRoot is HOME inside the jail; paths are relative to HOME / absolute under bind.
  const root = opts.codingRoot.replace(/\\/g, "/");
  const scriptAbs = `${root}/${scriptRel}`;
  const sockAbs = `${root}/${sockRel}`;
  const userCmd = opts.command.replace(/'/g, `'\\''`);

  return [
    `BRIDGE_PID=""`,
    `cleanup() { if [ -n "$BRIDGE_PID" ]; then kill "$BRIDGE_PID" 2>/dev/null || true; fi; }`,
    `trap cleanup EXIT`,
    `NODE=$(command -v node || true)`,
    `if [ -z "$NODE" ]; then`,
    `  for c in /usr/local/bin/node /usr/bin/node; do`,
    `    if [ -x "$c" ]; then NODE="$c"; break; fi`,
    `  done`,
    `fi`,
    `if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then echo 'node not found in jail for egress bridge' >&2; exit 1; fi`,
    `"$NODE" '${scriptAbs}' '${sockAbs}' ${port} &`,
    `BRIDGE_PID=$!`,
    `i=0`,
    `while [ "$i" -lt 50 ]; do`,
    `  "$NODE" -e "const n=require('net');const s=n.connect(${port},'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null && break`,
    `  i=$((i+1))`,
    `  sleep 0.05`,
    `done`,
    `"$NODE" -e "const n=require('net');const s=n.connect(${port},'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null || { echo 'egress bridge failed to listen' >&2; exit 1; }`,
    `/bin/sh -c '${userCmd}'`,
  ].join("\n");
}
