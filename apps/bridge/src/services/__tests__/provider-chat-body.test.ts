/**
 * Z.AI / OpenAI-compatible chat body for GLM-5.3 Flash.
 * Run: npx tsx apps/bridge/src/services/__tests__/provider-chat-body.test.ts
 */
import assert from "node:assert/strict";
import type { AgentMessage } from "../ai-agent.js";
import { buildProviderChatBody } from "../agents/provider-chat-body.js";

const tools = [
  {
    type: "function" as const,
    function: {
      name: "open_guide_surface",
      description: "Open a surface",
      parameters: { type: "object", properties: {} },
    },
  },
];

const prior: AgentMessage = {
  role: "assistant",
  content: "Checking the vault.",
  reasoning_content: "Look up the live price before answering.",
  tool_calls: [
    {
      id: "call_1",
      type: "function",
      function: { name: "open_guide_surface", arguments: "{\"surface\":\"godmode_inference\"}" },
    },
  ],
};

const withImage: AgentMessage = {
  role: "user",
  content: "What is this?",
  parts: [
    { type: "text", text: "What is this?" },
    { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
  ],
};

const body = buildProviderChatBody({
  messages: [prior, withImage],
  temperature: 1,
  topP: 0.95,
  maxTokens: 1024,
  extras: {
    thinkingEnabled: true,
    reasoningEffort: "max",
    clearThinking: false,
  },
  tools,
  includeTools: true,
});

assert.equal(body.stream, true);
assert.equal(body.tool_stream, true);
assert.deepEqual(body.stream_options, { include_usage: true });
assert.equal(body.reasoning_effort, "max");
assert.deepEqual(body.thinking, { type: "enabled", clear_thinking: false });
assert.equal(body.temperature, 1);
assert.equal(body.top_p, 0.95);
assert.equal(body.tool_choice, "auto");

const messages = body.messages as Array<Record<string, unknown>>;
assert.equal(
  messages[0].reasoning_content,
  "Look up the live price before answering."
);
assert.deepEqual(messages[1].content, withImage.parts);

const signup = buildProviderChatBody({
  messages: [{ role: "user", content: "hello" }],
  temperature: 1,
  topP: 0.95,
  extras: { thinkingEnabled: true, reasoningEffort: "low", clearThinking: true },
  includeTools: false,
});
assert.equal(signup.stream, true);
assert.equal(signup.tool_stream, undefined);
assert.equal(signup.reasoning_effort, "low");
assert.deepEqual(signup.thinking, { type: "enabled", clear_thinking: true });

const plain = buildProviderChatBody({
  messages: [{ role: "user", content: "hello" }],
  temperature: 0.2,
  includeTools: false,
});
assert.equal(plain.stream, undefined);
assert.equal(plain.thinking, undefined);

console.log("provider-chat-body.test.ts ok");
