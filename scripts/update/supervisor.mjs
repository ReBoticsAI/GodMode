import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.UPDATE_SUPERVISOR_TOKEN ?? "";
if (token.length < 24) {
  throw new Error("UPDATE_SUPERVISOR_TOKEN must contain at least 24 characters");
}
const host = process.env.UPDATE_SUPERVISOR_HOST ?? "127.0.0.1";
if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
  throw new Error("The update supervisor must listen on loopback");
}
const port = Number(process.env.UPDATE_SUPERVISOR_PORT ?? 8791);
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
let activeAttempt = null;

function authorized(header) {
  const supplied = String(header ?? "").replace(/^Bearer\s+/i, "");
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function updateCommand(manifestUrl) {
  const nodeBin = process.env.GODMODE_NODE_BIN || process.execPath;
  if (process.env.INSTALLATION_SURFACE === "electron") {
    return {
      command: nodeBin,
      args: [path.join(scriptRoot, "desktop-update.mjs"), manifestUrl],
    };
  }
  if (
    ["windows_bare_metal", "linux_bare_metal"].includes(
      process.env.INSTALLATION_SURFACE ?? ""
    )
  ) {
    return {
      command: nodeBin,
      args: [path.join(scriptRoot, "bare-metal-update.mjs"), manifestUrl],
    };
  }
  const compose = process.env.UPDATE_COMPOSE_FILE ?? "deploy/docker-compose.prod.yml";
  const snapshots = process.env.UPDATE_SNAPSHOT_DIR ?? "";
  const readiness =
    process.env.UPDATE_READINESS_URL ??
    "http://127.0.0.1:8080/api/update/readiness";
  const envFile = process.env.UPDATE_ENV_FILE ?? ".env";
  if (process.platform === "win32") {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "RemoteSigned",
      "-File",
      path.join(scriptRoot, "godmode-update.ps1"),
      "-ReleaseUrl",
      manifestUrl,
      "-ComposeFile",
      compose,
      "-ReadinessUrl",
      readiness,
      "-EnvFile",
      envFile,
    ];
    if (snapshots) args.push("-SnapshotRoot", snapshots);
    return {
        command: "powershell.exe",
        args,
      };
  }
  return {
    command: "/bin/bash",
    args: [
      path.join(scriptRoot, "godmode-update.sh"),
      manifestUrl,
      compose,
      snapshots,
      readiness,
    ],
  };
}

const server = http.createServer((request, response) => {
  if (
    request.method !== "POST" ||
    !["/apply", "/restart_to_apply"].includes(request.url ?? "")
  ) {
    response.writeHead(404).end();
    return;
  }
  if (!authorized(request.headers.authorization)) {
    response.writeHead(401).end();
    return;
  }
  if (activeAttempt) {
    response
      .writeHead(409, { "content-type": "application/json" })
      .end(JSON.stringify({ accepted: false, error: "update already active" }));
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) request.destroy();
  });
  request.on("end", () => {
    try {
      const input = JSON.parse(body);
      const attemptId = String(input.attempt_id ?? "");
      const manifestUrl = String(input.manifest_url ?? "");
      const configuredUrl = process.env.UPDATE_MANIFEST_URL;
      if (!/^[0-9a-f-]{36}$/i.test(attemptId)) {
        throw new Error("invalid attempt identity");
      }
      if (
        !manifestUrl.startsWith("https://") ||
        (configuredUrl && manifestUrl !== configuredUrl)
      ) {
        throw new Error("manifest URL is not trusted");
      }
      const invocation = updateCommand(manifestUrl);
      activeAttempt = attemptId;
      const child = spawn(invocation.command, invocation.args, {
        cwd: process.env.UPDATE_WORKING_DIR ?? process.cwd(),
        env: process.env,
        detached: process.platform !== "win32",
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", (error) => {
        activeAttempt = null;
        console.error(`Update ${attemptId} failed to start`, error);
      });
      child.once("exit", (code, signal) => {
        activeAttempt = null;
        console.log(`Update ${attemptId} exited`, { code, signal });
      });
      response
        .writeHead(202, { "content-type": "application/json" })
        .end(JSON.stringify({ accepted: true, attempt_id: attemptId }));
    } catch (error) {
      response
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ accepted: false, error: String(error) }));
    }
  });
});

server.listen(port, host, () => {
  console.log(`GodMode update supervisor listening on http://${host}:${port}`);
});
