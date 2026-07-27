#!/usr/bin/env node
/**
 * Host build supervisor (#164 / #167 / #170 / #112 Layer 4).
 * Owns Docker socket; Bridge calls POST /v1/build over localhost bearer auth.
 * Never expose this port publicly.
 *
 * Network:
 * - none (default): docker --network none
 * - allowlist: Docker --internal network + HTTP(S)_PROXY to host CONNECT proxy
 *   (no public internet route; proxy bypass closed)
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import {
  normalizeBuildCommand,
  normalizeBuildNet,
  resolveBuildEgressHosts,
  sanitizeCwdRel,
  sanitizeTenantId,
  tenantWorkspaceHostPath,
} from "./lib.mjs";
import { startBuildEgressProxy } from "./egress-proxy.mjs";
import {
  buildDockerRunArgs,
  ensureInternalBuildNetwork,
  resolveBuildEgressNetworkName,
} from "./egress-network.mjs";

const HOST = process.env.CODING_BUILD_SUPERVISOR_HOST || "127.0.0.1";
const PORT = Number(process.env.CODING_BUILD_SUPERVISOR_PORT || "8792");
const TOKEN = process.env.CODING_BUILD_SUPERVISOR_TOKEN || "";
const DATA_DIR = process.env.PLATFORM_DATA_DIR || "";
const IMAGE = process.env.CODING_BUILD_IMAGE || "node:22-bookworm-slim";
const DOCKER_BIN = process.env.DOCKER_BIN || "docker";
const DEFAULT_NET = normalizeBuildNet(process.env.CODING_BUILD_NET || "none");
const EGRESS_PROXY_HOST =
  process.env.CODING_BUILD_EGRESS_PROXY_HOST || "127.0.0.1";
const EGRESS_PROXY_PORT = Number(
  process.env.CODING_BUILD_EGRESS_PROXY_PORT || "8793"
);
const EGRESS_NETWORK = resolveBuildEgressNetworkName();
const MAX_STDOUT = 256 * 1024;
const MAX_STDERR = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const GLOBAL_CONCURRENCY = Math.max(
  1,
  Number(process.env.CODING_BUILD_GLOBAL_CONCURRENCY || "2")
);
const PER_TENANT_CONCURRENCY = Math.max(
  1,
  Number(process.env.CODING_BUILD_TENANT_CONCURRENCY || "1")
);

let globalActive = 0;
const tenantActive = new Map();
/** @type {{ port: number, allowlist: string[], close: () => Promise<void> } | null} */
let egressProxy = null;
/** @type {string | null} */
let egressNetworkReady = null;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function unauthorized(res) {
  json(res, 401, { error: "Unauthorized" });
}

function authOk(req) {
  if (!TOKEN) return false;
  const header = String(req.headers.authorization || "");
  const expected = `Bearer ${TOKEN}`;
  return header === expected;
}

function acquire(tenantId) {
  if (globalActive >= GLOBAL_CONCURRENCY) {
    return "global concurrency limit";
  }
  const n = tenantActive.get(tenantId) || 0;
  if (n >= PER_TENANT_CONCURRENCY) {
    return "tenant concurrency limit";
  }
  globalActive += 1;
  tenantActive.set(tenantId, n + 1);
  return null;
}

function release(tenantId) {
  globalActive = Math.max(0, globalActive - 1);
  const n = (tenantActive.get(tenantId) || 1) - 1;
  if (n <= 0) tenantActive.delete(tenantId);
  else tenantActive.set(tenantId, n);
}

function runDocker(opts) {
  return new Promise((resolve) => {
    const runArgs = buildDockerRunArgs({
      network: opts.network,
      networkName: opts.networkName,
      proxyPort: opts.proxyPort,
      bindHost: opts.bindHost,
      workdir: opts.workdir,
      image: IMAGE,
      argv: opts.argv,
    });
    const child = spawn(DOCKER_BIN, ["run", ...runArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_STDOUT) {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_STDOUT) stdout = stdout.slice(0, MAX_STDOUT);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR) {
        stderr += chunk.toString("utf8");
        if (stderr.length > MAX_STDERR) stderr = stderr.slice(0, MAX_STDERR);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

async function ensureEgressProxy() {
  if (egressProxy) return egressProxy;
  egressProxy = await startBuildEgressProxy({
    host: EGRESS_PROXY_HOST,
    port: EGRESS_PROXY_PORT,
    hosts: resolveBuildEgressHosts(),
  });
  console.log(
    `build egress CONNECT proxy on ${EGRESS_PROXY_HOST}:${egressProxy.port} hosts=${egressProxy.allowlist.length}`
  );
  return egressProxy;
}

async function ensureEgressNetwork() {
  if (egressNetworkReady) return egressNetworkReady;
  const net = await ensureInternalBuildNetwork({
    dockerBin: DOCKER_BIN,
    networkName: EGRESS_NETWORK,
  });
  egressNetworkReady = net.name;
  console.log(
    `build egress Docker network ${net.name} internal=true created=${net.created}`
  );
  return egressNetworkReady;
}

async function handleBuild(body) {
  if (!DATA_DIR) throw new Error("PLATFORM_DATA_DIR is required");
  if (!TOKEN) throw new Error("CODING_BUILD_SUPERVISOR_TOKEN is required");

  const tenantId = sanitizeTenantId(body.tenantId);
  const cwdRel = sanitizeCwdRel(body.cwdRel);
  const command = normalizeBuildCommand(body.command);
  const network = normalizeBuildNet(
    body.network != null ? body.network : DEFAULT_NET
  );
  const timeoutMs = Math.min(
    Math.max(Number(body.timeoutMs ?? DEFAULT_TIMEOUT_MS), 5_000),
    MAX_TIMEOUT_MS
  );

  const relTenant = tenantWorkspaceHostPath(DATA_DIR, tenantId);
  const bindHost = path.resolve(DATA_DIR, relTenant);
  if (
    !bindHost.startsWith(path.resolve(DATA_DIR) + path.sep) &&
    bindHost !== path.resolve(DATA_DIR)
  ) {
    throw new Error("Tenant path escapes data dir");
  }
  if (!fs.existsSync(bindHost)) {
    throw new Error(`Tenant workspace not found: ${tenantId}`);
  }

  const workdir =
    cwdRel === "." ? "/workspace" : `/workspace/${cwdRel.split("/").join("/")}`;

  const argv = command.split(" ");
  const busy = acquire(tenantId);
  if (busy) {
    const err = new Error(busy);
    err.status = 429;
    throw err;
  }

  let proxyPort;
  let allowlist;
  let networkName;
  if (network === "allowlist") {
    const proxy = await ensureEgressProxy();
    proxyPort = proxy.port;
    allowlist = proxy.allowlist;
    networkName = await ensureEgressNetwork();
  }

  const started = Date.now();
  try {
    const result = await runDocker({
      bindHost,
      workdir,
      argv,
      timeoutMs,
      network,
      proxyPort,
      networkName,
    });
    return {
      ...result,
      durationMs: Date.now() - started,
      command,
      cwdRel,
      tenantId,
      image: IMAGE,
      network,
      egressNetwork: network === "allowlist" ? networkName : undefined,
      egressHosts: network === "allowlist" ? allowlist : [],
      egressEnforced: network === "allowlist" ? "docker-internal" : "network-none",
    };
  } finally {
    release(tenantId);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, {
      ok: true,
      service: "godmode-build-supervisor",
      defaultNet: DEFAULT_NET,
      egressNetwork: EGRESS_NETWORK,
    });
    return;
  }
  if (
    req.method === "POST" &&
    (req.url === "/v1/build" || req.url === "/v1/build/")
  ) {
    if (!authOk(req)) {
      unauthorized(res);
      return;
    }
    try {
      const body = await readBody(req);
      const result = await handleBuild(body);
      json(res, 200, result);
    } catch (err) {
      const status = err?.status === 429 ? 429 : 400;
      json(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  json(res, 404, { error: "Not found" });
});

if (!TOKEN) {
  console.error("CODING_BUILD_SUPERVISOR_TOKEN is required");
  process.exit(1);
}
if (!DATA_DIR) {
  console.error("PLATFORM_DATA_DIR is required");
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(
    `godmode-build-supervisor listening on http://${HOST}:${PORT} data=${DATA_DIR} image=${IMAGE} defaultNet=${DEFAULT_NET} egressNetwork=${EGRESS_NETWORK}`
  );
});
