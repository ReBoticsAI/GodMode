import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  McpConfigSourceKind,
  McpServerDiscovery,
  McpWorkspaceDiscovery,
  PlatformContext,
} from "../../types/platform-context.js";
import { resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";

export type {
  McpConfigSourceKind,
  McpServerDiscovery,
  McpWorkspaceDiscovery,
};

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

/** Primary GodMode MCP config (same `mcpServers` schema as Cursor). */
export const GODMODE_MCP_RELATIVE_PATH = path.join(".godmode", "mcp.json");
/** Cursor compatibility I/O. Used only when the GodMode file is absent. */
export const CURSOR_MCP_RELATIVE_PATH = path.join(".cursor", "mcp.json");

type ParsedMcpFile =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; servers: Record<string, unknown> };

function parseMcpServersFile(filePath: string): ParsedMcpFile {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { status: "missing" };
    }
  } catch {
    return { status: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { status: "invalid" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "invalid" };
  }
  const serversRaw = (parsed as Record<string, unknown>).mcpServers;
  if (
    typeof serversRaw !== "object" ||
    serversRaw === null ||
    Array.isArray(serversRaw)
  ) {
    return { status: "invalid" };
  }
  return { status: "ok", servers: serversRaw as Record<string, unknown> };
}

/**
 * Load workspace MCP servers. Prefers `.godmode/mcp.json`. Falls back to
 * `.cursor/mcp.json` only when the GodMode file is absent. An invalid
 * GodMode file is a soft-fail (no Cursor fallback).
 */
function readMcpServersObject(codingRoot: string): {
  filePath: string;
  servers: Record<string, unknown>;
  sourceKind: McpConfigSourceKind;
} | null {
  if (!codingRoot?.trim()) return null;
  const root = path.resolve(codingRoot);
  const nativePath = path.join(root, GODMODE_MCP_RELATIVE_PATH);
  const native = parseMcpServersFile(nativePath);
  if (native.status === "invalid") return null;
  if (native.status === "ok") {
    return {
      filePath: nativePath,
      servers: native.servers,
      sourceKind: "godmode",
    };
  }
  const cursorPath = path.join(root, CURSOR_MCP_RELATIVE_PATH);
  const cursor = parseMcpServersFile(cursorPath);
  if (cursor.status !== "ok") return null;
  return {
    filePath: cursorPath,
    servers: cursor.servers,
    sourceKind: "cursor",
  };
}

function executionNote(execution: McpDiscoveryExecution): string {
  if (execution === "sdk-inline") {
    return "passed to Cursor SDK (mcpServers)";
  }
  if (execution === "sdk-project") {
    return "available via Cursor SDK project settings";
  }
  if (execution === "bridge-host") {
    return "hosted by Bridge MCP (customTools; sandboxed cursor_cloud or local backends)";
  }
  return "discovery only (not executed by Bridge)";
}

/**
 * Whether cursor_cloud should pass workspace MCP config as inline SDK
 * `mcpServers`. Explicit `mcpFromWorkspace` wins; otherwise default on
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
 * cursor_cloud + MCP on + Bridge host (sandboxed SaaS) → bridge-host;
 * cursor_cloud + MCP on without Bridge host → sdk-inline;
 * cursor_cloud with project settingSources only → sdk-project;
 * non-SDK with host gate → bridge-host; else discovery-only.
 */
export function resolveMcpDiscoveryExecution(args: {
  backend?: string | null;
  mcpFromWorkspace?: boolean;
  hasProjectSettingSources?: boolean;
  /** Prefer Bridge host over SDK inline (sandboxed cursor_cloud). */
  bridgeHostForCursorCloud?: boolean;
}): McpDiscoveryExecution {
  if (args.backend === "cursor_cloud") {
    if (args.mcpFromWorkspace) {
      return args.bridgeHostForCursorCloud ? "bridge-host" : "sdk-inline";
    }
    if (args.hasProjectSettingSources) return "sdk-project";
    return "discovery-only";
  }
  if (args.backend && args.mcpFromWorkspace) return "bridge-host";
  return "discovery-only";
}

/**
 * Parse coding-root MCP config into SDK `mcpServers` shape.
 * Prefers `.godmode/mcp.json`, else `.cursor/mcp.json`. Soft-fails on
 * missing/invalid entries. Caps server count.
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
    .update(`${loaded.sourceKind}|${mtime}|${names}|skip:${skip}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Read coding-root MCP config for prompt awareness.
 * Prefers `.godmode/mcp.json`, else `.cursor/mcp.json`. Soft-fails on
 * missing/invalid JSON. Never returns env values or headers.
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
    sourceKind: loaded.sourceKind,
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
