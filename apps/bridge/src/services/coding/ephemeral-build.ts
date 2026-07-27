/**
 * Layer 4 ephemeral build client (#164 / #112).
 * Bridge talks to the host build supervisor; never mounts docker.sock.
 */
import { config } from "../../config.js";
import { resolveRepoPath } from "./fs-tools.js";

export const ALLOWED_BUILD_COMMANDS = [
  "npm ci",
  "npm install",
  "npm run build",
  "npm test",
  "npm run typecheck",
] as const;

export type AllowedBuildCommand = (typeof ALLOWED_BUILD_COMMANDS)[number];

const LOCAL_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "host.docker.internal",
]);

export function isAllowedBuildCommand(
  command: string
): command is AllowedBuildCommand {
  const normalized = String(command ?? "").trim().replace(/\s+/g, " ");
  return (ALLOWED_BUILD_COMMANDS as readonly string[]).includes(normalized);
}

export function normalizeBuildCommand(command: string): AllowedBuildCommand {
  const normalized = String(command ?? "").trim().replace(/\s+/g, " ");
  if (!isAllowedBuildCommand(normalized)) {
    throw new Error(
      `Command not allowed for ephemeral build: ${command}. Allowed: ${ALLOWED_BUILD_COMMANDS.join(", ")}`
    );
  }
  return normalized;
}

export function sanitizeCwdRel(cwdRel: string | undefined | null): string {
  const raw = String(cwdRel ?? ".").trim() || ".";
  if (raw.includes("\0")) throw new Error("Invalid cwd");
  const parts = raw.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error(`cwd escapes workspace: ${cwdRel}`);
    if (part.includes(":")) throw new Error(`Invalid cwd segment: ${part}`);
    out.push(part);
  }
  return out.length ? out.join("/") : ".";
}

export function assertBuildSupervisorUrl(raw: string): URL {
  const configured = String(raw ?? "").trim();
  if (!configured) {
    throw new Error("CODING_BUILD_SUPERVISOR_URL is not configured");
  }
  const base = new URL(configured);
  if (
    base.protocol !== "http:" ||
    !LOCAL_HOSTS.has(base.hostname)
  ) {
    throw new Error(
      "Build supervisor must use authenticated local-host HTTP (127.0.0.1, localhost, or host.docker.internal)"
    );
  }
  return base;
}

export type EphemeralBuildResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  command: string;
  cwdRel: string;
  tenantId: string;
  image?: string;
  network?: string;
  egressHosts?: string[];
  mode: "ephemeral";
};

export function codingBuildMode(): "off" | "ephemeral" {
  return config.codingBuildMode;
}

export function assertEphemeralBuildReady(): void {
  if (config.codingBuildMode !== "ephemeral") {
    throw new Error(
      "Ephemeral builds are disabled (CODING_BUILD_MODE is not ephemeral). Install the host build supervisor and set CODING_BUILD_MODE=ephemeral."
    );
  }
  if (!config.codingBuildSupervisorUrl.trim() || !config.codingBuildSupervisorToken) {
    throw new Error(
      "Ephemeral builds require CODING_BUILD_SUPERVISOR_URL and CODING_BUILD_SUPERVISOR_TOKEN (fail closed)."
    );
  }
  assertBuildSupervisorUrl(config.codingBuildSupervisorUrl);
}

export async function runEphemeralBuild(opts: {
  tenantId?: string | null;
  root?: string;
  cwd?: string;
  command: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<EphemeralBuildResult> {
  assertEphemeralBuildReady();
  const tenantId = String(opts.tenantId ?? "").trim();
  if (!tenantId) {
    throw new Error("tenantId is required for ephemeral builds");
  }
  const command = normalizeBuildCommand(opts.command);
  const cwdRel = sanitizeCwdRel(opts.cwd);
  // Ensure cwd exists under coding root (Layer 1) before asking the supervisor.
  resolveRepoPath(cwdRel, { tenantId: opts.tenantId, root: opts.root });

  const base = assertBuildSupervisorUrl(config.codingBuildSupervisorUrl);
  const url = new URL("v1/build", `${base.href.replace(/\/?$/, "/")}`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.codingBuildSupervisorToken}`,
    },
    body: JSON.stringify({
      tenantId,
      cwdRel,
      command,
      timeoutMs: opts.timeoutMs,
      network: config.codingBuildNet,
    }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Build supervisor returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      String(body.error ?? `Build supervisor rejected request (HTTP ${res.status})`)
    );
  }
  return {
    exitCode: Number(body.exitCode ?? 1),
    stdout: String(body.stdout ?? ""),
    stderr: String(body.stderr ?? ""),
    timedOut: Boolean(body.timedOut),
    durationMs: Number(body.durationMs ?? 0),
    command: String(body.command ?? command),
    cwdRel: String(body.cwdRel ?? cwdRel),
    tenantId: String(body.tenantId ?? tenantId),
    image: body.image != null ? String(body.image) : undefined,
    network: body.network != null ? String(body.network) : undefined,
    egressHosts: Array.isArray(body.egressHosts)
      ? body.egressHosts.map((h) => String(h))
      : undefined,
    mode: "ephemeral",
  };
}
