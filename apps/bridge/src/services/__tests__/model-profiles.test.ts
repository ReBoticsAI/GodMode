/**
 * Model harness profile resolution + discovery middleware.
 * Run: npx tsx apps/bridge/src/services/__tests__/model-profiles.test.ts
 */
import assert from "node:assert/strict";
import {
  allowDiscoveryTools,
  CURSOR_AUTO_PROFILE,
  CURSOR_COMPOSER_PROFILE,
  CURSOR_GROK_PROFILE,
  CURSOR_PROFILE,
  filterSchemasForProfile,
  GEMMA4_PROFILE,
  isCursorAutoModel,
  isCursorComposerModel,
  isCursorGrokModel,
  isGemma4Model,
  resolveCursorHarnessProfile,
  resolveHarnessProfile,
  resolveGroqHarnessProfile,
  resolveOpenRouterHarnessProfile,
  resolveTogetherHarnessProfile,
  resolveFireworksHarnessProfile,
  resolveDeepSeekHarnessProfile,
  resolveGoogleAiHarnessProfile,
  resolveXaiHarnessProfile,
  resolveZaiPaygHarnessProfile,
  resolveMinimaxPaygHarnessProfile,
  resolveCustomOpenAiHarnessProfile,
  resolveZaiCodingHarnessProfile,
  resolveProfileForAgent,
  stripThinkingChannels,
} from "../model-profiles/index.js";
import { formatCursorModelLabel } from "../cursor-subscription.js";
import {
  buildTranscriptAppendix,
  cursorCloudCacheFingerprint,
  cursorModelParamsHash,
} from "../agents/cursor-cloud-backend.js";

assert.equal(isGemma4Model("/models/gemma-4-26B_q4_0-it.gguf"), true);
assert.equal(isGemma4Model("Gemma-4-E4B-it-Q4_0.gguf"), true);
assert.equal(isGemma4Model("llama-3.1-8b.gguf"), false);

assert.equal(
  resolveHarnessProfile({
    source: "local",
    path: "/mnt/models/gemma-4-26B_q4_0-it.gguf",
  }).id,
  "gemma-4"
);
assert.equal(
  resolveHarnessProfile({ source: "local", path: "/m/qwen2.gguf" }).id,
  "generic-local"
);
assert.equal(
  resolveHarnessProfile({ source: "cursor", model: "auto" }).id,
  "cursor-auto"
);
assert.equal(resolveCursorHarnessProfile(null).id, "cursor-auto");
assert.equal(resolveCursorHarnessProfile("").id, "cursor-auto");
assert.equal(
  resolveHarnessProfile({ source: "cursor", model: "composer-2.5" }).id,
  "cursor-composer"
);
assert.equal(
  resolveHarnessProfile({ source: "cursor", model: "composer-2-fast" }).id,
  "cursor-composer"
);
assert.equal(
  resolveHarnessProfile({ source: "cursor", model: "grok-4.5" }).id,
  "cursor-grok"
);
assert.equal(
  resolveHarnessProfile({ source: "cursor", model: "cursor-grok-4-5" }).id,
  "cursor-grok"
);
assert.equal(
  resolveHarnessProfile({ source: "cursor", model: "gpt-5.3-codex" }).id,
  "cursor"
);
assert.equal(isCursorAutoModel("auto"), true);
assert.equal(isCursorComposerModel("composer-2.5"), true);
assert.equal(isCursorGrokModel("grok-4.5"), true);
assert.equal(
  resolveHarnessProfile({ source: "provider", provider: "anthropic" }).id,
  "anthropic"
);
assert.equal(
  resolveHarnessProfile({ source: "provider", provider: "anthropic" }).harnessDelta.length > 0,
  true
);
assert.notEqual(
  resolveProfileForAgent({
    backend: "cursor_cloud",
    config: { model: "claude-sonnet-4-20250514" },
  }).id,
  resolveProfileForAgent({
    backend: "provider",
    config: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  }).id
);
assert.equal(
  resolveHarnessProfile({ source: "provider", provider: "openai", model: "gpt-4o" }).id,
  "openai"
);
assert.equal(
  resolveHarnessProfile({ source: "provider", provider: "openai" }).harnessDelta.length > 0,
  true
);
assert.equal(
  resolveHarnessProfile({ source: "provider", provider: "openai" }).maxChatIterations,
  12
);
assert.notEqual(
  resolveProfileForAgent({
    backend: "cursor_cloud",
    config: { model: "gpt-4o" },
  }).id,
  resolveProfileForAgent({
    backend: "provider",
    config: { provider: "openai", model: "gpt-4o" },
  }).id
);

assert.equal(
  resolveOpenRouterHarnessProfile("deepseek/deepseek-v4-flash-0731").id,
  "openrouter-deepseek"
);
assert.notEqual(
  resolveOpenRouterHarnessProfile("deepseek/deepseek-v4-pro").id,
  "openai"
);
assert.equal(
  resolveOpenRouterHarnessProfile("nvidia/nemotron-3-ultra-550b-a55b:free").id,
  "openrouter-nemotron"
);
assert.equal(
  resolveOpenRouterHarnessProfile("z-ai/glm-5.2").id,
  "openrouter-glm"
);
assert.equal(
  resolveOpenRouterHarnessProfile("minimax/minimax-m3").id,
  "openrouter-minimax"
);
assert.equal(
  resolveOpenRouterHarnessProfile("moonshotai/kimi-k3").id,
  "openrouter-kimi"
);
assert.equal(
  resolveOpenRouterHarnessProfile("xiaomi/mimo-v2.5").id,
  "openrouter-generic"
);
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "deepseek/deepseek-v4-pro",
    transport: "openrouter",
  }).id,
  "openrouter-deepseek"
);
assert.equal(
  resolveProfileForAgent({
    backend: "provider",
    config: {
      provider: "openai_compatible",
      model: "deepseek/deepseek-v4-flash-0731",
      baseUrl: "https://openrouter.ai/api/v1",
      transport: "openrouter",
    },
  }).id,
  "openrouter-deepseek"
);
assert.equal(
  resolveGroqHarnessProfile("llama-3.1-8b-instant").id,
  "groq-llama"
);
assert.notEqual(resolveGroqHarnessProfile("llama-3.3-70b-versatile").id, "openai");
assert.equal(
  resolveGroqHarnessProfile("openai/gpt-oss-120b").id,
  "groq-gpt-oss"
);
assert.notEqual(
  resolveGroqHarnessProfile("openai/gpt-oss-120b").id,
  resolveHarnessProfile({
    source: "provider",
    provider: "openai",
    model: "gpt-4o",
  }).id
);
assert.equal(resolveGroqHarnessProfile("groq/compound").id, "groq-compound");
assert.equal(resolveGroqHarnessProfile("qwen/qwen3.6-27b").id, "groq-qwen");
assert.equal(
  resolveGroqHarnessProfile("moonshotai/kimi-k2-instruct").id,
  "groq-kimi"
);
assert.equal(resolveGroqHarnessProfile("unknown-model").id, "groq-generic");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "llama-3.3-70b-versatile",
    transport: "groq",
  }).id,
  "groq-llama"
);
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "deepseek/deepseek-v4-pro",
    transport: "openrouter",
  }).id,
  "openrouter-deepseek"
);
assert.equal(
  resolveTogetherHarnessProfile("meta-llama/Llama-3.3-70B-Instruct-Turbo").id,
  "together-llama"
);
assert.notEqual(
  resolveTogetherHarnessProfile("meta-llama/Llama-3.3-70B-Instruct-Turbo").id,
  "groq-llama"
);
assert.notEqual(
  resolveTogetherHarnessProfile("meta-llama/Llama-3.3-70B-Instruct-Turbo").id,
  "openai"
);
assert.equal(
  resolveTogetherHarnessProfile("openai/gpt-oss-120b").id,
  "together-gpt-oss"
);
assert.equal(
  resolveTogetherHarnessProfile("deepseek-ai/DeepSeek-V4-Pro").id,
  "together-deepseek"
);
assert.equal(resolveTogetherHarnessProfile("Qwen/Qwen3.5-9B").id, "together-qwen");
assert.equal(
  resolveTogetherHarnessProfile("MiniMaxAI/MiniMax-M3").id,
  "together-minimax"
);
assert.equal(resolveTogetherHarnessProfile("unknown-model").id, "together-generic");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "openai/gpt-oss-120b",
    transport: "together",
  }).id,
  "together-gpt-oss"
);
assert.equal(
  resolveFireworksHarnessProfile("accounts/fireworks/models/deepseek-v4-pro").id,
  "fireworks-deepseek"
);
assert.notEqual(
  resolveFireworksHarnessProfile("accounts/fireworks/models/deepseek-v4-pro").id,
  "together-deepseek"
);
assert.notEqual(
  resolveFireworksHarnessProfile("accounts/fireworks/models/deepseek-v4-pro").id,
  "openrouter-deepseek"
);
assert.equal(
  resolveFireworksHarnessProfile("accounts/fireworks/models/gpt-oss-120b").id,
  "fireworks-gpt-oss"
);
assert.equal(
  resolveFireworksHarnessProfile("accounts/fireworks/models/kimi-k3").id,
  "fireworks-kimi"
);
assert.equal(
  resolveFireworksHarnessProfile("accounts/fireworks/models/glm-5p2").id,
  "fireworks-glm"
);
assert.equal(
  resolveFireworksHarnessProfile("accounts/fireworks/models/minimax-m2p7").id,
  "fireworks-minimax"
);
assert.equal(
  resolveFireworksHarnessProfile("accounts/fireworks/models/unknown-model").id,
  "fireworks-generic"
);
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "accounts/fireworks/models/gpt-oss-120b",
    transport: "fireworks",
  }).id,
  "fireworks-gpt-oss"
);
assert.equal(resolveDeepSeekHarnessProfile("deepseek-v4-flash").id, "deepseek-flash");
assert.equal(resolveDeepSeekHarnessProfile("deepseek-v4-pro").id, "deepseek-pro");
assert.notEqual(
  resolveDeepSeekHarnessProfile("deepseek-v4-pro").id,
  "fireworks-deepseek"
);
assert.notEqual(
  resolveDeepSeekHarnessProfile("deepseek-v4-pro").id,
  "together-deepseek"
);
assert.equal(resolveDeepSeekHarnessProfile("unknown-model").id, "deepseek-generic");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "deepseek-v4-pro",
    transport: "deepseek",
  }).id,
  "deepseek-pro"
);
assert.equal(resolveGoogleAiHarnessProfile("gemini-2.5-flash").id, "google-ai-flash");
assert.equal(resolveGoogleAiHarnessProfile("gemini-2.5-pro").id, "google-ai-pro");
assert.equal(resolveGoogleAiHarnessProfile("gemini-exp-1206").id, "google-ai-generic");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "gemini-2.5-pro",
    transport: "google_ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  }).id,
  "google-ai-pro"
);
assert.equal(resolveXaiHarnessProfile("grok-4.5").id, "xai-grok");
assert.equal(resolveXaiHarnessProfile("custom-model").id, "xai-generic");
assert.notEqual(resolveXaiHarnessProfile("grok-4.5").id, "cursor-grok");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "grok-4.5",
    transport: "xai",
    baseUrl: "https://api.x.ai/v1",
  }).id,
  "xai-grok"
);
assert.equal(resolveZaiPaygHarnessProfile("glm-5.2").id, "zai-payg");
assert.notEqual(resolveZaiPaygHarnessProfile("glm-5.2").id, "zai-coding");
assert.notEqual(resolveZaiPaygHarnessProfile("glm-5.2").id, "together-glm");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "glm-5.2",
    transport: "zai",
    baseUrl: "https://api.z.ai/api/paas/v4",
  }).id,
  "zai-payg"
);
assert.equal(resolveMinimaxPaygHarnessProfile("MiniMax-M3").id, "minimax-payg");
assert.notEqual(resolveMinimaxPaygHarnessProfile("MiniMax-M3").id, "together-minimax");
assert.notEqual(resolveMinimaxPaygHarnessProfile("MiniMax-M3").id, "fireworks-minimax");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "MiniMax-M3",
    transport: "minimax",
    baseUrl: "https://api.minimax.io/v1",
  }).id,
  "minimax-payg"
);
assert.equal(resolveCustomOpenAiHarnessProfile("any-model").id, "custom-openai");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "my-model",
    transport: "custom_openai",
    baseUrl: "https://example.com/v1",
  }).id,
  "custom-openai"
);
assert.equal(resolveZaiCodingHarnessProfile("glm-5.1").id, "zai-coding");
assert.notEqual(resolveZaiCodingHarnessProfile("glm-5.1").id, "together-glm");
assert.notEqual(resolveZaiCodingHarnessProfile("glm-5.1").id, "fireworks-glm");
assert.equal(
  resolveHarnessProfile({
    source: "provider",
    provider: "openai_compatible",
    model: "glm-5.1",
    transport: "zai_coding",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
  }).id,
  "zai-coding"
);
assert.equal(
  resolveProfileForAgent({
    backend: "cursor_cloud",
    config: { model: "auto" },
  }).id,
  "cursor-auto"
);
assert.equal(
  resolveProfileForAgent({
    backend: "cursor_cloud",
    config: { model: "composer-2.5" },
  }).id,
  "cursor-composer"
);
assert.equal(
  resolveProfileForAgent({
    backend: "cursor_cloud",
    config: { model: "grok-4.5" },
  }).id,
  "cursor-grok"
);

assert.equal(
  allowDiscoveryTools(GEMMA4_PROFILE, { userMessage: "Hello" }),
  false
);
assert.equal(
  allowDiscoveryTools(GEMMA4_PROFILE, { userMessage: "list my agents" }),
  true
);
assert.equal(
  allowDiscoveryTools(CURSOR_AUTO_PROFILE, { userMessage: "hi" }),
  false
);

assert.ok(GEMMA4_PROFILE.harnessDelta.includes("remember only for explicit"));
assert.ok(GEMMA4_PROFILE.deferredDiscoveryTools.includes("remember"));
assert.ok(CURSOR_AUTO_PROFILE.harnessDelta.includes("cursor-auto"));
assert.ok(CURSOR_COMPOSER_PROFILE.harnessDelta.includes("cursor-composer"));
assert.ok(CURSOR_GROK_PROFILE.harnessDelta.includes("cursor-grok"));
assert.equal(CURSOR_COMPOSER_PROFILE.maxChatIterations, 48);
assert.equal(CURSOR_PROFILE.toolMode, "native");

const schemas = [
  { function: { name: "read_file" } },
  { function: { name: "list_subagents" } },
  { function: { name: "remember" } },
];
assert.deepEqual(
  filterSchemasForProfile(schemas, GEMMA4_PROFILE, { userMessage: "hi" }).map(
    (s) => s.function.name
  ),
  ["read_file"]
);
assert.deepEqual(
  filterSchemasForProfile(schemas, CURSOR_AUTO_PROFILE, {
    userMessage: "hello",
  }).map((s) => s.function.name),
  ["read_file", "remember"]
);

const stripped = stripThinkingChannels(
  "<|channel>thought\nsecret\n<channel|>Hello there"
);
assert.equal(stripped, "Hello there");

assert.equal(GEMMA4_PROFILE.toolMode, "native");
assert.equal(GEMMA4_PROFILE.sampling.temperature, 1.0);
assert.equal(GEMMA4_PROFILE.sampling.topP, 0.95);
assert.equal(GEMMA4_PROFILE.sampling.topK, 64);
assert.equal(GEMMA4_PROFILE.maxChatIterations, 12);

assert.equal(formatCursorModelLabel("auto"), "Auto (Cursor picks)");
assert.equal(formatCursorModelLabel("composer-2.5"), "Composer 2.5");
assert.equal(formatCursorModelLabel("grok-4.5"), "Grok 4.5");
assert.equal(formatCursorModelLabel("x", "Nice Name"), "Nice Name");

assert.equal(
  cursorCloudCacheFingerprint("auto", "abc", ""),
  "auto||abc||agent||"
);
assert.notEqual(
  cursorCloudCacheFingerprint("auto", "sys1"),
  cursorCloudCacheFingerprint("composer-2.5", "sys1")
);
assert.notEqual(
  cursorModelParamsHash({ fast: true }),
  cursorModelParamsHash(undefined)
);

const appendix = buildTranscriptAppendix([
  { role: "system", content: "sys" },
  { role: "user", content: "first" },
  { role: "assistant", content: "reply one" },
  { role: "user", content: "second" },
]);
assert.ok(appendix.includes("User: first"));
assert.ok(appendix.includes("Assistant: reply one"));
assert.ok(!appendix.includes("second"));
assert.equal(
  buildTranscriptAppendix([{ role: "user", content: "only" }]),
  ""
);

console.log("model-profiles.test.ts: ok");
