import { getToolSchemasForLlm } from "../ai-tools-registry.js";
import { executeTool, type ToolExecContext } from "../ai-tool-executor.js";
import { shouldAutoApproveTool } from "../confirm-policy.js";
import type { AgentMessage } from "../ai-agent.js";
import { budgetToolResult } from "../ai-agent.js";
import { PROVIDER_AGENT_ITERATIONS } from "../agent-loop.js";
import { getSecretValue } from "./agents-db.js";
import { resolveAgentCredential } from "./agent-accounts.js";
import type { AppDatabase } from "../../db.js";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AgentProviderConfig } from "./types.js";
import type { IntelligenceChatMode } from "../chat-mode.js";

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
  return all.filter((t) => set.has(t.function.name));
}

async function openAiCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  body: Record<string, unknown>
): Promise<{ content: string; toolCalls: AgentMessage["tool_calls"] }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: AgentMessage["tool_calls"];
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  return { content: msg?.content ?? "", toolCalls: msg?.tool_calls ?? [] };
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
  req.onToolCall?.(fnName, args, tc.id);

  const approved = await shouldAutoApproveTool(
    req.agent,
    fnName,
    req.onConfirmRequired,
    { toolCallId: tc.id, name: fnName, args },
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
        onTerminalOutput: req.onTerminalOutput
          ? (chunk) => req.onTerminalOutput!(tc.id, chunk)
          : toolCtx.onTerminalOutput,
      });
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const isError =
    !!result && typeof result === "object" && "error" in (result as object);
  req.onToolResult?.(fnName, result, tc.id, isError);
  return {
    role: "tool",
    tool_call_id: tc.id,
    name: fnName,
    content: budgetToolResult(result),
  };
}

export class ProviderBackend implements AgentBackend {
  constructor(private db: AppDatabase) {}

  async run(req: AgentRunRequest): Promise<string> {
    const cfg = req.agent.config as AgentProviderConfig;
    const keyRef = cfg.apiKeyRef;
    const provider = cfg.provider ?? "openai";
    let apiKey =
      resolveAgentCredential(this.db, req.agent.id, { provider, secretId: keyRef ?? undefined }) ??
      (keyRef ? getSecretValue(this.db, keyRef) : null);
    if (!apiKey) throw new Error("API key not found for provider agent");
    const model = cfg.model ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");
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
    const tools =
      req.toolSchemas ??
      filterSchemas(req.agent.toolAllow, req.agent.id, this.db, chatMode);
    const toolCtx: ToolExecContext = {
      ...req.toolCtx,
      delegationDepth: req.delegationDepth ?? 0,
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
        const body: Record<string, unknown> = {
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id, name: m.name } : {}),
          })),
          temperature: req.agent.sampling.temperature,
          max_tokens: req.agent.sampling.maxTokens > 0 ? req.agent.sampling.maxTokens : undefined,
        };
        if (
          !isLast &&
          req.agent.thinking.nativeTools &&
          tools.length &&
          chatMode !== "ask"
        ) {
          body.tools = tools;
          body.tool_choice = "auto";
        }
        const out = await openAiCompletion(baseUrl, apiKey, model, body);
        content = out.content;
        toolCalls = out.toolCalls;
      }

      if (content && req.onToken) req.onToken(content);

      if (!toolCalls?.length) {
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
    }

    return messages.filter((m) => m.role === "assistant").pop()?.content ?? "";
  }
}
