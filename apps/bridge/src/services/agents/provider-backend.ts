import { getToolSchemasForLlm } from "../ai-tools-registry.js";
import { executeTool, type ToolExecContext } from "../ai-tool-executor.js";
import { shouldAutoApproveTool } from "../confirm-policy.js";
import type { AgentMessage } from "../ai-agent.js";
import { budgetToolResult, TOOL_OUTPUT_MAX_CHARS } from "../ai-agent.js";
import { PROVIDER_AGENT_ITERATIONS } from "../agent-loop.js";
import { resolveSecretRefForAgent, withSecretValue } from "./agents-db.js";
import { resolveAgentCredential } from "./agent-accounts.js";
import {
  isGodModeInferenceSupplySecretId,
} from "../godmode-inference-supply.js";
import {
  resolveGodModeInferenceSupplyForManagedChat,
} from "../godmode-inference-grants.js";
import type { AppDatabase } from "../../db.js";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AgentProviderConfig } from "./types.js";
import type { IntelligenceChatMode } from "../chat-mode.js";
import {
  budgetAndScrubToolResult,
  scrubSensitiveToolArgs,
} from "../secret-scrub.js";
import { isBridgeMcpToolName } from "../coding/mcp-host.js";
import { buildProviderChatBody } from "./provider-chat-body.js";
import { parseGodModeInferenceUsage } from "../godmode-inference-grants.js";

export type ProviderUsageTotals = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
};

export function emptyProviderUsage(): ProviderUsageTotals {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cached_tokens: 0,
    reasoning_tokens: 0,
  };
}

export function addProviderUsage(
  into: ProviderUsageTotals,
  raw: unknown
): void {
  const parsed = parseGodModeInferenceUsage(raw);
  if (!parsed) return;
  into.prompt_tokens += parsed.promptTokens;
  into.completion_tokens += parsed.completionTokens ?? 0;
  into.cached_tokens += parsed.cachedTokens ?? 0;
  into.reasoning_tokens += parsed.reasoningTokens ?? 0;
  into.total_tokens =
    into.prompt_tokens + into.completion_tokens + into.reasoning_tokens;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeToolCall(tc: NonNullable<AgentMessage["tool_calls"]>[number]) {
  return {
    ...tc,
    function: {
      ...tc.function,
      arguments: JSON.stringify(parseToolArgs(tc.function.arguments)),
    },
  };
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
  return all.filter(
    (t) => set.has(t.function.name) || isBridgeMcpToolName(t.function.name)
  );
}

function providerChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  // Bases that already end in /v1 or /v4 (Z.AI, DashScope-style) take
  // /chat/completions. Bare hosts get /v1/chat/completions.
  return /\/v\d+$/i.test(trimmed)
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}

async function readSseData(
  res: Response,
  onPayload: (payload: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        onPayload(payload);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function openAiCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  callbacks?: {
    signal?: AbortSignal;
    onToken?: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onToolCallDelta?: AgentRunRequest["onToolCallDelta"];
  }
): Promise<{
  content: string;
  reasoning: string;
  toolCalls: AgentMessage["tool_calls"];
  usage: unknown;
}> {
  const res = await fetch(providerChatUrl(baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, ...body }),
    signal: callbacks?.signal,
  });
  if (!res.ok) throw new Error(await res.text());
  if (body.stream === true) {
    return readStreamedCompletion(res, callbacks);
  }
  const json = (await res.json()) as {
    usage?: unknown;
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: AgentMessage["tool_calls"];
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  const reasoning = msg?.reasoning_content ?? "";
  if (reasoning) callbacks?.onReasoning?.(reasoning);
  return {
    content: msg?.content ?? "",
    reasoning,
    toolCalls: msg?.tool_calls ?? [],
    usage: json.usage ?? null,
  };
}

async function readStreamedCompletion(
  res: Response,
  callbacks?: {
    signal?: AbortSignal;
    onToken?: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onToolCallDelta?: AgentRunRequest["onToolCallDelta"];
  }
): Promise<{
  content: string;
  reasoning: string;
  toolCalls: AgentMessage["tool_calls"];
  usage: unknown;
}> {
  let content = "";
  let reasoning = "";
  let usage: unknown = null;
  const accum = new Map<number, { id: string; name: string; arguments: string }>();
  await readSseData(
    res,
    (payload) => {
      let parsed: {
        usage?: unknown;
        choices?: Array<{
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.usage) usage = parsed.usage;
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        content += delta.content;
        callbacks?.onToken?.(delta.content);
      }
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        callbacks?.onReasoning?.(delta.reasoning_content);
      }
      for (const call of delta.tool_calls ?? []) {
        const idx = call.index ?? 0;
        const cur = accum.get(idx) ?? { id: "", name: "", arguments: "" };
        if (call.id) cur.id = call.id;
        if (call.function?.name) cur.name = call.function.name;
        if (call.function?.arguments) cur.arguments += call.function.arguments;
        accum.set(idx, cur);
        if (cur.id && cur.name) {
          callbacks?.onToolCallDelta?.(cur.id, cur.name, parseToolArgs(cur.arguments));
        }
      }
    },
    callbacks?.signal
  );
  const toolCalls: AgentMessage["tool_calls"] = [...accum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id || `call_${call.name}`,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments || "{}" },
    }))
    .filter((call) => call.function.name);
  return { content, reasoning, toolCalls, usage };
}

async function anthropicCompletion(
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  tools: ReturnType<typeof getToolSchemasForLlm>,
  maxTokens: number
): Promise<{ content: string; toolCalls: AgentMessage["tool_calls"] }> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const turns = messages.filter((m) => m.role !== "system" && m.role !== "tool");
  const anthropicTools = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens > 0 ? maxTokens : 4096,
      system,
      messages: turns.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      tools: anthropicTools.length ? anthropicTools : undefined,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  };
  let text = "";
  const toolCalls: NonNullable<AgentMessage["tool_calls"]> = [];
  for (const block of json.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    if (block.type === "tool_use" && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }
  return { content: text, toolCalls };
}

async function executeOneTool(
  tc: NonNullable<AgentMessage["tool_calls"]>[number],
  req: AgentRunRequest,
  toolCtx: ToolExecContext
): Promise<AgentMessage> {
  const fnName = tc.function.name;
  const args = parseToolArgs(tc.function.arguments);
  const safeArgs = scrubSensitiveToolArgs(args);
  req.onToolCall?.(fnName, safeArgs, tc.id);

  const approved = await shouldAutoApproveTool(
    req.agent,
    fnName,
    req.onConfirmRequired,
    { toolCallId: tc.id, name: fnName, args: safeArgs },
    toolCtx.sessionAutonomy
  );

  let result: unknown;
  if (!approved) {
    result = { error: "User declined tool execution" };
  } else {
    try {
      result = await executeTool(fnName, args, {
        ...toolCtx,
        confirmationApproved: true,
        activeToolCallId: tc.id,
        abortSignal: req.abortSignal ?? toolCtx.abortSignal,
        onTerminalOutput: req.onTerminalOutput
          ? (chunk) =>
              req.onTerminalOutput!(tc.id, {
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
              req.onTerminalMonitor!(tc.id, {
                ...chunk,
                text: budgetAndScrubToolResult(chunk.text, {
                  db: toolCtx.db,
                  agentId: toolCtx.activeAgentId ?? req.agent.id,
                  maxChars: 50_000,
                }),
              })
          : toolCtx.onTerminalMonitor,
      });
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const isError =
    !!result && typeof result === "object" && "error" in (result as object);
  const scrubbedContent = budgetToolResult(result, TOOL_OUTPUT_MAX_CHARS, {
    db: toolCtx.db,
    agentId: toolCtx.activeAgentId ?? req.agent.id,
  });
  let scrubbedResult: unknown = result;
  try {
    scrubbedResult = JSON.parse(scrubbedContent);
  } catch {
    scrubbedResult = scrubbedContent;
  }
  req.onToolResult?.(fnName, scrubbedResult, tc.id, isError);
  return {
    role: "tool",
    tool_call_id: tc.id,
    name: fnName,
    content: scrubbedContent,
  };
}

export class ProviderBackend implements AgentBackend {
  constructor(private db: AppDatabase) {}

  async run(req: AgentRunRequest): Promise<string> {
    const cfg = req.agent.config as AgentProviderConfig;
    const keyRef = cfg.apiKeyRef;
    const provider = cfg.provider ?? "openai";
    const resolvedKey =
      resolveAgentCredential(this.db, req.agent.id, {
        provider,
        secretId: keyRef ?? undefined,
      }) ??
      (keyRef ? resolveSecretRefForAgent(this.db, keyRef, req.agent.id) : null) ??
      (keyRef && isGodModeInferenceSupplySecretId(keyRef)
        ? resolveGodModeInferenceSupplyForManagedChat(keyRef, {
            agentId: req.agent.id,
            userId: req.toolCtx.userId ?? null,
          })
        : null);
    if (!resolvedKey) {
      if (keyRef && isGodModeInferenceSupplySecretId(keyRef)) {
        throw new Error(
          "GodMode Inference allowance exhausted or unavailable. Buy more GodMode Inference or connect a supported key in Vault."
        );
      }
      throw new Error("API key not found for provider agent");
    }

    return withSecretValue(resolvedKey, async (apiKey) => {
      const model =
        cfg.model ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");
      const baseUrl =
        cfg.baseUrl ??
        (provider === "anthropic"
          ? "https://api.anthropic.com"
          : provider === "openai_compatible"
            ? "http://127.0.0.1:11434"
            : "https://api.openai.com");

      let messages = [...req.messages];
      const chatMode = req.chatMode ?? "agent";
      const maxIter = req.maxIterations ?? PROVIDER_AGENT_ITERATIONS;
      let tools =
        req.toolSchemas ??
        filterSchemas(req.agent.toolAllow, req.agent.id, this.db, chatMode);
      const toolCtx: ToolExecContext = {
        ...req.toolCtx,
        delegationDepth: req.delegationDepth ?? 0,
      };
      const catalogChangingTools = new Set([
        "install_plugin",
        "scaffold_plugin",
        "build_plugin",
      ]);

      const usageTotals = emptyProviderUsage();
      const emitUsage = () => {
        if (
          usageTotals.prompt_tokens +
            usageTotals.completion_tokens +
            usageTotals.reasoning_tokens <=
          0
        ) {
          return;
        }
        req.onUsage?.(usageTotals);
      };

      for (let i = 0; i < maxIter; i++) {
        if (req.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
        const isLast = i === maxIter - 1;
        let content: string;
        let toolCalls: AgentMessage["tool_calls"] = [];

        if (provider === "anthropic") {
          const out = await anthropicCompletion(
            apiKey,
            model,
            messages,
            isLast || chatMode === "ask" ? [] : tools,
            req.agent.sampling.maxTokens
          );
          content = out.content;
          toolCalls = out.toolCalls;
        } else {
          const overlay = req.samplingOverlay;
          const temperature =
            overlay?.temperature ?? req.agent.sampling.temperature;
          const topP = overlay?.topP ?? req.agent.sampling.topP;
          const extras = req.providerExtras;
          const includeTools =
            !isLast &&
            req.agent.thinking.nativeTools &&
            tools.length > 0 &&
            chatMode !== "ask";
          const body = buildProviderChatBody({
            messages,
            temperature,
            topP,
            maxTokens: req.agent.sampling.maxTokens,
            extras,
            tools,
            includeTools,
          });
          const streamed = body.stream === true;
          const out = await openAiCompletion(baseUrl, apiKey, model, body, {
            signal: req.abortSignal,
            onToken: streamed ? req.onToken : undefined,
            onReasoning: req.onReasoning,
            onToolCallDelta: req.onToolCallDelta,
          });
          content = out.content;
          toolCalls = out.toolCalls;
          addProviderUsage(usageTotals, out.usage);
          if (!streamed && content && req.onToken) req.onToken(content);
          if (!toolCalls?.length) {
            emitUsage();
            return content;
          }
          const sanitizedToolCalls = toolCalls.map(sanitizeToolCall);
          const preserveReasoning = extras?.clearThinking === false && out.reasoning;
          messages.push({
            role: "assistant",
            content: content || "",
            ...(preserveReasoning ? { reasoning_content: out.reasoning } : {}),
            tool_calls: sanitizedToolCalls,
          });
          const toolMessages = await Promise.all(
            sanitizedToolCalls.map((tc) => executeOneTool(tc, req, toolCtx))
          );
          messages.push(...toolMessages);
          if (
            sanitizedToolCalls.some((tc) =>
              catalogChangingTools.has(tc.function?.name ?? "")
            )
          ) {
            if (req.refreshToolSchemas) {
              tools = req.refreshToolSchemas();
            } else if (!req.toolSchemas) {
              tools = filterSchemas(
                req.agent.toolAllow,
                req.agent.id,
                this.db,
                chatMode
              );
            }
          }
          continue;
        }

        if (content && req.onToken) req.onToken(content);

        if (!toolCalls?.length) {
          emitUsage();
          return content;
        }

        const sanitizedToolCalls = toolCalls.map(sanitizeToolCall);
        messages.push({
          role: "assistant",
          content: content || "",
          tool_calls: sanitizedToolCalls,
        });

        const toolMessages = await Promise.all(
          sanitizedToolCalls.map((tc) => executeOneTool(tc, req, toolCtx))
        );
        messages.push(...toolMessages);

        if (
          sanitizedToolCalls.some((tc) =>
            catalogChangingTools.has(tc.function?.name ?? "")
          )
        ) {
          if (req.refreshToolSchemas) {
            tools = req.refreshToolSchemas();
          } else if (!req.toolSchemas) {
            tools = filterSchemas(
              req.agent.toolAllow,
              req.agent.id,
              this.db,
              chatMode
            );
          }
        }
      }

      emitUsage();
      return messages.filter((m) => m.role === "assistant").pop()?.content ?? "";
    });
  }
}
