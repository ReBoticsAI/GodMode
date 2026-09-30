import type { AgentMessage } from "../ai-agent.js";
import type { AgentRunRequest } from "./backend.js";

type ProviderTool = NonNullable<AgentRunRequest["toolSchemas"]>[number];

export function providerMessageContent(
  message: AgentMessage
): string | NonNullable<AgentMessage["parts"]> {
  if (message.parts?.length) return message.parts;
  return message.content;
}

export function buildProviderChatBody(opts: {
  messages: AgentMessage[];
  temperature: number;
  topP?: number;
  maxTokens?: number;
  extras?: AgentRunRequest["providerExtras"];
  tools?: ProviderTool[];
  includeTools: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages: opts.messages.map((message) => ({
      role: message.role,
      content: providerMessageContent(message),
      ...(message.reasoning_content
        ? { reasoning_content: message.reasoning_content }
        : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      ...(message.tool_call_id
        ? { tool_call_id: message.tool_call_id, name: message.name }
        : {}),
    })),
    temperature: opts.temperature,
    max_tokens: opts.maxTokens && opts.maxTokens > 0 ? opts.maxTokens : undefined,
  };
  if (typeof opts.topP === "number" && opts.topP > 0 && opts.topP < 1) {
    body.top_p = opts.topP;
  }
  const extras = opts.extras;
  const thinking = Boolean(extras?.thinkingEnabled || extras?.reasoningEffort);
  if (thinking) {
    body.thinking = {
      type: "enabled",
      clear_thinking: extras?.clearThinking !== false,
    };
    if (extras?.reasoningEffort) {
      body.reasoning_effort = extras.reasoningEffort;
    }
    body.stream = true;
    if (opts.includeTools) body.tool_stream = true;
    body.stream_options = { include_usage: true };
  }
  if (opts.includeTools && opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  return body;
}
