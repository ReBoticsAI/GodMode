import { createHash } from "node:crypto";
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

/** Only project rules; never user/team/mdm/all (Bridge/SaaS isolation). */
export type CursorProjectSettingSource = "project";

type SdkAgent = Awaited<
  ReturnType<(typeof import("@cursor/sdk"))["Agent"]["create"]>
>;

interface ChatAgentEntry {
  agent: SdkAgent;
  /** Last structural fingerprint observed for this in-memory handle. */
  cacheFingerprint: string;
}

/** Soft cap for prior-turn transcript appendix (chars). */
export const TRANSCRIPT_CHAR_BUDGET = 10_000;
const TRANSCRIPT_MAX_TURNS = 12;
const TRANSCRIPT_PER_MESSAGE_CAP = 1_200;
const TRANSCRIPT_TOOL_ARGS_CAP = 400;
/** Align with chat-history `compactAgentMessages` tool-result truncation. */
const TRANSCRIPT_TOOL_RESULT_CAP = 1_500;

const chatAgents = new Map<string, ChatAgentEntry>();

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
  return all.filter((t) => set.has(t.function.name));
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
  const parts: string[] = [];
  if (system) {
    parts.push(`<!-- godmode-system -->\n${system}\n<!-- /godmode-system -->`);
  }
  if (appendix) parts.push(appendix);
  parts.push(lastUser);
  return parts.join("\n\n");
}

/**
 * Whether to append the GodMode transcript fallback.
 * Skip when the SDK agent was resumed or reused (native conversation history).
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
  sdkMode: "agent" | "plan" = "agent"
): string {
  return `${modelId}|${paramsHash}|${sysHash}|${settingSourcesKey}|${sdkMode}`;
}

/** Local Agent.create / resume options derived from coding root (exported for tests). */
export function buildCursorLocalCreateOptions(cwd: string): {
  cwd: string;
  sandboxOptions: { enabled: false };
  settingSources: CursorProjectSettingSource[];
} {
  return {
    cwd,
    sandboxOptions: { enabled: false },
    settingSources: resolveCursorSettingSources(cwd),
  };
}

export function buildCursorSdkAgentOptions(args: {
  apiKey: string;
  modelId: string;
  modelParams?: Array<{ id: string; value: string }>;
  mode: "agent" | "plan";
  cwd: string;
  agentId?: string;
}): {
  apiKey: string;
  agentId?: string;
  model: { id: string; params?: Array<{ id: string; value: string }> };
  mode: "agent" | "plan";
  local: ReturnType<typeof buildCursorLocalCreateOptions>;
} {
  return {
    apiKey: args.apiKey,
    ...(args.agentId ? { agentId: args.agentId } : {}),
    model: args.modelParams?.length
      ? { id: args.modelId, params: args.modelParams }
      : { id: args.modelId },
    mode: args.mode,
    local: buildCursorLocalCreateOptions(args.cwd),
  };
}

/**
 * Resolve an SDK agent for a chat key: reuse in-memory handle, else
 * `Agent.resume`, else `Agent.create`. `continued` is true when native SDK
 * history should be trusted (skip transcript appendix).
 */
export async function resolveCursorSdkAgent(args: {
  chatKey: string;
  apiKey: string;
  cwd: string;
  fingerprint: string;
  modelId: string;
  modelParams?: Array<{ id: string; value: string }>;
  mode: "agent" | "plan";
  /** Injectable for tests. */
  sdk?: {
    resume: (
      agentId: string,
      options: Record<string, unknown>
    ) => Promise<SdkAgent>;
    create: (options: Record<string, unknown>) => Promise<SdkAgent>;
  };
}): Promise<{ agent: SdkAgent; continued: boolean }> {
  const existing = chatAgents.get(args.chatKey);
  if (existing) {
    existing.cacheFingerprint = args.fingerprint;
    return { agent: existing.agent, continued: true };
  }

  const baseOpts = buildCursorSdkAgentOptions({
    apiKey: args.apiKey,
    modelId: args.modelId,
    modelParams: args.modelParams,
    mode: args.mode,
    cwd: args.cwd,
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

  try {
    const agent = await sdk.resume(args.chatKey, baseOpts);
    chatAgents.set(args.chatKey, {
      agent,
      cacheFingerprint: args.fingerprint,
    });
    return { agent, continued: true };
  } catch {
    const agent = await sdk.create({
      ...baseOpts,
      agentId: args.chatKey,
    });
    chatAgents.set(args.chatKey, {
      agent,
      cacheFingerprint: args.fingerprint,
    });
    return { agent, continued: false };
  }
}

/** @internal test helper: clears in-memory SDK agent cache. */
export function clearCursorCloudAgentCacheForTests(): void {
  chatAgents.clear();
}

function buildCustomTools(
  req: AgentRunRequest,
  db: AppDatabase,
  toolCtx: ToolExecContext,
  chatMode?: IntelligenceChatMode
): Record<string, import("@cursor/sdk").SDKCustomTool> {
  const schemas =
    req.toolSchemas ?? filterSchemas(req.agent.toolAllow, req.agent.id, db, chatMode);
  const tools: Record<string, import("@cursor/sdk").SDKCustomTool> = {};
  for (const schema of schemas) {
    const name = schema.function.name;
    tools[name] = {
      description: schema.function.description,
      inputSchema: (schema.function.parameters ?? {
        type: "object",
        properties: {},
      }) as Record<string, import("@cursor/sdk").SDKJsonValue>,
      execute: async (args, context) => {
        req.onToolCall?.(name, args as Record<string, unknown>, context.toolCallId);
        const approved = await shouldAutoApproveTool(
          req.agent,
          name,
          req.onConfirmRequired,
          {
            toolCallId: context.toolCallId ?? name,
            name,
            args: args as Record<string, unknown>,
          },
          toolCtx.sessionAutonomy
        );
        if (!approved) {
          const declined = { error: "User declined tool execution" };
          req.onToolResult?.(name, declined, context.toolCallId, true);
          return { content: [{ type: "text", text: JSON.stringify(declined) }], isError: true };
        }
        try {
          const result = await executeTool(name, args as Record<string, unknown>, {
            ...toolCtx,
            confirmationApproved: true,
            activeToolCallId: context.toolCallId,
            onTerminalOutput: req.onTerminalOutput
              ? (chunk) =>
                  req.onTerminalOutput!(context.toolCallId ?? name, chunk)
              : toolCtx.onTerminalOutput,
          });
          req.onToolResult?.(name, result, context.toolCallId, false);
          if (typeof result === "string") return result;
          return JSON.stringify(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const payload = { error: message };
          req.onToolResult?.(name, payload, context.toolCallId, true);
          return { content: [{ type: "text", text: message }], isError: true };
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
    const apiKey = resolveCursorApiKey(this.db);
    if (!apiKey) {
      throw new Error(
        "Cursor not connected. Add your API key in Vault → Cursor subscription."
      );
    }

    const cfg = (req.agent.config ?? {}) as AgentCursorCloudConfig;
    const cwd = cfg.workspace?.trim() || config.repoRoot;
    const chatKey = `godmode-${req.toolCtx.chatId ?? req.agent.id}`;
    const chatMode = req.chatMode ?? "agent";
    const toolCtx: ToolExecContext = {
      ...req.toolCtx,
      delegationDepth: req.delegationDepth ?? 0,
    };
    const customTools = buildCustomTools(req, this.db, toolCtx, chatMode);
    const sys = req.messages.find((m) => m.role === "system")?.content ?? "";
    const modelId = cfg.model?.trim() || "auto";
    const modelParams = toSdkModelParams(
      cfg.modelParams as Record<string, unknown> | undefined
    );
    const paramsHash = cursorModelParamsHash(
      cfg.modelParams as Record<string, unknown> | undefined
    );
    const settingSources = resolveCursorSettingSources(cwd);
    const sdkMode = toSdkAgentMode(chatMode);
    const fingerprint = cursorCloudCacheFingerprint(
      modelId,
      systemHash(sys),
      paramsHash,
      cursorSettingSourcesFingerprint(settingSources),
      sdkMode
    );

    const { agent: sdkAgent, continued } = await resolveCursorSdkAgent({
      chatKey,
      apiKey,
      cwd,
      fingerprint,
      modelId,
      modelParams,
      mode: sdkMode,
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
      throw new Error(result.result || "Cursor agent run failed");
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
  }
}

/** Whether this agent backend requires a running local llama-server. */
export function agentNeedsLocalLlm(backend: string): boolean {
  return backend === "local" || backend === "remote";
}

/** Whether chat can proceed without local llama (cloud / cursor backends). */
export function agentCanRunWithoutLocalLlm(
  backend: string,
  db: AppDatabase
): boolean {
  if (backend === "cursor_cloud") return resolveCursorApiKey(db) != null;
  if (backend === "provider" || backend === "cli" || backend === "acp" || backend === "cursor") {
    return true;
  }
  return false;
}
