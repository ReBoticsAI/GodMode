/**
 * Model harness profile resolution + discovery middleware.
 * Run: npx tsx apps/bridge/src/services/__tests__/model-profiles.test.ts
 */
import assert from "node:assert/strict";
import {
  allowDiscoveryTools,
  filterSchemasForProfile,
  GEMMA4_PROFILE,
  isGemma4Model,
  resolveHarnessProfile,
  resolveProfileForAgent,
  stripThinkingChannels,
} from "../model-profiles/index.js";

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
assert.equal(resolveHarnessProfile({ source: "cursor", model: "auto" }).id, "cursor");
assert.equal(
  resolveHarnessProfile({ source: "provider", provider: "anthropic" }).id,
  "anthropic"
);

assert.equal(
  resolveProfileForAgent({
    backend: "local",
    modelPath: "/x/gemma-4-26B.gguf",
  }).id,
  "gemma-4"
);

assert.equal(
  allowDiscoveryTools(GEMMA4_PROFILE, { userMessage: "Hello" }),
  false
);
assert.equal(
  allowDiscoveryTools(GEMMA4_PROFILE, { userMessage: "list my agents" }),
  true
);

assert.ok(GEMMA4_PROFILE.harnessDelta.includes("remember only for explicit"));
assert.ok(GEMMA4_PROFILE.deferredDiscoveryTools.includes("remember"));

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

const stripped = stripThinkingChannels(
  "<|channel>thought\nsecret\n<channel|>Hello there"
);
assert.equal(stripped, "Hello there");

assert.equal(GEMMA4_PROFILE.toolMode, "native");
assert.equal(GEMMA4_PROFILE.sampling.temperature, 1.0);
assert.equal(GEMMA4_PROFILE.sampling.topP, 0.95);
assert.equal(GEMMA4_PROFILE.sampling.topK, 64);
assert.equal(GEMMA4_PROFILE.maxChatIterations, 12);

console.log("model-profiles.test.ts: ok");
