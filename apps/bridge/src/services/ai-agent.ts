import { config } from "../config.js";
import { getToolSchemasForLlm } from "./ai-tools-registry.js";
import {
  executeTool,
  requiresConfirmation,
  type ToolExecContext,
} from "./ai-tool-executor.js";
import {
  buildGrammarResponseSchema,
  parseGrammarResponse,
  type ToolMode,
} from "./tool-grammar.js";

export const DEFAULT_MAX_ITERATIONS = 32;
export const TOOL_OUTPUT_MAX_CHARS = 7000;

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface AgentSampling {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
  maxTokens: number;
  seed: number;
}

export interface RunAgentOptions {
  baseUrl: string;
  messages: AgentMessage[];
  sampling: AgentSampling;
  nativeTools: boolean;
  toolMode?: ToolMode;
  lora?: Array<{ id: number; scale: number }>;
  maxIterations?: number;
  toolCtx: ToolExecContext;
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  toolExecutor?: (
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecContext
  ) => Promise<unknown>;
  requiresConfirmation?: (name: string) => boolean;
  abortSignal?: AbortSignal;
  onToken?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
    toolCallId?: string
  ) => void;
  onToolCallDelta?: (
    toolCallId: string,
    name: string,
    argsPartial: Record<string, unknown>
  ) => void;
  onToolResult?: (
    name: string,
    result: unknown,
    toolCallId?: string,
    isError?: boolean
  ) => void;
  onConfirmRequired?: (payload: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
  }) => Promise<boolean>;
  onTerminalOutput?: (
    toolCallId: string,
    chunk: { stream: "stdout" | "stderr"; text: string }
  ) => void;
}

interface CompletionChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: AgentMessage["tool_calls"];
  };
  delta?: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface StreamStepResult {
  content: string;
  reasoning: string;
  toolCalls: NonNullable<AgentMessage["tool_calls"]>;
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

/**
 * Collapse duplicate tool calls within a single assistant turn. Models (and
 * streamed delta accumulation) sometimes emit the exact same call twice in one
 * message; running both via Promise.all double-executes side effects (e.g. two
 * create_project_card inserts). Keyed on name + canonical arguments (sanitize
 * already normalizes the JSON), so legitimately different calls are preserved.
 */
function dedupeToolCalls(
  toolCalls: NonNullable<AgentMessage["tool_calls"]>
): NonNullable<AgentMessage["tool_calls"]> {
  const seen = new Set<string>();
  const out: NonNullable<AgentMessage["tool_calls"]> = [];
  for (const tc of toolCalls) {
    const key = `${tc.function.name}:${tc.function.arguments}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tc);
  }
  return out;
}

export function budgetToolResult(
  result: unknown,
  maxChars = TOOL_OUTPUT_MAX_CHARS
): string {
  const content = typeof result === "string" ? result : JSON.stringify(result);
  if (content.length <= maxChars) return content;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.floor(maxChars * 0.3);
  const omitted = content.length - head - tail;
  return (
    content.slice(0, head) +
    `\n\n[... ${omitted} chars omitted ...]\n\n` +
    content.slice(-tail)
  );
}

function newToolCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function mergeToolCallDeltas(
  accum: Map<number, { id: string; name: string; arguments: string }>,
  deltas: NonNullable<CompletionChoice["delta"]>["tool_calls"],
  onToolCallDelta?: RunAgentOptions["onToolCallDelta"]
): void {
  if (!deltas?.length) return;
  for (const delta of deltas) {
    const idx = delta.index ?? 0;
    const cur = accum.get(idx) ?? { id: "", name: "", arguments: "" };
    if (delta.id) cur.id = delta.id;
    if (delta.function?.name) cur.name = delta.function.name;
    if (delta.function?.arguments) cur.arguments += delta.function.arguments;
    accum.set(idx, cur);
    if (cur.id && cur.name && onToolCallDelta) {
      onToolCallDelta(cur.id, cur.name, parseToolArgs(cur.arguments));
    }
  }
}

function accumToToolCalls(
  accum: Map<number, { id: string; name: string; arguments: string }>
): NonNullable<AgentMessage["tool_calls"]> {
  return [...accum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id || newToolCallId(),
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments || "{}" },
    }))
    .filter((tc) => tc.function.name);
}

async function readSseStream(
  res: Response,
  onLine: (payload: string) => void,
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
        onLine(payload);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function completionStreamStep(
  baseUrl: string,
  body: Record<string, unknown>,
  callbacks: {
    onToken?: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onToolCallDelta?: RunAgentOptions["onToolCallDelta"];
    parseInlineToolCalls?: boolean;
  },
  signal?: AbortSignal
): Promise<StreamStepResult> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      stream: true,
      cache_prompt: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("Failed to parse input") || text.includes("<|tool_call")) {
      const fallbackBody = { ...body };
      delete fallbackBody.response_format;
      return completionStreamStep(
        baseUrl,
        fallbackBody,
        { ...callbacks, parseInlineToolCalls: true },
        signal
      );
    }
    throw new Error(text);
  }

  let content = "";
  let reasoning = "";
  const tcAccum = new Map<number, { id: string; name: string; arguments: string }>();

  await readSseStream(
    res,
    (payload) => {
      try {
        const parsed = JSON.parse(payload) as { choices?: CompletionChoice[] };
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) return;
        if (delta.content) {
          content += delta.content;
          if (!callbacks.parseInlineToolCalls) {
            callbacks.onToken?.(delta.content);
          }
        }
        const rc = delta.reasoning_content;
        if (rc) {
          reasoning += rc;
          callbacks.onReasoning?.(rc);
        }
        mergeToolCallDeltas(tcAccum, delta.tool_calls, callbacks.onToolCallDelta);
      } catch {
        /* skip malformed */
      }
    },
    signal
  );

  const inline = callbacks.parseInlineToolCalls ? parseGrammarResponse(content) : null;
  return {
    content: inline ? inline.content : content,
    reasoning,
    toolCalls: [
      ...accumToToolCalls(tcAccum),
      ...(inline
        ? inline.toolCalls.map((tc, i) => ({
            id: newToolCallId() + `_inline_${i}`,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }))
        : []),
    ],
  };
}

async function completionGrammarStep(
  baseUrl: string,
  body: Record<string, unknown>,
  callbacks: {
    onToken?: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
  },
  signal?: AbortSignal
): Promise<StreamStepResult> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      stream: true,
      cache_prompt: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    // llama-server sometimes rejects the constrained grammar request itself
    // ("Failed to parse input at pos 0: <|tool_call>"). Degrade gracefully:
    // retry UNCONSTRAINED and parse any inline tool-call syntax from the raw
    // content so the multi-step turn continues instead of erroring out.
    if (text.includes("Failed to parse input") || text.includes("<|tool_call")) {
      const fallbackBody = { ...body };
      delete fallbackBody.response_format;
      const fallback = await completionStreamStep(
        baseUrl,
        fallbackBody,
        { ...callbacks, parseInlineToolCalls: true },
        signal
      );
      // completionStreamStep buffers (does not emit) when parsing inline calls;
      // surface the cleaned visible content like the normal grammar path does.
      if (fallback.content) callbacks.onToken?.(fallback.content);
      return fallback;
    }
    throw new Error(text);
  }

  let raw = "";
  await readSseStream(
    res,
    (payload) => {
      try {
        const parsed = JSON.parse(payload) as { choices?: CompletionChoice[] };
        const delta = parsed.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          raw += delta;
        }
      } catch {
        /* skip */
      }
    },
    signal
  );

  const parsed = parseGrammarResponse(raw);
  if (parsed.content) callbacks.onToken?.(parsed.content);
  const toolCalls: NonNullable<AgentMessage["tool_calls"]> = parsed.toolCalls.map(
    (tc, i) => ({
      id: newToolCallId() + `_${i}`,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    })
  );
  return { content: parsed.content, reasoning: "", toolCalls };
}

function emitFallbackText(onToken: RunAgentOptions["onToken"], text: string): string {
  onToken?.(text);
  return text;
}

async function executeToolCalls(
  sanitizedToolCalls: NonNullable<AgentMessage["tool_calls"]>,
  opts: Pick<
    RunAgentOptions,
    | "toolCtx"
    | "toolExecutor"
    | "requiresConfirmation"
    | "onToolCall"
    | "onToolResult"
    | "onConfirmRequired"
    | "onTerminalOutput"
  >
): Promise<AgentMessage[]> {
  const confirmFn = opts.requiresConfirmation ?? requiresConfirmation;
  const exec = opts.toolExecutor ?? executeTool;

  const results = await Promise.all(
    sanitizedToolCalls.map(async (tc) => {
      const fnName = tc.function.name;
      const args = parseToolArgs(tc.function.arguments);
      opts.onToolCall?.(fnName, args, tc.id);

      if (confirmFn(fnName)) {
        const approved =
          (await opts.onConfirmRequired?.({
            toolCallId: tc.id,
            name: fnName,
            args,
          })) ?? false;
        if (!approved) {
          const content = JSON.stringify({ error: "User declined tool execution" });
          opts.onToolResult?.(fnName, { error: "User declined tool execution" }, tc.id, true);
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            name: fnName,
            content,
          };
        }
      }

      let result: unknown;
      try {
        result = await exec(fnName, args, {
          ...opts.toolCtx,
          activeToolCallId: tc.id,
          onTerminalOutput: opts.onTerminalOutput
            ? (chunk) => opts.onTerminalOutput!(tc.id, chunk)
            : opts.toolCtx.onTerminalOutput,
        });
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      const isError =
        !!result && typeof result === "object" && "error" in (result as object);
      opts.onToolResult?.(fnName, result, tc.id, isError);
      return {
        role: "tool" as const,
        tool_call_id: tc.id,
        name: fnName,
        content: budgetToolResult(result),
      };
    })
  );

  return results;
}

export async function runAgentChat(opts: RunAgentOptions): Promise<string> {
  const {
    baseUrl,
    sampling,
    nativeTools,
    toolMode = config.ai.defaultToolMode,
    lora,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    toolCtx,
    tools: toolsOverride,
    toolExecutor,
    requiresConfirmation: requiresConfirmationFn,
    abortSignal,
    onToken,
    onReasoning,
    onToolCall,
    onToolCallDelta,
    onToolResult,
    onConfirmRequired,
    onTerminalOutput,
  } = opts;
  let messages = [...opts.messages];
  const iterationLimit = Math.max(1, maxIterations);
  const useGrammar = toolMode === "grammar" && nativeTools;

  const samplingBody = {
    temperature: sampling.temperature,
    top_p: sampling.topP,
    top_k: sampling.topK,
    min_p: sampling.minP,
    repeat_penalty: sampling.repeatPenalty,
    presence_penalty: sampling.presencePenalty,
    frequency_penalty: sampling.frequencyPenalty,
    max_tokens: sampling.maxTokens > 0 ? sampling.maxTokens : undefined,
    seed: sampling.seed >= 0 ? sampling.seed : undefined,
    ...(lora?.length ? { lora } : {}),
  };

  const toolSchemas = () =>
    toolsOverride ?? getToolSchemasForLlm(toolCtx.db, toolCtx.activeAgentId);

  const streamFinalText = async (finalMessages: AgentMessage[]): Promise<string> => {
    const { content } = await completionStreamStep(
      baseUrl,
      {
        model: "default",
        messages: finalMessages,
        ...samplingBody,
      },
      { onToken, onReasoning, parseInlineToolCalls: true },
      abortSignal
    );
    if (content.trim()) {
      onToken?.(content);
      return content;
    }
    return emitFallbackText(
      onToken,
      "I ran the available tool calls, but the model did not produce a final answer. Please ask me to continue and I will pick up from the latest tool results."
    );
  };

  if (!nativeTools) {
    return streamFinalText(messages);
  }

  for (let i = 0; i < iterationLimit; i++) {
    if (abortSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const isLastAllowed = i === iterationLimit - 1;
    const body: Record<string, unknown> = {
      model: "default",
      messages,
      ...samplingBody,
    };

    if (!isLastAllowed) {
      if (useGrammar) {
        const schemas = toolSchemas();
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: "agent_step",
            strict: true,
            schema: buildGrammarResponseSchema(schemas),
          },
        };
      } else {
        body.tools = toolSchemas();
        body.tool_choice = "auto";
      }
    }

    let step = useGrammar
      ? await completionGrammarStep(
          baseUrl,
          body,
          { onToken, onReasoning },
          abortSignal
        )
      : await completionStreamStep(
          baseUrl,
          body,
          { onToken, onReasoning, onToolCallDelta, parseInlineToolCalls: true },
          abortSignal
        );

    if (!useGrammar && step.content) {
      onToken?.(step.content);
    }

    if (!step.toolCalls.length && !step.content.trim()) {
      // Some local models return an empty constrained step after a tool result,
      // then emit the next tool call only when asked for "final" text. Parse
      // that fallback text as another assistant step instead of leaking raw
      // `<|tool_call>call:name{}...` syntax to the chat.
      step = await completionStreamStep(
        baseUrl,
        {
          model: "default",
          messages,
          ...samplingBody,
        },
        { onToken, onReasoning, parseInlineToolCalls: true },
        abortSignal
      );
      if (step.content) {
        onToken?.(step.content);
      }
    }

    if (!step.toolCalls.length) {
      if (step.content.trim()) return step.content;
      return streamFinalText(messages);
    }

    const sanitizedToolCalls = dedupeToolCalls(step.toolCalls.map(sanitizeToolCall));

    messages.push({
      role: "assistant",
      content: step.content || "",
      tool_calls: sanitizedToolCalls,
    });

    const toolMessages = await executeToolCalls(sanitizedToolCalls, {
      toolCtx,
      toolExecutor,
      requiresConfirmation: requiresConfirmationFn,
      onToolCall,
      onToolResult,
      onConfirmRequired,
      onTerminalOutput,
    });
    messages.push(...toolMessages);
  }

  return streamFinalText(messages);
}

/** In-memory pending tool confirmations keyed by toolCallId */
const pendingConfirms = new Map<
  string,
  { resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
>();

export function waitForToolConfirmation(
  toolCallId: string,
  timeoutMs = 120_000
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingConfirms.delete(toolCallId);
      resolve(false);
    }, timeoutMs);
    pendingConfirms.set(toolCallId, { resolve, timeout });
  });
}

export function resolveToolConfirmation(toolCallId: string, approved: boolean): boolean {
  const pending = pendingConfirms.get(toolCallId);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingConfirms.delete(toolCallId);
  pending.resolve(approved);
  return true;
}
