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
  resolveProfileForAgent({
    backend: "local",
    modelPath: "/x/gemma-4-26B.gguf",
  }).id,
  "gemma-4"
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
  "auto||abc"
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
