import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  McpServerDiscovery,
  McpWorkspaceDiscovery,
  PlatformContext,
} from "../../types/platform-context.js";
import { resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";

export type { McpServerDiscovery, McpWorkspaceDiscovery };

const SUMMARY_CAP = 500;
const MAX_SERVERS_IN_SUMMARY = 12;
/** Cap inline SDK MCP servers to limit stdio process fan-out. */
export const MAX_SDK_MCP_SERVERS = 8;

export type McpDiscoveryExecution =
  | "discovery-only"
  | "sdk-project"
  | "sdk-inline"
  | "bridge-host";

/** SDK-compatible MCP server config (stdio or http/sse). */
export type CursorSdkMcpServerConfig =
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type?: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
      auth?: {
        CLIENT_ID: string;
        CLIENT_SECRET?: string;
        scopes?: string[];
      };
    };

export type CursorSdkMcpServers = Record<string, CursorSdkMcpServerConfig>;

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_CAP) return summary;
  return `${summary.slice(0, SUMMARY_CAP - 1)}…`;
}

function hostFromUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return u.host || undefined;
  } catch {
    return undefined;
  }
}

function inferTransport(
  cfg: Record<string, unknown>
): McpServerDiscovery["transport"] {
  const typed = typeof cfg.type === "string" ? cfg.type.trim().toLowerCase() : "";
  if (typed === "stdio" || typed === "local") return "stdio";
  if (typed === "http" || typed === "streamable-http") return "http";
  if (typed === "sse") return "sse";
  if (typeof cfg.command === "string" && cfg.command.trim()) return "stdio";
  if (
    (typeof cfg.url === "string" && cfg.url.trim()) ||
    (typeof cfg.serverUrl === "string" && cfg.serverUrl.trim())
  ) {
    return "http";
  }
  return "unknown";
}

/** Safe one-line detail: command binary or URL host only. Never env/headers. */
function safeDetail(
  cfg: Record<string, unknown>,
  transport: McpServerDiscovery["transport"]
): string | undefined {
  if (transport === "stdio" && typeof cfg.command === "string") {
    const cmd = cfg.command.trim();
    return cmd ? `cmd:${cmd}` : undefined;
  }
  const urlRaw =
    (typeof cfg.url === "string" && cfg.url.trim()) ||
    (typeof cfg.serverUrl === "string" && cfg.serverUrl.trim()) ||
    "";
  if (urlRaw) {
    const host = hostFromUrl(urlRaw);
    return host ? `host:${host}` : "url";
  }
  return undefined;
}

function parseServerEntry(
  name: string,
  raw: unknown
): McpServerDiscovery | null {
  const id = name.trim();
  if (!id || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const cfg = raw as Record<string, unknown>;
  const transport = inferTransport(cfg);
  const detail = safeDetail(cfg, transport);
  return detail ? { name: id, transport, detail } : { name: id, transport };
}

function stringRecord(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseSdkServerEntry(
  name: string,
  raw: unknown
): CursorSdkMcpServerConfig | null {
  const id = name.trim();
  if (!id || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const cfg = raw as Record<string, unknown>;
  const transport = inferTransport(cfg);

  if (transport === "stdio") {
    const command = typeof cfg.command === "string" ? cfg.command.trim() : "";
    if (!command) return null;
    const args = Array.isArray(cfg.args)
      ? cfg.args.filter((a): a is string => typeof a === "string")
      : undefined;
    const env = stringRecord(cfg.env);
    const cwd =
      typeof cfg.cwd === "string" && cfg.cwd.trim() ? cfg.cwd.trim() : undefined;
    return {
      type: "stdio",
      command,
      ...(args?.length ? { args } : {}),
      ...(env ? { env } : {}),
      ...(cwd ? { cwd } : {}),
    };
  }

  if (transport === "http" || transport === "sse") {
    const url =
      (typeof cfg.url === "string" && cfg.url.trim()) ||
      (typeof cfg.serverUrl === "string" && cfg.serverUrl.trim()) ||
      "";
    if (!url) return null;
    const headers = stringRecord(cfg.headers);
    let auth:
      | {
          CLIENT_ID: string;
          CLIENT_SECRET?: string;
          scopes?: string[];
        }
      | undefined;
    if (
      typeof cfg.auth === "object" &&
      cfg.auth !== null &&
      !Array.isArray(cfg.auth)
    ) {
      const a = cfg.auth as Record<string, unknown>;
      const clientId =
        typeof a.CLIENT_ID === "string"
          ? a.CLIENT_ID
          : typeof a.clientId === "string"
            ? a.clientId
            : "";
      if (clientId) {
        const scopes = Array.isArray(a.scopes)
          ? a.scopes.filter((s): s is string => typeof s === "string")
          : undefined;
        const secret =
          typeof a.CLIENT_SECRET === "string"
            ? a.CLIENT_SECRET
            : typeof a.clientSecret === "string"
              ? a.clientSecret
              : undefined;
        auth = {
          CLIENT_ID: clientId,
          ...(secret ? { CLIENT_SECRET: secret } : {}),
          ...(scopes?.length ? { scopes } : {}),
        };
      }
    }
    return {
      type: transport === "sse" ? "sse" : "http",
      url,
      ...(headers ? { headers } : {}),
      ...(auth ? { auth } : {}),
    };
  }

  return null;
}

function readMcpServersObject(
  codingRoot: string
): { filePath: string; servers: Record<string, unknown> } | null {
  if (!codingRoot?.trim()) return null;
  const filePath = path.join(path.resolve(codingRoot), ".cursor", "mcp.json");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const serversRaw = (parsed as Record<string, unknown>).mcpServers;
  if (
    typeof serversRaw !== "object" ||
    serversRaw === null ||
    Array.isArray(serversRaw)
  ) {
    return null;
  }
  return { filePath, servers: serversRaw as Record<string, unknown> };
}

function executionNote(execution: McpDiscoveryExecution): string {
  if (execution === "sdk-inline") {
    return "passed to Cursor SDK (mcpServers)";
  }
  if (execution === "sdk-project") {
    return "available via Cursor SDK project settings";
  }
  if (execution === "bridge-host") {
    return "hosted by Bridge MCP (local/provider backends)";
  }
  return "discovery only (not executed by Bridge)";
}

/**
 * Whether cursor_cloud should pass workspace `.cursor/mcp.json` as inline
 * SDK `mcpServers`. Explicit `mcpFromWorkspace` wins; otherwise default on
 * for non-SaaS and off on SaaS (stdio MCP on shared hosts is opt-in).
 */
export function resolveMcpFromWorkspace(
  cfg: { mcpFromWorkspace?: unknown } | null | undefined,
  opts?: { isSaas?: boolean }
): boolean {
  if (typeof cfg?.mcpFromWorkspace === "boolean") return cfg.mcpFromWorkspace;
  return !(opts?.isSaas ?? false);
}

/**
 * How the MCP Page Context line should describe availability for this agent.
 * cursor_cloud with inline gate → sdk-inline; otherwise cursor_cloud with
 * project settingSources → sdk-project; non-SDK with host gate → bridge-host;
 * else discovery-only.
 */
export function resolveMcpDiscoveryExecution(args: {
  backend?: string | null;
  mcpFromWorkspace?: boolean;
  hasProjectSettingSources?: boolean;
}): McpDiscoveryExecution {
  if (args.backend === "cursor_cloud") {
    if (args.mcpFromWorkspace) return "sdk-inline";
    if (args.hasProjectSettingSources) return "sdk-project";
    return "discovery-only";
  }
  if (args.backend && args.mcpFromWorkspace) return "bridge-host";
  return "discovery-only";
}

/**
 * Parse coding-root `.cursor/mcp.json` into SDK `mcpServers` shape.
 * Soft-fails on missing/invalid entries. Caps server count.
 * `@param opts.disabled` names are omitted (case-sensitive match on server key).
 */
export function loadCursorMcpServersForSdk(
  codingRoot: string,
  opts?: { disabled?: readonly string[] }
): CursorSdkMcpServers | undefined {
  const loaded = readMcpServersObject(codingRoot);
  if (!loaded) return undefined;

  const disabled = new Set(
    (opts?.disabled ?? []).map((n) => n.trim()).filter(Boolean)
  );
  const names = Object.keys(loaded.servers).sort((a, b) => a.localeCompare(b));
  const out: CursorSdkMcpServers = {};
  for (const name of names) {
    if (disabled.has(name)) continue;
    if (Object.keys(out).length >= MAX_SDK_MCP_SERVERS) break;
    const parsed = parseSdkServerEntry(name, loaded.servers[name]);
    if (parsed) out[name] = parsed;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Fingerprint for cache invalidation when MCP file, gate, or disables change. */
export function cursorMcpServersFingerprint(
  codingRoot: string,
  enabled: boolean,
  disabled?: readonly string[]
): string {
  if (!enabled) return "";
  const loaded = readMcpServersObject(codingRoot);
  if (!loaded) return "on";
  let mtime = "0";
  try {
    mtime = String(fs.statSync(loaded.filePath).mtimeMs);
  } catch {
    /* ignore */
  }
  const names = Object.keys(loaded.servers).sort().join(",");
  const skip = [...(disabled ?? [])]
    .map((n) => n.trim())
    .filter(Boolean)
    .sort()
    .join(",");
  return createHash("sha256")
    .update(`${mtime}|${names}|skip:${skip}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Read coding-root `.cursor/mcp.json` for prompt awareness.
 * Soft-fails on missing/invalid JSON. Never returns env values or headers.
 */
export function collectCursorMcpDiscovery(
  codingRoot: string,
  opts?: { execution?: McpDiscoveryExecution }
): McpWorkspaceDiscovery | null {
  const loaded = readMcpServersObject(codingRoot);
  if (!loaded) return null;

  const servers: McpServerDiscovery[] = [];
  for (const [name, entry] of Object.entries(loaded.servers)) {
    const server = parseServerEntry(name, entry);
    if (server) servers.push(server);
  }
  if (servers.length === 0) return null;

  servers.sort((a, b) => a.name.localeCompare(b.name));

  const listed = servers.slice(0, MAX_SERVERS_IN_SUMMARY);
  const parts = listed.map((s) => {
    const base = `${s.name} (${s.transport})`;
    return s.detail ? `${base} ${s.detail}` : base;
  });
  if (servers.length > listed.length) {
    parts.push(`+${servers.length - listed.length} more`);
  }
  parts.push(executionNote(opts?.execution ?? "discovery-only"));

  return {
    servers,
    sourcePath: loaded.filePath,
    summary: truncateSummary(parts.join(" | ")),
  };
}

/** Resolve coding root then attach MCP discovery onto platform context. */
export function enrichPlatformContextWithMcp(
  ctx: PlatformContext | undefined,
  opts?: FsRootOpts & {
    workspace?: string | null;
    execution?: McpDiscoveryExecution;
  }
): PlatformContext | undefined {
  const root = resolveCodingRoot({
    tenantId: opts?.tenantId,
    root: opts?.workspace?.trim() || opts?.root,
  });
  const discovery = collectCursorMcpDiscovery(root, {
    execution: opts?.execution,
  });
  if (!discovery) return ctx;
  return { ...(ctx ?? {}), mcpDiscovery: discovery };
}
