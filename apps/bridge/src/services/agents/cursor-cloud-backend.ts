import { createHash, randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppDatabase } from "../../db.js";
import { config } from "../../config.js";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AgentCursorCloudConfig } from "./types.js";
import { getToolSchemasForLlm } from "../ai-tools-registry.js";
import { executeTool, type ToolExecContext } from "../ai-tool-executor.js";
import { shouldAutoApproveTool } from "../confirm-policy.js";
import { resolveCursorApiKey } from "../cursor-subscription.js";
import type { IntelligenceChatMode } from "../chat-mode.js";
import type { AgentMessage } from "../ai-agent.js";
import {
  cursorMcpServersFingerprint,
  loadCursorMcpServersForSdk,
  resolveMcpFromWorkspace,
  type CursorSdkMcpServers,
} from "../coding/cursor-mcp-config.js";
import { getWorkspaceMcpOverlay } from "../coding/mcp-workspace-store.js";
import {
  isBridgeMcpToolName,
  resolveBridgeMcpHostEnabled,
} from "../coding/mcp-host.js";
import { ensureTenantCursorSandboxJson } from "../coding/cursor-sandbox-policy.js";
import { resolveCodingRoot } from "../coding/fs-tools.js";
import {
  budgetAndScrubToolResult,
  scrubSensitiveToolArgs,
} from "../secret-scrub.js";
import { withSecretValue } from "./agents-db.js";

/** Only project rules; never user/team/mdm/all (Bridge/SaaS isolation). */
export type CursorProjectSettingSource = "project";

type SdkAgent = Awaited<
  ReturnType<(typeof import("@cursor/sdk"))["Agent"]["create"]>
>;

interface ChatAgentEntry {
  agent: SdkAgent;
  /** Last structural fingerprint observed for this in-memory handle. */
  cacheFingerprint: string;
  /** Wall clock when this handle was created (Agent.create). */
  createdAt: number;
  /** Wall clock of last successful resolve/reuse. */
  lastUsedAt: number;
}

/** Soft cap for prior-turn transcript appendix (chars). */
export const TRANSCRIPT_CHAR_BUDGET = 10_000;
const TRANSCRIPT_MAX_TURNS = 12;
const TRANSCRIPT_PER_MESSAGE_CAP = 1_200;
const TRANSCRIPT_TOOL_ARGS_CAP = 400;
/** Align with chat-history `compactAgentMessages` tool-result truncation. */
const TRANSCRIPT_TOOL_RESULT_CAP = 1_500;

/**
 * Discard in-memory SDK handles after this much idle time.
 * Cursor cloud/gRPC sessions die while the Vault API key stays valid; forever
 * reuse is what surfaced as recurring AuthenticationError.
 */
export const CURSOR_SDK_AGENT_IDLE_MS = 10 * 60 * 1000;
/** Hard cap on a single SDK agent handle age even if the chat stays active. */
export const CURSOR_SDK_AGENT_MAX_AGE_MS = 60 * 60 * 1000;

const chatAgents = new Map<string, ChatAgentEntry>();

let idleMsForTests: number | null = null;
let maxAgeMsForTests: number | null = null;

/** @internal test helper */
export function setCursorSdkAgentTtlForTests(opts: {
  idleMs?: number | null;
  maxAgeMs?: number | null;
}): void {
  if ("idleMs" in opts) idleMsForTests = opts.idleMs ?? null;
  if ("maxAgeMs" in opts) maxAgeMsForTests = opts.maxAgeMs ?? null;
}

function agentIdleMs(): number {
  return idleMsForTests ?? CURSOR_SDK_AGENT_IDLE_MS;
}

function agentMaxAgeMs(): number {
  return maxAgeMsForTests ?? CURSOR_SDK_AGENT_MAX_AGE_MS;
}

/** True when a cached handle should be closed and replaced. */
export function isCursorSdkAgentCacheExpired(
  entry: { createdAt: number; lastUsedAt: number },
  nowMs: number,
  idleMs = agentIdleMs(),
  maxAgeMs = agentMaxAgeMs()
): boolean {
  return (
    nowMs - entry.lastUsedAt > idleMs || nowMs - entry.createdAt > maxAgeMs
  );
}

/** Mint a new Cursor-side agent id (never reuse a stable chat key as agentId). */
export function newCursorSdkAgentId(chatKey: string): string {
  return `${chatKey}-${randomBytes(6).toString("hex")}`;
}

/** True when Cursor SDK failed with a stale-session auth error (key usually still valid). */
export function isCursorSdkAuthStaleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();
  return (
    lower.includes("authentication error") ||
    lower.includes("error_not_logged_in") ||
    lower.includes("not_logged_in") ||
    lower.includes("[unauthenticated]") ||
    lower.includes("unauthenticated") ||
    /code\s*=\s*unauthenticated/i.test(msg)
  );
}

function closeCachedAgent(entry: ChatAgentEntry): void {
  try {
    entry.agent.close();
  } catch {
    /* ignore */
  }
}

/** Drop one in-memory SDK agent handle so the next turn creates a fresh connection. */
export function evictCursorSdkAgent(chatKey: string): void {
  const existing = chatAgents.get(chatKey);
  if (!existing) return;
  closeCachedAgent(existing);
  chatAgents.delete(chatKey);
}

/**
 * Clear all in-memory Cursor SDK agent handles.
 * Same Vault API key; new Agent.create on next chat turn.
 */
export function clearCursorCloudAgentCache(): void {
  for (const [key, entry] of chatAgents) {
    closeCachedAgent(entry);
    chatAgents.delete(key);
  }
}

/** @internal test helper */
export function clearCursorCloudAgentCacheForTests(): void {
  clearCursorCloudAgentCache();
  setCursorSdkAgentTtlForTests({ idleMs: null, maxAgeMs: null });
}

function filterSchemas(
  allow: string[] | null,
  agentId: string,
  db: AppDatabase,
  chatMode?: IntelligenceChatMode
) {
  const all = getToolSchemasForLlm(db, agentId, chatMode);
  if (!allow?.length) return all;
  if (allow.includes("*")) return all;
  const set = new Set(allow);
  // Bridge MCP tools sit outside toolAllow (same as SDK inline MCP).
  return all.filter(
    (t) => set.has(t.function.name) || isBridgeMcpToolName(t.function.name)
  );
}

function flattenTextContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function truncateFlat(text: string, cap: number): string {
  const body = flattenTextContent(text);
  if (body.length <= cap) return body;
  return `${body.slice(0, cap)}…`;
}

function truncateToolResult(content: string, cap: number): string {
  if (content.length <= cap) return content;
  const omitted = content.length - cap;
  return `${content.slice(0, cap)}\n[... ${omitted} chars omitted ...]`;
}

/** Serialize one history message into appendix lines (may be empty). */
export function formatTranscriptMessageLines(m: AgentMessage): string[] {
  if (m.role === "user") {
    const body = truncateFlat(m.content ?? "", TRANSCRIPT_PER_MESSAGE_CAP);
    return body ? [`User: ${body}`] : [];
  }
  if (m.role === "assistant") {
    const lines: string[] = [];
    const body = truncateFlat(m.content ?? "", TRANSCRIPT_PER_MESSAGE_CAP);
    if (body) lines.push(`Assistant: ${body}`);
    for (const tc of m.tool_calls ?? []) {
      const args = truncateFlat(tc.function.arguments ?? "", TRANSCRIPT_TOOL_ARGS_CAP);
      lines.push(
        args
          ? `Assistant tool_call ${tc.function.name}: ${args}`
          : `Assistant tool_call ${tc.function.name}`
      );
    }
    return lines;
  }
  if (m.role === "tool") {
    const label = m.name?.trim() || m.tool_call_id?.trim() || "tool";
    const body = truncateToolResult(m.content ?? "", TRANSCRIPT_TOOL_RESULT_CAP).trim();
    return body ? [`Tool[${label}]: ${body}`] : [];
  }
  return [];
}

/**
 * Rolling transcript for continuity when the SDK agent is reset (e.g. model
 * switch). Includes prior tool calls/results under a char budget. Drops system
 * messages and the current last user turn (sent as the live prompt). Not a
 * full SDK-native conversation resume.
 */
export function buildTranscriptAppendix(
  messages: AgentMessage[],
  budget = TRANSCRIPT_CHAR_BUDGET
): string {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx <= 0) return "";

  let prior = messages.slice(0, lastUserIdx).filter((m) => m.role !== "system");
  if (!prior.length) return "";

  const userStarts: number[] = [];
  for (let i = 0; i < prior.length; i++) {
    if (prior[i]!.role === "user") userStarts.push(i);
  }
  if (userStarts.length > TRANSCRIPT_MAX_TURNS) {
    prior = prior.slice(userStarts[userStarts.length - TRANSCRIPT_MAX_TURNS]!);
  }

  const blocks: string[] = [];
  let used = 0;
  for (let i = prior.length - 1; i >= 0; i--) {
    const lines = formatTranscriptMessageLines(prior[i]!);
    if (!lines.length) continue;
    const chunk = lines.join("\n");
    if (used + chunk.length + 1 > budget) break;
    blocks.unshift(chunk);
    used += chunk.length + 1;
  }
  if (!blocks.length) return "";
  return [
    "<!-- godmode-recent-transcript -->",
    "Recent turns (for continuity after SDK agent reset; tool calls/results truncated):",
    ...blocks,
    "<!-- /godmode-recent-transcript -->",
  ].join("\n");
}

export function buildPrompt(
  req: AgentRunRequest,
  opts?: { includeTranscript?: boolean }
): string {
  const system = req.messages.find((m) => m.role === "system")?.content?.trim() ?? "";
  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";
  if (!lastUser) throw new Error("User message required");
  const includeTranscript = opts?.includeTranscript !== false;
  const appendix = includeTranscript
    ? buildTranscriptAppendix(req.messages)
    : "";
  const reminders = buildDynamicReminders(req);
  const parts: string[] = [];
  if (system) {
    parts.push(`<!-- godmode-system -->\n${system}\n<!-- /godmode-system -->`);
  }
  if (reminders) parts.push(reminders);
  if (appendix) parts.push(appendix);
  parts.push(lastUser);
  return parts.join("\n\n");
}

/**
 * Turn-local operating reminders (Cursor-like dynamic system notes).
 * Mode / abort / coding-root hints for the live send.
 */
export function buildDynamicReminders(req: AgentRunRequest): string {
  const lines: string[] = [];
  const mode = req.chatMode ?? "agent";
  if (mode === "plan") {
    lines.push(
      "Mode: plan. Prefer investigation and a concrete plan; avoid write/deploy tools unless the user explicitly asks to execute."
    );
  } else if (mode === "ask") {
    lines.push(
      "Mode: ask. Answer from context and read-only tools; do not edit files or run mutating commands."
    );
  } else {
    lines.push("Mode: agent. Investigate then implement with available tools.");
  }
  if (req.abortSignal) {
    lines.push(
      "This run can be aborted by the user; stop cleanly if the abort signal fires."
    );
  }
  const workspace =
    typeof req.agent?.config?.workspace === "string"
      ? req.agent.config.workspace.trim()
      : "";
  if (workspace) {
    lines.push(`Coding workspace: ${workspace}`);
  }
  return [
    "<!-- godmode-reminders -->",
    ...lines,
    "<!-- /godmode-reminders -->",
  ].join("\n");
}

/**
 * Whether to append the GodMode transcript fallback.
 * Skip when the SDK agent was resumed or reused with an unchanged fingerprint
 * (native conversation history). Include after create or structural recreate.
 */
export function shouldIncludeTranscriptAppendix(continued: boolean): boolean {
  return !continued;
}

function systemHash(system: string): string {
  return createHash("sha256").update(system).digest("hex").slice(0, 16);
}

/** Hash optional Cursor model params so param changes recreate the SDK agent. */
export function cursorModelParamsHash(
  params: Record<string, unknown> | null | undefined
): string {
  if (!params || Object.keys(params).length === 0) return "";
  const keys = Object.keys(params).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of keys) normalized[k] = params[k];
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 12);
}

/** SDK `ModelSelection.params` entries from GodMode `modelParams` record. */
export function toSdkModelParams(
  params: Record<string, unknown> | null | undefined
): Array<{ id: string; value: string }> | undefined {
  if (!params) return undefined;
  const out: Array<{ id: string; value: string }> = [];
  for (const id of Object.keys(params).sort()) {
    const raw = params[id];
    if (raw === undefined || raw === null) continue;
    out.push({
      id,
      value: typeof raw === "string" ? raw : JSON.stringify(raw),
    });
  }
  return out.length ? out : undefined;
}

/**
 * Map Intelligence chat mode to SDK AgentModeOption.
 * Ask has no SDK equivalent; keep `"agent"` and rely on GodMode tool filtering.
 */
export function toSdkAgentMode(
  chatMode: IntelligenceChatMode | undefined
): "agent" | "plan" {
  return chatMode === "plan" ? "plan" : "agent";
}

/**
 * Load Cursor project settings (`.cursor/rules`, etc.) when the coding root is
 * a Cursor workspace. Never enables user/team/host Cursor settings.
 */
export function resolveCursorSettingSources(
  cwd: string
): CursorProjectSettingSource[] {
  const cursorDir = join(cwd, ".cursor");
  try {
    if (existsSync(cursorDir) && statSync(cursorDir).isDirectory()) {
      return ["project"];
    }
  } catch {
    return [];
  }
  return [];
}

/** Fingerprint token for settingSources so cache recreates when the gate flips. */
export function cursorSettingSourcesFingerprint(
  sources: readonly string[]
): string {
  return sources.includes("project") ? "project" : "";
}

export function cursorCloudCacheFingerprint(
  modelId: string,
  sysHash: string,
  paramsHash = "",
  settingSourcesKey = "",
  sdkMode: "agent" | "plan" = "agent",
  mcpKey = "",
  sandboxKey = "",
  toolsKey = ""
): string {
  return `${modelId}|${paramsHash}|${sysHash}|${settingSourcesKey}|${sdkMode}|${mcpKey}|${sandboxKey}|${toolsKey}`;
}

/** Stable fingerprint of advertised tool names (invalidates SDK agent cache after install). */
export function cursorToolSchemasFingerprint(
  schemas: Array<{ function: { name: string } }> | undefined
): string {
  if (!schemas?.length) return "";
  return schemas
    .map((s) => s.function.name)
    .filter(Boolean)
    .sort()
    .join(",");
}

/** Whether cursor_cloud should enable SDK sandboxOptions (hub/client Linux when required). */
export function cursorSdkSandboxEnabled(): boolean {
  return config.cursorSdkSandbox === "required";
}

export function cursorSdkSandboxFingerprint(enabled: boolean): string {
  return enabled ? "sdk-sandbox" : "";
}

/** Local Agent.create / resume options derived from coding root (exported for tests). */
export function buildCursorLocalCreateOptions(
  cwd: string,
  opts?: {
    sandboxEnabled?: boolean;
    /**
     * When Bridge hosts MCP, omit project settingSources so ambient
     * `.cursor/mcp.json` does not load under Auto-review.
     */
    suppressProjectSettingSources?: boolean;
  }
): {
  cwd: string;
  sandboxOptions: { enabled: boolean };
  settingSources: CursorProjectSettingSource[];
} {
  const sandboxEnabled = opts?.sandboxEnabled ?? cursorSdkSandboxEnabled();
  return {
    cwd,
    sandboxOptions: { enabled: sandboxEnabled },
    settingSources: opts?.suppressProjectSettingSources
      ? []
      : resolveCursorSettingSources(cwd),
  };
}

export function buildCursorSdkAgentOptions(args: {
  apiKey: string;
  modelId: string;
  modelParams?: Array<{ id: string; value: string }>;
  mode: "agent" | "plan";
  cwd: string;
  agentId?: string;
  mcpServers?: CursorSdkMcpServers;
  sandboxEnabled?: boolean;
  /** Omit project settingSources (Bridge-host MCP path). */
  suppressProjectSettingSources?: boolean;
}): {
  apiKey: string;
  agentId?: string;
  model: { id: string; params?: Array<{ id: string; value: string }> };
  mode: "agent" | "plan";
  local: ReturnType<typeof buildCursorLocalCreateOptions>;
  mcpServers?: CursorSdkMcpServers;
} {
  return {
    apiKey: args.apiKey,
    ...(args.agentId ? { agentId: args.agentId } : {}),
    model: args.modelParams?.length
      ? { id: args.modelId, params: args.modelParams }
      : { id: args.modelId },
    mode: args.mode,
    local: buildCursorLocalCreateOptions(args.cwd, {
      sandboxEnabled: args.sandboxEnabled,
      suppressProjectSettingSources: args.suppressProjectSettingSources,
    }),
    // Allow `{}` so Bridge-host mode can suppress ambient project MCP.
    ...(args.mcpServers !== undefined ? { mcpServers: args.mcpServers } : {}),
  };
}

/**
 * Resolve an SDK agent for a chat key: reuse a fresh in-memory handle, else
 * `Agent.create` with a new Cursor agent id.
 *
 * We deliberately do not cold-`Agent.resume` a stable chat key. Cursor sessions
 * expire independently of the Vault API key; resume/reuse of a dead id shows up
 * as AuthenticationError. Multi-turn continuity within idle TTL uses memory;
 * after rotate we rely on the transcript appendix (`continued: false`).
 */
export async function resolveCursorSdkAgent(args: {
  chatKey: string;
  apiKey: string;
  cwd: string;
  fingerprint: string;
  modelId: string;
  modelParams?: Array<{ id: string; value: string }>;
  mode: "agent" | "plan";
  mcpServers?: CursorSdkMcpServers;
  sandboxEnabled?: boolean;
  suppressProjectSettingSources?: boolean;
  /**
   * Skip in-memory reuse; create a new SDK agent with a new Cursor agent id.
   * Used after a stale AuthenticationError so the same API key gets a fresh session.
   */
  forceFresh?: boolean;
  /** Injectable clock for idle/max-age tests. */
  nowMs?: number;
  /** Injectable for tests. */
  sdk?: {
    resume: (
      agentId: string,
      options: Record<string, unknown>
    ) => Promise<SdkAgent>;
    create: (options: Record<string, unknown>) => Promise<SdkAgent>;
  };
}): Promise<{ agent: SdkAgent; continued: boolean }> {
  const now = args.nowMs ?? Date.now();
  const existing = chatAgents.get(args.chatKey);
  if (existing) {
    const reusable =
      !args.forceFresh &&
      existing.cacheFingerprint === args.fingerprint &&
      !isCursorSdkAgentCacheExpired(existing, now);
    if (reusable) {
      existing.lastUsedAt = now;
      return { agent: existing.agent, continued: true };
    }
    closeCachedAgent(existing);
    chatAgents.delete(args.chatKey);
  }

  const baseOpts = buildCursorSdkAgentOptions({
    apiKey: args.apiKey,
    modelId: args.modelId,
    modelParams: args.modelParams,
    mode: args.mode,
    cwd: args.cwd,
    mcpServers: args.mcpServers,
    sandboxEnabled: args.sandboxEnabled,
    suppressProjectSettingSources: args.suppressProjectSettingSources,
  });

  let sdk = args.sdk;
  if (!sdk) {
    const mod = await import("@cursor/sdk");
    sdk = {
      resume: (id, options) =>
        mod.Agent.resume(id, options as Parameters<typeof mod.Agent.resume>[1]),
      create: (options) =>
        mod.Agent.create(options as Parameters<typeof mod.Agent.create>[0]),
    };
  }

  const agent = await sdk.create({
    ...baseOpts,
    agentId: newCursorSdkAgentId(args.chatKey),
  });
  chatAgents.set(args.chatKey, {
    agent,
    cacheFingerprint: args.fingerprint,
    createdAt: now,
    lastUsedAt: now,
  });
  return { agent, continued: false };
}

/**
 * Strip `undefined` leaves so SDK protobuf `google.protobuf.Value` encoding
 * does not fail with "cannot decode … from JSON undefined".
 */
export function sanitizeSdkJsonValue(
  value: unknown
): import("@cursor/sdk").SDKJsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as import("@cursor/sdk").SDKJsonValue;
}

/** Tools that mutate the live tool catalog mid-chat (#653 / #645). */
export const CATALOG_CHANGING_TOOL_NAMES = new Set([
  "install_plugin",
  "scaffold_plugin",
  "build_plugin",
]);

const CATALOG_REFRESH_CONTINUE_PROMPT =
  "Plugin tools were just installed and are now available in this chat. Continue the user's task using the new tools (prove create + list if that was the goal).";

function buildCustomTools(
  req: AgentRunRequest,
  db: AppDatabase,
  toolCtx: ToolExecContext,
  chatMode?: IntelligenceChatMode,
  onCatalogChanged?: () => void
): Record<string, import("@cursor/sdk").SDKCustomTool> {
  const schemas =
    req.toolSchemas ?? filterSchemas(req.agent.toolAllow, req.agent.id, db, chatMode);
  const tools: Record<string, import("@cursor/sdk").SDKCustomTool> = {};
  for (const schema of schemas) {
    const name = schema.function.name;
    const rawSchema = schema.function.parameters ?? {
      type: "object",
      properties: {},
    };
    const inputSchema = sanitizeSdkJsonValue(rawSchema);
    tools[name] = {
      description: schema.function.description?.trim() || name,
      inputSchema:
        inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)
          ? (inputSchema as Record<string, import("@cursor/sdk").SDKJsonValue>)
          : { type: "object", properties: {} },
      execute: async (args, context) => {
        const toolArgs =
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {};
        const safeArgs = scrubSensitiveToolArgs(toolArgs);
        req.onToolCall?.(name, safeArgs, context.toolCallId);
        const approved = await shouldAutoApproveTool(
          req.agent,
          name,
          req.onConfirmRequired,
          {
            toolCallId: context.toolCallId ?? name,
            name,
            args: safeArgs,
          },
          toolCtx.sessionAutonomy
        );
        if (!approved) {
          const declined = { error: "User declined tool execution" };
          req.onToolResult?.(name, declined, context.toolCallId, true);
          return { content: [{ type: "text", text: JSON.stringify(declined) }], isError: true };
        }
        try {
          const result = await executeTool(name, toolArgs, {
            ...toolCtx,
            confirmationApproved: true,
            activeToolCallId: context.toolCallId,
            abortSignal: req.abortSignal ?? toolCtx.abortSignal,
            onTerminalOutput: req.onTerminalOutput
              ? (chunk) =>
                  req.onTerminalOutput!(context.toolCallId ?? name, {
                    ...chunk,
                    text: budgetAndScrubToolResult(chunk.text, {
                      db: toolCtx.db,
                      agentId: toolCtx.activeAgentId ?? req.agent.id,
                      maxChars: 50_000,
                    }),
                  })
              : toolCtx.onTerminalOutput,
            onTerminalMonitor: req.onTerminalMonitor
              ? (chunk) =>
                  req.onTerminalMonitor!(context.toolCallId ?? name, {
                    ...chunk,
                    text: budgetAndScrubToolResult(chunk.text, {
                      db: toolCtx.db,
                      agentId: toolCtx.activeAgentId ?? req.agent.id,
                      maxChars: 50_000,
                    }),
                  })
              : toolCtx.onTerminalMonitor,
          });
          const scrubbed = budgetAndScrubToolResult(result, {
            db: toolCtx.db,
            agentId: toolCtx.activeAgentId ?? req.agent.id,
            maxChars: 50_000,
          });
          let scrubbedResult: unknown = scrubbed;
          try {
            scrubbedResult = JSON.parse(scrubbed);
          } catch {
            scrubbedResult = scrubbed;
          }
          req.onToolResult?.(name, scrubbedResult, context.toolCallId, false);
          if (CATALOG_CHANGING_TOOL_NAMES.has(name)) {
            onCatalogChanged?.();
            if (req.refreshToolSchemas) {
              const nextSchemas = req.refreshToolSchemas();
              const extras = buildCustomTools(
                { ...req, toolSchemas: nextSchemas },
                db,
                toolCtx,
                chatMode
              );
              for (const [extraName, tool] of Object.entries(extras)) {
                if (!(extraName in tools)) tools[extraName] = tool;
              }
            }
          }
          return scrubbed;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const scrubbedMsg = budgetAndScrubToolResult(message, {
            db: toolCtx.db,
            agentId: toolCtx.activeAgentId ?? req.agent.id,
            maxChars: 50_000,
          });
          const payload = { error: scrubbedMsg };
          req.onToolResult?.(name, payload, context.toolCallId, true);
          return { content: [{ type: "text", text: scrubbedMsg }], isError: true };
        }
      },
    };
  }
  return tools;
}

/**
 * Runs Intelligence on Cursor subscription models via @cursor/sdk.
 * GodMode tools are exposed as SDK customTools (same tool loop, Cursor-hosted models).
 */
export class CursorCloudBackend implements AgentBackend {
  constructor(private db: AppDatabase) {}

  async run(req: AgentRunRequest): Promise<string> {
    const resolvedKey = resolveCursorApiKey(this.db, req.agent.id);
    if (!resolvedKey) {
      throw new Error(
        "Cursor not connected. Add your API key in Vault → Cursor subscription."
      );
    }

    return withSecretValue(resolvedKey, async (apiKey) => {
    const cfg = (req.agent.config ?? {}) as AgentCursorCloudConfig;
    const workspaceCfg = cfg.workspace?.trim() || undefined;
    const cwd = resolveCodingRoot({
      tenantId: req.toolCtx.tenantId,
      root: workspaceCfg,
    });
    const chatKey = `godmode-${req.toolCtx.chatId ?? req.agent.id}`;
    const chatMode = req.chatMode ?? "agent";
    const toolCtx: ToolExecContext = {
      ...req.toolCtx,
      delegationDepth: req.delegationDepth ?? 0,
    };
    let catalogDirty = false;
    let customTools = buildCustomTools(req, this.db, toolCtx, chatMode, () => {
      catalogDirty = true;
    });
    const sys = req.messages.find((m) => m.role === "system")?.content ?? "";
    const modelId = cfg.model?.trim() || "auto";
    const modelParams = toSdkModelParams(
      cfg.modelParams as Record<string, unknown> | undefined
    );
    const paramsHash = cursorModelParamsHash(
      cfg.modelParams as Record<string, unknown> | undefined
    );
    const settingSources = resolveCursorSettingSources(cwd);
    const mcpEnabled = resolveMcpFromWorkspace(cfg, { isSaas: config.isSaas });
    const mcpDisabled = Array.isArray(cfg.mcpDisabledServers)
      ? cfg.mcpDisabledServers.filter((n): n is string => typeof n === "string")
      : undefined;
    const mcpWorkspace = getWorkspaceMcpOverlay(this.db);
    const sdkMode = toSdkAgentMode(chatMode);
    const sandboxEnabled = cursorSdkSandboxEnabled();
    // Sandboxed SaaS: Bridge hosts MCP as customTools (Auto-review safe).
    // Non-sandbox: keep SDK inline mcpServers.
    const bridgeHostsMcp = resolveBridgeMcpHostEnabled({
      backend: "cursor_cloud",
      mcpFromWorkspace: cfg.mcpFromWorkspace,
      isSaas: config.isSaas,
      sdkSandboxEnabled: sandboxEnabled,
    });
    // Bridge host: empty mcpServers + no project settingSources so ambient
    // `.cursor/mcp.json` cannot Auto-review-block. Tools are customTools.
    // GodMode Knowledge/rules sections still cover agent guidance.
    const mcpServers: CursorSdkMcpServers | undefined = bridgeHostsMcp
      ? {}
      : mcpEnabled
        ? loadCursorMcpServersForSdk(cwd, {
            disabled: mcpDisabled,
            workspace: mcpWorkspace,
          })
        : undefined;
    const mcpKey = `${cursorMcpServersFingerprint(
      cwd,
      mcpEnabled,
      mcpDisabled,
      mcpWorkspace
    )}|${bridgeHostsMcp ? "bridge" : "sdk"}`;
    const effectiveSettingSources = bridgeHostsMcp ? [] : settingSources;
    if (sandboxEnabled) {
      ensureTenantCursorSandboxJson(cwd);
    }
    const toolsFingerprint = (tools: typeof customTools) =>
      cursorToolSchemasFingerprint(
        Object.keys(tools).map((name) => ({ function: { name } }))
      );
    let fingerprint = cursorCloudCacheFingerprint(
      modelId,
      systemHash(sys),
      paramsHash,
      cursorSettingSourcesFingerprint(effectiveSettingSources),
      sdkMode,
      mcpKey,
      cursorSdkSandboxFingerprint(sandboxEnabled),
      toolsFingerprint(customTools)
    );

    const runOnce = async (forceFresh: boolean): Promise<string> => {
      const { agent: sdkAgent, continued } = await resolveCursorSdkAgent({
        chatKey,
        apiKey,
        cwd,
        fingerprint,
        modelId,
        modelParams,
        mode: sdkMode,
        mcpServers,
        sandboxEnabled,
        suppressProjectSettingSources: bridgeHostsMcp,
        forceFresh,
      });
      const prompt = buildPrompt(req, {
        includeTranscript: shouldIncludeTranscriptAppendix(continued),
      });
      const modelSelection = modelParams?.length
        ? { id: modelId, params: modelParams }
        : { id: modelId };
      const run = await sdkAgent.send(prompt, {
        model: modelSelection,
        mode: sdkMode,
        ...(mcpServers !== undefined ? { mcpServers } : {}),
        local: { customTools },
      });

      let streamed = "";
      for await (const event of run.stream()) {
        if (req.abortSignal?.aborted) {
          await run.cancel();
          throw new DOMException("Aborted", "AbortError");
        }
        if (event.type === "assistant") {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              streamed += block.text;
              req.onToken?.(block.text);
            }
          }
        } else if (event.type === "thinking" && event.text) {
          req.onReasoning?.(event.text);
        }
      }

      const result = await run.wait();
      if (result.status === "error") {
        const detailParts: string[] = [];
        const runErr = result.error;
        if (runErr?.message?.trim()) detailParts.push(runErr.message.trim());
        if (runErr?.code?.trim()) detailParts.push(`code=${runErr.code.trim()}`);
        if (typeof result.result === "string" && result.result.trim()) {
          detailParts.push(result.result.trim());
        }
        try {
          console.error(
            "[cursor_cloud] agent run error",
            JSON.stringify(result, (_k, v) =>
              typeof v === "string" && v.length > 2000 ? `${v.slice(0, 2000)}…` : v
            )
          );
        } catch {
          console.error("[cursor_cloud] agent run error (unserializable)", result);
        }
        throw new Error(
          detailParts.length
            ? `Cursor agent run failed: ${detailParts.join(" | ")}`
            : "Cursor agent run failed"
        );
      }

      const usageRaw = (result as { usage?: Record<string, number> }).usage;
      if (usageRaw && req.onUsage) {
        req.onUsage({
          prompt_tokens: Number(usageRaw.inputTokens ?? usageRaw.prompt_tokens ?? 0),
          completion_tokens: Number(
            usageRaw.outputTokens ?? usageRaw.completion_tokens ?? 0
          ),
          total_tokens: Number(
            usageRaw.totalTokens ??
              usageRaw.total_tokens ??
              (Number(usageRaw.inputTokens ?? 0) + Number(usageRaw.outputTokens ?? 0))
          ),
        });
      }

      return result.result?.trim() || streamed.trim();
    };

    try {
      let answer = await runOnce(false);
      if (catalogDirty && req.refreshToolSchemas && !req.abortSignal?.aborted) {
        const nextSchemas = req.refreshToolSchemas();
        customTools = buildCustomTools(
          { ...req, toolSchemas: nextSchemas },
          this.db,
          toolCtx,
          chatMode,
          () => {
            catalogDirty = true;
          }
        );
        fingerprint = cursorCloudCacheFingerprint(
          modelId,
          systemHash(sys),
          paramsHash,
          cursorSettingSourcesFingerprint(effectiveSettingSources),
          sdkMode,
          mcpKey,
          cursorSdkSandboxFingerprint(sandboxEnabled),
          toolsFingerprint(customTools)
        );
        evictCursorSdkAgent(chatKey);
        const priorMessages = req.messages;
        req.messages = [
          ...priorMessages,
          { role: "user", content: CATALOG_REFRESH_CONTINUE_PROMPT },
        ];
        try {
          const cont = await runOnce(true);
          if (cont?.trim()) {
            answer = [answer, cont].filter((p) => p?.trim()).join("\n\n");
          }
        } finally {
          req.messages = priorMessages;
        }
      }
      return answer;
    } catch (err) {
      if (req.abortSignal?.aborted || !isCursorSdkAuthStaleError(err)) {
        throw err;
      }
      // Same Vault API key. Cursor SDK often surfaces stale gRPC/session as
      // AuthenticationError; a fresh Agent.create recovers without a new key.
      console.warn(
        "[cursor_cloud] stale auth on SDK agent; clearing handle and retrying once",
        err instanceof Error ? err.message : err
      );
      evictCursorSdkAgent(chatKey);
      try {
        return await runOnce(true);
      } catch (retryErr) {
        if (isCursorSdkAuthStaleError(retryErr)) {
          throw new Error(
            "Cursor session expired for this agent run (your API key is usually still valid). " +
              "Open Platform Vault → Cursor subscription → Refresh session, then retry. " +
              "You do not need a new API key unless Connect itself fails."
          );
        }
        throw retryErr;
      }
    }
    });
  }
}

/** Whether this agent backend requires a running local llama-server. */
export function agentNeedsLocalLlm(backend: string): boolean {
  return backend === "local" || backend === "remote";
}

/** Whether chat can proceed without local llama (cloud / cursor backends). */
export function agentCanRunWithoutLocalLlm(
  backend: string,
  db: AppDatabase,
  agentId?: string | null
): boolean {
  if (backend === "cursor_cloud") return resolveCursorApiKey(db, agentId) != null;
  if (backend === "provider" || backend === "cli" || backend === "acp" || backend === "cursor") {
    return true;
  }
  return false;
}
