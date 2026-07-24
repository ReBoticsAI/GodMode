export interface GitWorkspaceSnapshot {
  branch: string;
  dirtyCount: number;
  ahead: number;
  behind: number;
  summary: string;
}

/** Read-only summary of coding-root `.cursor/mcp.json` (no secrets, no execution). */
export interface McpServerDiscovery {
  name: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  /** Safe command binary or URL host only. */
  detail?: string;
}

export interface McpWorkspaceDiscovery {
  servers: McpServerDiscovery[];
  summary: string;
  sourcePath?: string;
}

export interface PlatformContext {
  breadcrumb?: string[];
  pathname?: string;
  pageKind?: string;
  pageLabel?: string;
  pageSnapshot?: unknown;
  mentionedSources?: Array<{ id: string; label: string; data: unknown }>;
  /** Compact coding-root git status (server-enriched). */
  gitSnapshot?: GitWorkspaceSnapshot;
  /** Compact coding-root MCP config discovery (server-enriched; not executed). */
  mcpDiscovery?: McpWorkspaceDiscovery;
}
