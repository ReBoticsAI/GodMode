/**
 * Bridge MCP host for local / provider / hub backends (#449).
 * Spawns or connects workspace MCP servers (tenant `ai_settings`, else
 * `.godmode/mcp.json`, else `.cursor/mcp.json`) and exposes tools to
 * Intelligence. Cursor SDK backends keep their own pass-through path.
 *
 * Sessions are per-agent and include tenantId so SaaS never shares MCP
 * processes across tenants. Stdio spawns use the Layer 3 bubblewrap jail when
 * `CODING_TERMINAL_SANDBOX=required` (same fail-closed bar as coding terminal).
 * Auth: static headers/env from workspace settings; values
 * prefixed with `vault:` or `{{vault:…}}` resolve via the supplied Vault callback.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import path from "node:path";
import {
  MAX_SDK_MCP_SERVERS,
  cursorMcpServersFingerprint,
  loadCursorMcpServersForSdk,
  resolveMcpFromWorkspace,
  type CursorSdkMcpServerConfig,
  type McpWorkspaceOverlay,
} from "./cursor-mcp-config.js";
import { shellQuoteArgv } from "./sandboxed-process.js";
import {
  startTerminalEgressProxy,
  type TerminalEgressProxyHandle,
} from "./terminal-egress-proxy.js";
import {
  assertSandboxReadyForTerminal,
  buildBubblewrapArgs,
  codingTerminalEgressHosts,
  codingTerminalNetPolicy,
  requiresTerminalSandbox,
  type CodingTerminalNet,
} from "./terminal-sandbox.js";

/** Local shape to avoid circular import with ai-tools-registry. */
export type BridgeMcpAiToolDef = {
  name: string;
  description: string;
  mode: "auto" | "confirm";
  parameters?: Record<string, unknown>;
  category?: string;
  write?: boolean;
};

export const MCP_TOOL_PREFIX = "gm_mcp__";
const CONNECT_TIMEOUT_MS = 15_000;

export type BridgeMcpServerStatus = {
  name: string;
  ok: boolean;
  toolCount: number;
  error?: string | null;
};

type McpHostTool = {
  serverName: string;
  toolName: string;
  qualifiedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
};

type ConnectedServer = {
  name: string;
  client: Client;
  transport: Transport;
  tools: McpHostTool[];
};

type AgentMcpState = {
  agentId: string;
  tenantId: string;
  codingRoot: string;
  fingerprint: string;
  servers: ConnectedServer[];
  tools: McpHostTool[];
  toolIndex: Map<string, { server: ConnectedServer; toolName: string }>;
  statuses: BridgeMcpServerStatus[];
  egressProxy: TerminalEgressProxyHandle | null;
};

function normalizeTenantId(tenantId?: string | null): string {
  const t = tenantId?.trim();
  return t || "__local__";
}

/**
 * Exposed LLM tool name: `gm_mcp__<server>__<tool>`.
 * Avoids the Cursor-reserved `mcp__` / ambient MCP Auto-review path.
 */
export function mcpExposedToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

export function qualifyMcpToolName(serverName: string, toolName: string): string {
  return mcpExposedToolName(serverName, toolName);
}

export function parseBridgeMcpToolName(
  name: string
): { serverKey: string; toolKey: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const idx = rest.indexOf("__");
  if (idx <= 0 || idx === rest.length - 2) return null;
  const serverKey = rest.slice(0, idx);
  const toolKey = rest.slice(idx + 2);
  if (!serverKey || !toolKey) return null;
  return { serverKey, toolKey };
}

export function isBridgeMcpToolName(name: string): boolean {
  return parseBridgeMcpToolName(name) != null;
}

/**
 * Whether Bridge should host MCP for this agent.
 * Legacy `cursor` CLI backend stays off.
 * `cursor_cloud` uses Bridge host when MCP is enabled and the SDK sandbox is
 * on: SDK inline `mcpServers` fail closed under Auto-review (no interactive
 * approval), while Bridge tools run as SDK `customTools` and stay callable.
 * Other backends: same gate as SDK inline (default on non-SaaS; SaaS opt-in).
 */
export function resolveBridgeMcpHostEnabled(args: {
  backend?: string | null;
  mcpFromWorkspace?: unknown;
  isSaas?: boolean;
  /** Hub/SaaS Linux sandbox (`CURSOR_SDK_SANDBOX=required`). */
  sdkSandboxEnabled?: boolean;
}): boolean {
  if (args.backend === "cursor") return false;
  if (!args.backend) return false;
  const gated = resolveMcpFromWorkspace(
    { mcpFromWorkspace: args.mcpFromWorkspace },
    { isSaas: args.isSaas }
  );
  if (args.backend === "cursor_cloud") {
    return gated && Boolean(args.sdkSandboxEnabled);
  }
  return gated;
}

/** Parse `vault:name` or `{{vault:name}}`. */
export function parseVaultSecretRef(raw: string): string | null {
  const trimmed = raw.trim();
  const braced = trimmed.match(/^\{\{\s*vault:([^}]+)\s*\}\}$/i);
  if (braced?.[1]) return braced[1].trim() || null;
  if (/^vault:/i.test(trimmed)) {
    const name = trimmed.slice(trimmed.indexOf(":") + 1).trim();
    return name || null;
  }
  return null;
}

export function resolveMcpVaultRefValue(
  raw: string,
  resolveVaultSecret?: (name: string) => string | null
): string {
  const secretName = parseVaultSecretRef(raw);
  if (!secretName) return raw;
  if (!resolveVaultSecret) {
    throw new Error(
      `MCP vault ref "${raw}" requires Bridge Vault resolution`
    );
  }
  const plain = resolveVaultSecret(secretName);
  if (!plain) {
    throw new Error(`Vault secret not found: ${secretName}`);
  }
  return plain;
}

export function resolveMcpVaultRefs(
  record: Record<string, string> | undefined,
  resolveVaultSecret?: (name: string) => string | null
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v !== "string") continue;
    out[k] = resolveMcpVaultRefValue(v, resolveVaultSecret);
  }
  return out;
}

export function resolveMcpStdioCwd(
  codingRoot: string,
  cfgCwd?: string | null
): string {
  const root = path.resolve(codingRoot);
  const raw = cfgCwd?.trim();
  const cwd = raw
    ? path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(root, raw)
    : root;
  const rel = path.relative(root, cwd);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("MCP stdio cwd escapes coding root");
  }
  return cwd;
}

export type McpStdioSpawnPlan = {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  sandboxed: boolean;
};

export type McpStdioJailProxy = {
  proxyUrl: string;
  jailSocketPath: string;
  hostEgressDir: string;
};

/** Build bwrap argv for stdio MCP. Does not probe bubblewrap. */
export function buildMcpStdioJailSpawn(opts: {
  command: string;
  args?: string[];
  codingRoot: string;
  cwd: string;
  envResolved?: Record<string, string>;
  net?: CodingTerminalNet;
  proxy?: McpStdioJailProxy | null;
}): McpStdioSpawnPlan {
  const net = codingTerminalNetPolicy({ net: opts.net });
  if (net === "allowlist" && !opts.proxy) {
    throw new Error(
      "MCP stdio allowlist net requires the Bridge UDS egress proxy"
    );
  }
  const quoted = shellQuoteArgv([opts.command, ...(opts.args ?? [])]);
  const args = buildBubblewrapArgs({
    codingRoot: opts.codingRoot,
    cwd: opts.cwd,
    net,
    command: quoted,
    jailEnv: opts.envResolved,
    proxyUrl: opts.proxy?.proxyUrl,
    jailSocketPath: opts.proxy?.jailSocketPath,
    hostEgressDir: opts.proxy?.hostEgressDir,
  });
  return {
    command: "bwrap",
    args,
    cwd: path.resolve(opts.codingRoot),
    sandboxed: true,
  };
}

export function resolveMcpStdioSpawn(opts: {
  command: string;
  args?: string[];
  cfgCwd?: string | null;
  codingRoot: string;
  envResolved?: Record<string, string>;
  net?: CodingTerminalNet;
  proxy?: McpStdioJailProxy | null;
}): McpStdioSpawnPlan {
  const cwd = resolveMcpStdioCwd(opts.codingRoot, opts.cfgCwd);
  if (requiresTerminalSandbox()) {
    assertSandboxReadyForTerminal();
    return buildMcpStdioJailSpawn({
      command: opts.command,
      args: opts.args,
      codingRoot: opts.codingRoot,
      cwd,
      envResolved: opts.envResolved,
      net: opts.net,
      proxy: opts.proxy,
    });
  }
  const defaults = getDefaultEnvironment();
  const bridgeNodeModules = `${process.cwd()}${process.platform === "win32" ? "\\" : "/"}node_modules`;
  const nodePath = [bridgeNodeModules, defaults.NODE_PATH, process.env.NODE_PATH]
    .filter(Boolean)
    .join(process.platform === "win32" ? ";" : ":");
  return {
    command: opts.command,
    args: opts.args,
    cwd,
    env: {
      ...defaults,
      ...(opts.envResolved ?? {}),
      NODE_PATH: nodePath,
    },
    sandboxed: false,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

async function connectStdio(
  name: string,
  cfg: Extract<CursorSdkMcpServerConfig, { command: string }>,
  envResolved: Record<string, string> | undefined,
  codingRoot: string,
  proxy?: McpStdioJailProxy | null
): Promise<{ client: Client; transport: Transport }> {
  const spawn = resolveMcpStdioSpawn({
    command: cfg.command,
    args: cfg.args,
    cfgCwd: cfg.cwd,
    codingRoot,
    envResolved,
    proxy,
  });
  const transport = new StdioClientTransport({
    command: spawn.command,
    args: spawn.args,
    env: spawn.env,
    cwd: spawn.cwd,
    stderr: "pipe",
  });
  const client = new Client({
    name: `godmode-bridge:${name}`,
    version: "0.9.1",
  });
  await withTimeout(
    client.connect(transport),
    CONNECT_TIMEOUT_MS,
    `MCP stdio ${name}`
  );
  return { client, transport };
}

async function connectHttpOrSse(
  name: string,
  cfg: Extract<CursorSdkMcpServerConfig, { url: string }>,
  headersResolved?: Record<string, string>
): Promise<{ client: Client; transport: Transport }> {
  const url = new URL(cfg.url);
  const requestInit =
    headersResolved && Object.keys(headersResolved).length
      ? { headers: headersResolved }
      : undefined;
  const client = new Client({
    name: `godmode-bridge:${name}`,
    version: "0.9.1",
  });

  if (cfg.type === "sse") {
    const transport = new SSEClientTransport(url, { requestInit });
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `MCP sse ${name}`
    );
    return { client, transport };
  }

  try {
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `MCP http ${name}`
    );
    return { client, transport };
  } catch {
    const transport = new SSEClientTransport(url, { requestInit });
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `MCP sse-fallback ${name}`
    );
    return { client, transport };
  }
}

function toolReadOnlyHint(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const annotations = (raw as { annotations?: unknown }).annotations;
  if (!annotations || typeof annotations !== "object") return false;
  return Boolean((annotations as { readOnlyHint?: unknown }).readOnlyHint);
}

async function listServerTools(
  serverName: string,
  client: Client
): Promise<McpHostTool[]> {
  const listed = await client.listTools();
  const tools: McpHostTool[] = [];
  for (const t of listed.tools ?? []) {
    const toolName = typeof t.name === "string" ? t.name.trim() : "";
    if (!toolName) continue;
    const inputSchema =
      t.inputSchema && typeof t.inputSchema === "object"
        ? (t.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {} };
    tools.push({
      serverName,
      toolName,
      qualifiedName: mcpExposedToolName(serverName, toolName),
      description:
        (typeof t.description === "string" && t.description.trim()) ||
        `MCP tool ${toolName} from server ${serverName}`,
      inputSchema,
      readOnly: toolReadOnlyHint(t),
    });
  }
  return tools;
}

function toolsToLlmSchemas(tools: McpHostTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.qualifiedName,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

function toolsToAiDefs(tools: McpHostTool[]): BridgeMcpAiToolDef[] {
  return tools.map((t) => ({
    name: t.qualifiedName,
    description: t.description,
    mode: t.readOnly ? ("auto" as const) : ("confirm" as const),
    parameters: t.inputSchema,
    category: "mcp",
    write: !t.readOnly,
  }));
}

const agentStates = new Map<string, AgentMcpState>();

/**
 * Confirm mode for a Bridge-hosted MCP tool.
 * Honors MCP `annotations.readOnlyHint` (auto when true). Unknown / unhosted
 * Bridge MCP names default to confirm.
 */
export function getBridgeMcpToolMode(
  name: string
): "auto" | "confirm" | null {
  if (!isBridgeMcpToolName(name)) return null;
  for (const state of agentStates.values()) {
    const tool = state.tools.find((t) => t.qualifiedName === name);
    if (tool) return tool.readOnly ? "auto" : "confirm";
  }
  return "confirm";
}

async function disposeAgentState(agentId: string): Promise<void> {
  const state = agentStates.get(agentId);
  if (!state) return;
  agentStates.delete(agentId);
  for (const srv of state.servers) {
    try {
      await srv.client.close();
    } catch {
      /* ignore */
    }
    try {
      await srv.transport.close();
    } catch {
      /* ignore */
    }
  }
  if (state.egressProxy) {
    try {
      await state.egressProxy.close();
    } catch {
      /* ignore */
    }
  }
}

async function connectOne(
  name: string,
  cfg: CursorSdkMcpServerConfig,
  codingRoot: string,
  resolveVaultSecret?: (name: string) => string | null,
  proxy?: McpStdioJailProxy | null
): Promise<ConnectedServer> {
  if ("command" in cfg && cfg.command) {
    const env = resolveMcpVaultRefs(cfg.env, resolveVaultSecret);
    const { client, transport } = await connectStdio(
      name,
      cfg,
      env,
      codingRoot,
      proxy
    );
    const tools = await listServerTools(name, client);
    return { name, client, transport, tools };
  }
  if ("url" in cfg && cfg.url) {
    const headers = resolveMcpVaultRefs(cfg.headers, resolveVaultSecret);
    let next = cfg;
    if (cfg.auth?.CLIENT_SECRET && parseVaultSecretRef(cfg.auth.CLIENT_SECRET)) {
      next = {
        ...cfg,
        auth: {
          ...cfg.auth,
          CLIENT_SECRET: resolveMcpVaultRefValue(
            cfg.auth.CLIENT_SECRET,
            resolveVaultSecret
          ),
        },
      };
    }
    const { client, transport } = await connectHttpOrSse(name, next, headers);
    const tools = await listServerTools(name, client);
    return { name, client, transport, tools };
  }
  throw new Error(`Unsupported MCP server config for "${name}"`);
}

export type EnsureBridgeMcpHostResult = {
  schemas: ReturnType<typeof toolsToLlmSchemas>;
  statuses: BridgeMcpServerStatus[];
  tools: McpHostTool[];
};

/**
 * Warm or refresh the Bridge MCP host for one agent.
 * When disabled, clears cached tools so they leave the agent tool list.
 */
export async function ensureBridgeMcpHost(args: {
  tenantId?: string | null;
  agentId: string;
  codingRoot: string;
  enabled: boolean;
  disabled?: readonly string[];
  workspace?: McpWorkspaceOverlay | null;
  resolveVaultSecret?: (name: string) => string | null;
}): Promise<EnsureBridgeMcpHostResult> {
  const agentId = args.agentId.trim();
  if (!agentId) {
    return { schemas: [], statuses: [], tools: [] };
  }

  if (!args.enabled) {
    await disposeAgentState(agentId);
    return { schemas: [], statuses: [], tools: [] };
  }

  const fingerprint = cursorMcpServersFingerprint(
    args.codingRoot,
    true,
    args.disabled,
    args.workspace
  );
  const tenantId = normalizeTenantId(args.tenantId);
  const existing = agentStates.get(agentId);
  if (
    existing &&
    existing.tenantId === tenantId &&
    existing.codingRoot === args.codingRoot &&
    existing.fingerprint === fingerprint
  ) {
    return {
      schemas: toolsToLlmSchemas(existing.tools),
      statuses: existing.statuses,
      tools: existing.tools,
    };
  }

  await disposeAgentState(agentId);

  const serversCfg =
    loadCursorMcpServersForSdk(args.codingRoot, {
      disabled: args.disabled,
      workspace: args.workspace,
    }) ?? {};

  const connected: ConnectedServer[] = [];
  const statuses: BridgeMcpServerStatus[] = [];
  const tools: McpHostTool[] = [];
  const toolIndex = new Map<
    string,
    { server: ConnectedServer; toolName: string }
  >();

  const names = Object.keys(serversCfg).sort((a, b) => a.localeCompare(b));
  const needsStdio = names.some((name) => {
    const cfg = serversCfg[name];
    return Boolean(cfg && "command" in cfg && cfg.command);
  });

  let egressProxy: TerminalEgressProxyHandle | null = null;
  if (
    needsStdio &&
    requiresTerminalSandbox() &&
    codingTerminalNetPolicy() === "allowlist"
  ) {
    egressProxy = await startTerminalEgressProxy({
      codingRoot: args.codingRoot,
      allowlist: codingTerminalEgressHosts(),
    });
  }
  const stdioProxy: McpStdioJailProxy | null = egressProxy
    ? {
        proxyUrl: egressProxy.jailProxyUrl,
        jailSocketPath: egressProxy.jailSocketPath,
        hostEgressDir: egressProxy.hostEgressDir,
      }
    : null;

  for (const name of names.slice(0, MAX_SDK_MCP_SERVERS)) {
    const cfg = serversCfg[name];
    if (!cfg) continue;
    try {
      const srv = await connectOne(
        name,
        cfg,
        args.codingRoot,
        args.resolveVaultSecret,
        stdioProxy
      );
      connected.push(srv);
      for (const t of srv.tools) {
        tools.push(t);
        toolIndex.set(t.qualifiedName, {
          server: srv,
          toolName: t.toolName,
        });
      }
      statuses.push({
        name,
        ok: true,
        toolCount: srv.tools.length,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp-host] failed to connect server "${name}":`, message);
      statuses.push({
        name,
        ok: false,
        toolCount: 0,
        error: message,
      });
    }
  }

  agentStates.set(agentId, {
    agentId,
    tenantId,
    codingRoot: args.codingRoot,
    fingerprint,
    servers: connected,
    tools,
    toolIndex,
    statuses,
    egressProxy,
  });

  return {
    schemas: toolsToLlmSchemas(tools),
    statuses,
    tools,
  };
}

export function getBridgeMcpToolDefsForAgent(agentId: string): BridgeMcpAiToolDef[] {
  const state = agentStates.get(agentId);
  if (!state) return [];
  return toolsToAiDefs(state.tools);
}

export function getBridgeMcpToolSchemasForAgent(agentId: string) {
  const state = agentStates.get(agentId);
  if (!state) return [];
  return toolsToLlmSchemas(state.tools);
}

export function getBridgeMcpStatusesForAgent(
  agentId: string
): BridgeMcpServerStatus[] {
  return agentStates.get(agentId)?.statuses ?? [];
}

export async function executeBridgeMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { agentId: string; tenantId?: string | null }
): Promise<unknown> {
  const state = agentStates.get(ctx.agentId);
  if (!state) {
    throw new Error(
      "MCP host session not ready; enable workspace MCP on Agents → Pipeline → MCP and retry"
    );
  }
  if (state.tenantId !== normalizeTenantId(ctx.tenantId)) {
    throw new Error("MCP host tenant mismatch");
  }
  const hit = state.toolIndex.get(name);
  if (!hit) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  return hit.server.client.callTool({
    name: hit.toolName,
    arguments: args,
  });
}

/** Test helper: clear all agent MCP state. */
export async function resetBridgeMcpHostForTests(): Promise<void> {
  const ids = [...agentStates.keys()];
  await Promise.all(ids.map((id) => disposeAgentState(id)));
}
