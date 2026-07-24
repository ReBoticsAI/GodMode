import fs from "node:fs";
import path from "node:path";
import type {
  McpServerDiscovery,
  McpWorkspaceDiscovery,
  PlatformContext,
} from "../../types/platform-context.js";
import { resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";

export type { McpServerDiscovery, McpWorkspaceDiscovery };

const SUMMARY_CAP = 500;
const MAX_SERVERS_IN_SUMMARY = 12;

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

/**
 * Read coding-root `.cursor/mcp.json` for prompt awareness.
 * Soft-fails on missing/invalid JSON. Never returns env values or headers.
 * Bridge does **not** spawn or connect to these servers from this path.
 */
export function collectCursorMcpDiscovery(
  codingRoot: string
): McpWorkspaceDiscovery | null {
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

  const root = parsed as Record<string, unknown>;
  const serversRaw = root.mcpServers;
  if (
    typeof serversRaw !== "object" ||
    serversRaw === null ||
    Array.isArray(serversRaw)
  ) {
    return null;
  }

  const servers: McpServerDiscovery[] = [];
  for (const [name, entry] of Object.entries(
    serversRaw as Record<string, unknown>
  )) {
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
  parts.push("discovery only (not executed by Bridge)");

  return {
    servers,
    sourcePath: filePath,
    summary: truncateSummary(parts.join(" | ")),
  };
}

/** Resolve coding root then attach MCP discovery onto platform context. */
export function enrichPlatformContextWithMcp(
  ctx: PlatformContext | undefined,
  opts?: FsRootOpts & { workspace?: string | null }
): PlatformContext | undefined {
  const root = resolveCodingRoot({
    tenantId: opts?.tenantId,
    root: opts?.workspace?.trim() || opts?.root,
  });
  const discovery = collectCursorMcpDiscovery(root);
  if (!discovery) return ctx;
  return { ...(ctx ?? {}), mcpDiscovery: discovery };
}
