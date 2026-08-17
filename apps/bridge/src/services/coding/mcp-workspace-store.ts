import type { AppDatabase } from "../../db.js";
import { MAX_SDK_MCP_SERVERS } from "./cursor-mcp-config.js";

export const WORKSPACE_MCP_SETTINGS_KEY = "mcp.servers";
export const WORKSPACE_MCP_SOURCE_PATH = "workspace:ai_settings:mcp.servers";

export type McpWorkspaceOverlay = {
  /** True when the tenant setting exists (including an empty map). */
  present: boolean;
  servers: Record<string, unknown>;
};

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function parseServersMap(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  const nested = raw.mcpServers;
  const map = isPlainObject(nested) ? nested : raw;
  if (!isPlainObject(map)) return null;
  return map;
}

export function getWorkspaceMcpOverlay(db: AppDatabase): McpWorkspaceOverlay {
  const row = db
    .prepare(`SELECT value FROM ai_settings WHERE key=?`)
    .get(WORKSPACE_MCP_SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return { present: false, servers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return { present: true, servers: {} };
  }
  const servers = parseServersMap(parsed);
  return { present: true, servers: servers ?? {} };
}

export function setWorkspaceMcpServers(
  db: AppDatabase,
  servers: Record<string, unknown>
): void {
  const names = Object.keys(servers);
  if (names.length > MAX_SDK_MCP_SERVERS) {
    throw new Error(`At most ${MAX_SDK_MCP_SERVERS} MCP servers`);
  }
  db.prepare(
    `INSERT INTO ai_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(WORKSPACE_MCP_SETTINGS_KEY, JSON.stringify({ mcpServers: servers }));
}

export function deleteWorkspaceMcpSetting(db: AppDatabase): void {
  db.prepare(`DELETE FROM ai_settings WHERE key=?`).run(
    WORKSPACE_MCP_SETTINGS_KEY
  );
}
