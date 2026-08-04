/**
 * NVIDIA-style model harness profiles: tune tool mode, sampling, prompts, and
 * tool middleware around each model family. The Intelligence picker resolves a
 * profile from the selected catalog entry; chat re-derives from the active model
 * so the harness cannot drift.
 */

export type HarnessToolMode = "native" | "grammar" | "none";

export interface ModelHarnessSampling {
  temperature: number;
  topP: number;
  topK: number;
}

export interface ModelHarnessProfile {
  id: string;
  label: string;
  toolMode: HarnessToolMode;
  /** Overlay on agent sampling for chat (card-recommended trio when set). */
  sampling: ModelHarnessSampling;
  maxChatIterations: number;
  enableThinkingDefault: boolean;
  /** Strip Gemma/OpenAI-style thought channels before re-feeding history. */
  stripThinkingFromHistory: boolean;
  requireJinja: boolean;
  /** Tools omitted from schemas unless agent-context allows them. */
  deferredDiscoveryTools: string[];
  /** Appended after the base harness (simple-chat gate, etc.). */
  harnessDelta: string;
}

export type HarnessCatalogSource = "local" | "cursor" | "provider" | "remote";

export interface ResolveProfileInput {
  source: HarnessCatalogSource;
  path?: string | null;
  model?: string | null;
  provider?: string | null;
  /** When provider is openai_compatible, marks OpenRouter transport. */
  transport?: string | null;
  baseUrl?: string | null;
}

/** Minimal agent shape for profile resolution (avoids circular imports). */
export interface AgentForProfileResolve {
  backend: string;
  modelPath?: string | null;
  config?: Record<string, unknown> | null;
}

const GEMMA4_HARNESS_DELTA = [
  "<model_profile id=\"gemma-4\">",
  "You are running on Gemma 4 (native function calling + jinja chat template).",
  "Greetings and simple conversational questions: answer in plain language with NO tools.",
  "Do not call discovery tools (list_subagents, list agents, etc.) unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
  "Memory and wiki sections in this prompt are already retrieved — do not re-probe them with tools unless the user asks for a full page or deeper search.",
  "Use remember only for explicit durable facts the user asks you to keep — never for greetings or chitchat.",
  "Use wiki tools when the user asks how GodMode works or clearly needs docs — not by default before coding.",
  "Prefer one purposeful tool turn over probing. Keep coding/plugin tiers for real engineering tasks.",
  "</model_profile>",
].join("\n");

/** Full profile for Gemma 4 QAT Instruct (incl. 26B A4B Q4_0 GGUF). */
export const GEMMA4_PROFILE: ModelHarnessProfile = {
  id: "gemma-4",
  label: "Gemma 4",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: true,
  deferredDiscoveryTools: [
    "list_subagents",
    "list_agents",
    "fetch_ai_agents",
    "list_ai_agents",
    "remember",
  ],
  harnessDelta: GEMMA4_HARNESS_DELTA,
};

const CURSOR_COMMON_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
];

const CURSOR_AUTO_HARNESS_DELTA = [
  "<model_profile id=\"cursor-auto\">",
  "You are running via Cursor subscription Auto (Cursor picks among the Auto bucket).",
  "Greetings and simple conversational questions: answer in plain language with NO tools.",
  "Memory and wiki sections in this prompt are already retrieved — do not re-probe them with tools unless the user asks for a full page or deeper search.",
  "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
  "Prefer one purposeful tool turn. Use GodMode coding/plugin tools for real engineering tasks.",
  "</model_profile>",
].join("\n");

const CURSOR_COMPOSER_HARNESS_DELTA = [
  "<model_profile id=\"cursor-composer\">",
  "You are running Cursor Composer (coding specialist) via the Cursor SDK.",
  "Greetings: answer briefly with no tools. For engineering work, use GodMode coding tools deliberately.",
  "Memory and wiki sections are already retrieved — deep-read wiki only when docs are clearly needed.",
  "Prefer structured edits and verification over exploratory tool spam.",
  "</model_profile>",
].join("\n");

const CURSOR_GROK_HARNESS_DELTA = [
  "<model_profile id=\"cursor-grok\">",
  "You are running Grok via the Cursor SDK (broader STEM / knowledge work, not only coding).",
  "Greetings and simple chat: answer in plain language with NO tools.",
  "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
  "Use discovery tools only when the USER asks about agents or tool inventory.",
  "For coding tasks prefer purposeful GodMode tools; for analysis prefer clear reasoning then tools when needed.",
  "</model_profile>",
].join("\n");

/** Fallback for unknown Cursor model ids. */
export const CURSOR_PROFILE: ModelHarnessProfile = {
  id: "cursor",
  label: "Cursor",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 32,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...CURSOR_COMMON_DEFERRED],
  harnessDelta: CURSOR_AUTO_HARNESS_DELTA.replace(
    'id="cursor-auto"',
    'id="cursor"'
  ).replace(
    "Cursor subscription Auto (Cursor picks among the Auto bucket).",
    "a Cursor subscription model via the SDK."
  ),
};

/** Cursor Auto bucket (`model: auto`). */
export const CURSOR_AUTO_PROFILE: ModelHarnessProfile = {
  id: "cursor-auto",
  label: "Cursor Auto",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 32,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...CURSOR_COMMON_DEFERRED],
  harnessDelta: CURSOR_AUTO_HARNESS_DELTA,
};

/** Cursor Composer family (coding specialist). */
export const CURSOR_COMPOSER_PROFILE: ModelHarnessProfile = {
  id: "cursor-composer",
  label: "Cursor Composer",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 48,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...CURSOR_COMMON_DEFERRED],
  harnessDelta: CURSOR_COMPOSER_HARNESS_DELTA,
};

/** Grok family via Cursor SDK. */
export const CURSOR_GROK_PROFILE: ModelHarnessProfile = {
  id: "cursor-grok",
  label: "Cursor Grok",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 32,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...CURSOR_COMMON_DEFERRED],
  harnessDelta: CURSOR_GROK_HARNESS_DELTA,
};

const OPENAI_HARNESS_DELTA = [
  "<model_profile id=\"openai\">",
  "You are running via the OpenAI Platform API (metered BYOK), with native function calling.",
  "Prefer structured tool schemas over describing tools in prose. Do not invent tool names.",
  "Greetings and simple conversational questions: answer in plain language with NO tools.",
  "Do not call discovery tools (list_subagents, list agents, etc.) unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
  "Memory and wiki sections in this prompt are already retrieved — do not re-probe them with tools unless the user asks for a full page or deeper search.",
  "Prefer one purposeful tool turn; cap exploratory loops. Keep coding/plugin tiers for real engineering tasks.",
  "When tools fail, treat errors as data and recover or explain — do not spin forever.",
  "</model_profile>",
].join("\n");

/**
 * OpenAI Platform API harness. Tuned from OpenAI function-calling guidance:
 * native tools, keep the active tool surface lean, hard turn cap, no tool spam.
 * https://platform.openai.com/docs/guides/function-calling
 */
export const OPENAI_PROFILE: ModelHarnessProfile = {
  id: "openai",
  label: "OpenAI Platform",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [
    "list_subagents",
    "list_agents",
    "fetch_ai_agents",
    "list_ai_agents",
    "remember",
  ],
  harnessDelta: OPENAI_HARNESS_DELTA,
};

const ANTHROPIC_HARNESS_DELTA = [
  "<model_profile id=\"anthropic\">",
  "You are running via the Anthropic Console API (metered BYOK), with native tool use.",
  "This is not Claude.ai Pro/Max consumer login and not the Cursor SDK Claude path.",
  "Rely on tool schemas and descriptions for when/how to call tools; keep this system note lean.",
  "Greetings and simple conversational questions: answer in plain language with NO tools.",
  "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
  "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
  "Prefer purposeful tool turns. On tool errors, treat results as data and recover or explain.",
  "</model_profile>",
].join("\n");

/**
 * Anthropic Console API harness. Tuned from Anthropic tool-use guidance:
 * lean system prompt, native tools, temp 1.0, deferred discovery.
 * https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview
 */
export const ANTHROPIC_PROFILE: ModelHarnessProfile = {
  id: "anthropic",
  label: "Anthropic Console",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [
    "list_subagents",
    "list_agents",
    "fetch_ai_agents",
    "list_ai_agents",
    "remember",
  ],
  harnessDelta: ANTHROPIC_HARNESS_DELTA,
};

/** Shared OpenRouter transport middleware (BYOK via OpenAI-compatible tools). */
const OPENROUTER_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

function openRouterFamilyDelta(id: string, familyLines: string[]): string {
  return [
    `<model_profile id="${id}">`,
    "You are running via OpenRouter (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path and not a direct OpenAI Platform or Anthropic Console session.",
    "Use native OpenAI-style function calling as exposed by OpenRouter. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
    "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
    "Prefer purposeful tool turns; cap exploratory loops. On tool errors, treat results as data and recover or explain.",
    ...familyLines,
    "</model_profile>",
  ].join("\n");
}

/**
 * OpenRouter + DeepSeek family. OpenAI-compatible tools via OpenRouter;
 * keep the tool surface lean (DeepSeek function-calling docs).
 */
export const OPENROUTER_DEEPSEEK_PROFILE: ModelHarnessProfile = {
  id: "openrouter-deepseek",
  label: "OpenRouter DeepSeek",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...OPENROUTER_TRANSPORT_DEFERRED],
  harnessDelta: openRouterFamilyDelta("openrouter-deepseek", [
    "DeepSeek via OpenRouter: prefer structured tool schemas; avoid describing tools in prose.",
  ]),
};

/**
 * OpenRouter + GLM / Z.ai family.
 */
export const OPENROUTER_GLM_PROFILE: ModelHarnessProfile = {
  id: "openrouter-glm",
  label: "OpenRouter GLM",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...OPENROUTER_TRANSPORT_DEFERRED],
  harnessDelta: openRouterFamilyDelta("openrouter-glm", [
    "GLM via OpenRouter: follow tool schemas closely; one purposeful tool turn when possible.",
  ]),
};

/**
 * OpenRouter + NVIDIA Nemotron family (OpenAI-compatible tool calling).
 */
export const OPENROUTER_NEMOTRON_PROFILE: ModelHarnessProfile = {
  id: "openrouter-nemotron",
  label: "OpenRouter Nemotron",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...OPENROUTER_TRANSPORT_DEFERRED],
  harnessDelta: openRouterFamilyDelta("openrouter-nemotron", [
    "Nemotron via OpenRouter: lean active tools; hard turn cap; no discovery spam.",
  ]),
};

/**
 * OpenRouter + MiniMax family.
 */
export const OPENROUTER_MINIMAX_PROFILE: ModelHarnessProfile = {
  id: "openrouter-minimax",
  label: "OpenRouter MiniMax",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...OPENROUTER_TRANSPORT_DEFERRED],
  harnessDelta: openRouterFamilyDelta("openrouter-minimax", [
    "MiniMax via OpenRouter: use native tools; keep exploratory loops short.",
  ]),
};

/**
 * OpenRouter + Kimi / Moonshot family.
 */
export const OPENROUTER_KIMI_PROFILE: ModelHarnessProfile = {
  id: "openrouter-kimi",
  label: "OpenRouter Kimi",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...OPENROUTER_TRANSPORT_DEFERRED],
  harnessDelta: openRouterFamilyDelta("openrouter-kimi", [
    "Kimi via OpenRouter: prefer structured tool calls; do not re-probe memory/wiki without need.",
  ]),
};

/**
 * OpenRouter generic family (MiMo, Hy3, StepFun, Ling, and other slug prefixes).
 */
export const OPENROUTER_GENERIC_PROFILE: ModelHarnessProfile = {
  id: "openrouter-generic",
  label: "OpenRouter (generic)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...OPENROUTER_TRANSPORT_DEFERRED],
  harnessDelta: openRouterFamilyDelta("openrouter-generic", [
    "Generic OpenRouter route: OpenAI-compatible tools; keep discovery deferred unless asked.",
  ]),
};

/**
 * Map OpenRouter model slug → family harness.
 * Transport is OpenRouter; family from author/path prefix (not one profile per model id).
 */
export function resolveOpenRouterHarnessProfile(
  modelSlug: string | null | undefined
): ModelHarnessProfile {
  const slug = (modelSlug ?? "").trim().toLowerCase();
  if (slug.startsWith("deepseek/")) return OPENROUTER_DEEPSEEK_PROFILE;
  if (slug.startsWith("z-ai/")) return OPENROUTER_GLM_PROFILE;
  if (slug.startsWith("nvidia/nemotron")) return OPENROUTER_NEMOTRON_PROFILE;
  if (slug.startsWith("minimax/")) return OPENROUTER_MINIMAX_PROFILE;
  if (slug.startsWith("moonshotai/")) return OPENROUTER_KIMI_PROFILE;
  return OPENROUTER_GENERIC_PROFILE;
}

/** Shared Groq transport middleware (BYOK via OpenAI-compatible tools). */
const GROQ_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

function groqFamilyDelta(id: string, familyLines: string[]): string {
  return [
    `<model_profile id="${id}">`,
    "You are running via GroqCloud (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path, not direct OpenAI Platform, and not OpenRouter.",
    "Use native OpenAI-style function calling as exposed by Groq. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
    "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
    "Prefer purposeful tool turns; cap exploratory loops. On tool errors, treat results as data and recover or explain.",
    ...familyLines,
    "</model_profile>",
  ].join("\n");
}

export const GROQ_LLAMA_PROFILE: ModelHarnessProfile = {
  id: "groq-llama",
  label: "Groq Llama",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GROQ_TRANSPORT_DEFERRED],
  harnessDelta: groqFamilyDelta("groq-llama", [
    "Llama via Groq: lean tool surface; prefer structured schemas over prose tool descriptions.",
  ]),
};

export const GROQ_GPT_OSS_PROFILE: ModelHarnessProfile = {
  id: "groq-gpt-oss",
  label: "Groq GPT-OSS",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GROQ_TRANSPORT_DEFERRED],
  harnessDelta: groqFamilyDelta("groq-gpt-oss", [
    "GPT-OSS via Groq (not OpenAI Platform Console). Use Groq-hosted OpenAI-compatible tools only.",
  ]),
};

export const GROQ_QWEN_PROFILE: ModelHarnessProfile = {
  id: "groq-qwen",
  label: "Groq Qwen",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GROQ_TRANSPORT_DEFERRED],
  harnessDelta: groqFamilyDelta("groq-qwen", [
    "Qwen via Groq: follow tool schemas closely; keep discovery deferred unless asked.",
  ]),
};

export const GROQ_KIMI_PROFILE: ModelHarnessProfile = {
  id: "groq-kimi",
  label: "Groq Kimi",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GROQ_TRANSPORT_DEFERRED],
  harnessDelta: groqFamilyDelta("groq-kimi", [
    "Kimi via Groq (not OpenRouter). Prefer structured tool calls; no memory/wiki re-probe without need.",
  ]),
};

export const GROQ_COMPOUND_PROFILE: ModelHarnessProfile = {
  id: "groq-compound",
  label: "Groq Compound",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GROQ_TRANSPORT_DEFERRED],
  harnessDelta: groqFamilyDelta("groq-compound", [
    "Groq Compound may use built-in host tools; still prefer GodMode tool schemas when offered. Avoid discovery spam.",
  ]),
};

export const GROQ_GENERIC_PROFILE: ModelHarnessProfile = {
  id: "groq-generic",
  label: "Groq (generic)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GROQ_TRANSPORT_DEFERRED],
  harnessDelta: groqFamilyDelta("groq-generic", [
    "Generic Groq route: OpenAI-compatible tools; keep discovery deferred unless asked.",
  ]),
};

/**
 * Map Groq model id → family harness.
 * Transport is Groq; family from id prefix (not one profile per model id).
 */
export function resolveGroqHarnessProfile(
  modelSlug: string | null | undefined
): ModelHarnessProfile {
  const slug = (modelSlug ?? "").trim().toLowerCase();
  if (slug.startsWith("openai/gpt-oss")) return GROQ_GPT_OSS_PROFILE;
  if (slug.startsWith("qwen/")) return GROQ_QWEN_PROFILE;
  if (slug.startsWith("moonshotai/")) return GROQ_KIMI_PROFILE;
  if (slug.startsWith("groq/compound")) return GROQ_COMPOUND_PROFILE;
  if (slug.includes("prompt-guard")) return GROQ_GENERIC_PROFILE;
  if (slug.startsWith("llama-") || slug.startsWith("meta-llama/llama-")) {
    return GROQ_LLAMA_PROFILE;
  }
  return GROQ_GENERIC_PROFILE;
}

/** Shared Together transport middleware (BYOK via OpenAI-compatible tools). */
const TOGETHER_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

function togetherFamilyDelta(id: string, familyLines: string[]): string {
  return [
    `<model_profile id="${id}">`,
    "You are running via Together AI serverless (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path, not OpenAI Platform, not OpenRouter, and not Groq.",
    "Use native OpenAI-style function calling as exposed by Together. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
    "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
    "Prefer purposeful tool turns; cap exploratory loops. On tool errors, treat results as data and recover or explain.",
    ...familyLines,
    "</model_profile>",
  ].join("\n");
}

export const TOGETHER_LLAMA_PROFILE: ModelHarnessProfile = {
  id: "together-llama",
  label: "Together Llama",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-llama", [
    "Llama via Together: lean tool surface; prefer structured schemas over prose tool descriptions.",
  ]),
};

export const TOGETHER_GPT_OSS_PROFILE: ModelHarnessProfile = {
  id: "together-gpt-oss",
  label: "Together GPT-OSS",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-gpt-oss", [
    "GPT-OSS via Together (not OpenAI Platform, not Groq). Use Together-hosted OpenAI-compatible tools only.",
  ]),
};

export const TOGETHER_DEEPSEEK_PROFILE: ModelHarnessProfile = {
  id: "together-deepseek",
  label: "Together DeepSeek",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-deepseek", [
    "DeepSeek via Together (not OpenRouter). Prefer structured tool schemas; avoid discovery spam.",
  ]),
};

export const TOGETHER_QWEN_PROFILE: ModelHarnessProfile = {
  id: "together-qwen",
  label: "Together Qwen",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-qwen", [
    "Qwen via Together: follow tool schemas closely; keep discovery deferred unless asked.",
  ]),
};

export const TOGETHER_KIMI_PROFILE: ModelHarnessProfile = {
  id: "together-kimi",
  label: "Together Kimi",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-kimi", [
    "Kimi via Together (not OpenRouter/Groq). Prefer structured tool calls; no memory/wiki re-probe without need.",
  ]),
};

export const TOGETHER_MINIMAX_PROFILE: ModelHarnessProfile = {
  id: "together-minimax",
  label: "Together MiniMax",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-minimax", [
    "MiniMax via Together: use native tools; keep exploratory loops short.",
  ]),
};

export const TOGETHER_GLM_PROFILE: ModelHarnessProfile = {
  id: "together-glm",
  label: "Together GLM",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-glm", [
    "GLM via Together (not OpenRouter): follow tool schemas; one purposeful tool turn when possible.",
  ]),
};

export const TOGETHER_NEMOTRON_PROFILE: ModelHarnessProfile = {
  id: "together-nemotron",
  label: "Together Nemotron",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-nemotron", [
    "Nemotron via Together (not OpenRouter): lean active tools; hard turn cap.",
  ]),
};

export const TOGETHER_GEMMA_PROFILE: ModelHarnessProfile = {
  id: "together-gemma",
  label: "Together Gemma",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-gemma", [
    "Gemma via Together serverless (not local GGUF gemma-4). Use Together-hosted OpenAI-compatible tools.",
  ]),
};

export const TOGETHER_GENERIC_PROFILE: ModelHarnessProfile = {
  id: "together-generic",
  label: "Together (generic)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...TOGETHER_TRANSPORT_DEFERRED],
  harnessDelta: togetherFamilyDelta("together-generic", [
    "Generic Together route: OpenAI-compatible tools; keep discovery deferred unless asked.",
  ]),
};

/**
 * Map Together model id → family harness.
 * Transport is Together; family from author/path prefix (not one profile per model id).
 */
export function resolveTogetherHarnessProfile(
  modelSlug: string | null | undefined
): ModelHarnessProfile {
  const slug = (modelSlug ?? "").trim().toLowerCase();
  if (slug.startsWith("meta-llama/")) return TOGETHER_LLAMA_PROFILE;
  if (slug.startsWith("openai/gpt-oss")) return TOGETHER_GPT_OSS_PROFILE;
  if (slug.startsWith("deepseek-ai/")) return TOGETHER_DEEPSEEK_PROFILE;
  if (slug.startsWith("qwen/")) return TOGETHER_QWEN_PROFILE;
  if (slug.startsWith("moonshotai/")) return TOGETHER_KIMI_PROFILE;
  if (slug.startsWith("minimaxai/")) return TOGETHER_MINIMAX_PROFILE;
  if (slug.startsWith("zai-org/")) return TOGETHER_GLM_PROFILE;
  if (slug.startsWith("nvidia/nemotron")) return TOGETHER_NEMOTRON_PROFILE;
  if (slug.startsWith("google/gemma")) return TOGETHER_GEMMA_PROFILE;
  return TOGETHER_GENERIC_PROFILE;
}

/** Shared Fireworks transport middleware (BYOK via OpenAI-compatible tools). */
const FIREWORKS_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

function fireworksFamilyDelta(id: string, familyLines: string[]): string {
  return [
    `<model_profile id="${id}">`,
    "You are running via Fireworks AI serverless (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path, not OpenAI Platform, not OpenRouter, not Groq, and not Together.",
    "Use native OpenAI-style function calling as exposed by Fireworks. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
    "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
    "Prefer purposeful tool turns; cap exploratory loops. On tool errors, treat results as data and recover or explain.",
    ...familyLines,
    "</model_profile>",
  ].join("\n");
}

export const FIREWORKS_LLAMA_PROFILE: ModelHarnessProfile = {
  id: "fireworks-llama",
  label: "Fireworks Llama",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-llama", [
    "Llama via Fireworks: lean tool surface; prefer structured schemas over prose tool descriptions.",
  ]),
};

export const FIREWORKS_GPT_OSS_PROFILE: ModelHarnessProfile = {
  id: "fireworks-gpt-oss",
  label: "Fireworks GPT-OSS",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-gpt-oss", [
    "GPT-OSS via Fireworks (not OpenAI Platform, not Groq/Together). Use Fireworks-hosted OpenAI-compatible tools only.",
  ]),
};

export const FIREWORKS_DEEPSEEK_PROFILE: ModelHarnessProfile = {
  id: "fireworks-deepseek",
  label: "Fireworks DeepSeek",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-deepseek", [
    "DeepSeek via Fireworks (not OpenRouter/Together). Prefer structured tool schemas; avoid discovery spam.",
  ]),
};

export const FIREWORKS_QWEN_PROFILE: ModelHarnessProfile = {
  id: "fireworks-qwen",
  label: "Fireworks Qwen",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-qwen", [
    "Qwen via Fireworks: follow tool schemas closely; keep discovery deferred unless asked.",
  ]),
};

export const FIREWORKS_KIMI_PROFILE: ModelHarnessProfile = {
  id: "fireworks-kimi",
  label: "Fireworks Kimi",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-kimi", [
    "Kimi via Fireworks (not OpenRouter/Groq/Together). Prefer structured tool calls; no memory/wiki re-probe without need.",
  ]),
};

export const FIREWORKS_MINIMAX_PROFILE: ModelHarnessProfile = {
  id: "fireworks-minimax",
  label: "Fireworks MiniMax",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-minimax", [
    "MiniMax via Fireworks: use native tools; keep exploratory loops short.",
  ]),
};

export const FIREWORKS_GLM_PROFILE: ModelHarnessProfile = {
  id: "fireworks-glm",
  label: "Fireworks GLM",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-glm", [
    "GLM via Fireworks (not OpenRouter/Together): follow tool schemas; one purposeful tool turn when possible.",
  ]),
};

export const FIREWORKS_NEMOTRON_PROFILE: ModelHarnessProfile = {
  id: "fireworks-nemotron",
  label: "Fireworks Nemotron",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-nemotron", [
    "Nemotron via Fireworks (not OpenRouter/Together): lean active tools; hard turn cap.",
  ]),
};

export const FIREWORKS_GEMMA_PROFILE: ModelHarnessProfile = {
  id: "fireworks-gemma",
  label: "Fireworks Gemma",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-gemma", [
    "Gemma via Fireworks serverless (not local GGUF gemma-4). Use Fireworks-hosted OpenAI-compatible tools.",
  ]),
};

export const FIREWORKS_GENERIC_PROFILE: ModelHarnessProfile = {
  id: "fireworks-generic",
  label: "Fireworks (generic)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...FIREWORKS_TRANSPORT_DEFERRED],
  harnessDelta: fireworksFamilyDelta("fireworks-generic", [
    "Generic Fireworks route: OpenAI-compatible tools; keep discovery deferred unless asked.",
  ]),
};

/**
 * Map Fireworks model id → family harness.
 * Transport is Fireworks; family from model slug leaf (not one profile per model id).
 */
export function resolveFireworksHarnessProfile(
  modelSlug: string | null | undefined
): ModelHarnessProfile {
  let slug = (modelSlug ?? "").trim().toLowerCase();
  const prefix = "accounts/fireworks/models/";
  const routerPrefix = "accounts/fireworks/routers/";
  if (slug.startsWith(prefix)) slug = slug.slice(prefix.length);
  else if (slug.startsWith(routerPrefix)) slug = slug.slice(routerPrefix.length);
  if (slug.startsWith("llama") || slug.includes("/llama")) return FIREWORKS_LLAMA_PROFILE;
  if (slug.startsWith("gpt-oss") || slug.includes("gpt-oss")) return FIREWORKS_GPT_OSS_PROFILE;
  if (slug.startsWith("deepseek") || slug.includes("deepseek")) {
    return FIREWORKS_DEEPSEEK_PROFILE;
  }
  if (slug.startsWith("qwen") || slug.includes("qwen")) return FIREWORKS_QWEN_PROFILE;
  if (slug.startsWith("kimi") || slug.includes("kimi")) return FIREWORKS_KIMI_PROFILE;
  if (slug.startsWith("minimax") || slug.includes("minimax")) {
    return FIREWORKS_MINIMAX_PROFILE;
  }
  if (slug.startsWith("glm") || slug.includes("glm")) return FIREWORKS_GLM_PROFILE;
  if (slug.includes("nemotron")) return FIREWORKS_NEMOTRON_PROFILE;
  if (slug.startsWith("gemma") || slug.includes("gemma")) return FIREWORKS_GEMMA_PROFILE;
  return FIREWORKS_GENERIC_PROFILE;
}

/** Shared DeepSeek platform transport middleware (BYOK via OpenAI-compatible tools). */
const DEEPSEEK_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

function deepseekFamilyDelta(id: string, familyLines: string[]): string {
  return [
    `<model_profile id="${id}">`,
    "You are running via DeepSeek Platform API (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path, not Fireworks, not Together, and not OpenRouter.",
    "Use native OpenAI-style function calling as exposed by DeepSeek. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
    "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
    "Prefer purposeful tool turns; cap exploratory loops. On tool errors, treat results as data and recover or explain.",
    ...familyLines,
    "</model_profile>",
  ].join("\n");
}

export const DEEPSEEK_FLASH_PROFILE: ModelHarnessProfile = {
  id: "deepseek-flash",
  label: "DeepSeek V4 Flash",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...DEEPSEEK_TRANSPORT_DEFERRED],
  harnessDelta: deepseekFamilyDelta("deepseek-flash", [
    "DeepSeek V4 Flash via Platform API: lean tool surface; prefer structured schemas; keep discovery deferred.",
  ]),
};

export const DEEPSEEK_PRO_PROFILE: ModelHarnessProfile = {
  id: "deepseek-pro",
  label: "DeepSeek V4 Pro",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 16,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...DEEPSEEK_TRANSPORT_DEFERRED],
  harnessDelta: deepseekFamilyDelta("deepseek-pro", [
    "DeepSeek V4 Pro via Platform API (not Fireworks/Together/OpenRouter). Prefer structured tool schemas; one purposeful tool turn when possible.",
  ]),
};

export const DEEPSEEK_GENERIC_PROFILE: ModelHarnessProfile = {
  id: "deepseek-generic",
  label: "DeepSeek (generic)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 12,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...DEEPSEEK_TRANSPORT_DEFERRED],
  harnessDelta: deepseekFamilyDelta("deepseek-generic", [
    "Generic DeepSeek Platform route: OpenAI-compatible tools; keep discovery deferred unless asked.",
  ]),
};

/**
 * Map DeepSeek Platform model id → family harness.
 * Transport is DeepSeek Platform; distinct from Fireworks/Together/OpenRouter DeepSeek routes.
 */
export function resolveDeepSeekHarnessProfile(
  modelSlug: string | null | undefined
): ModelHarnessProfile {
  const slug = (modelSlug ?? "").trim().toLowerCase();
  if (slug.includes("v4-pro") || slug === "deepseek-v4-pro") return DEEPSEEK_PRO_PROFILE;
  if (slug.includes("v4-flash") || slug === "deepseek-v4-flash") {
    return DEEPSEEK_FLASH_PROFILE;
  }
  return DEEPSEEK_GENERIC_PROFILE;
}

/** Shared Google AI Studio transport middleware (BYOK via OpenAI-compatible tools). */
const GOOGLE_AI_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

function googleAiFamilyDelta(id: string, familyLines: string[]): string {
  return [
    `<model_profile id="${id}">`,
    "You are running via Google AI Studio / Gemini API (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path, not Vertex, and not Gemini Advanced consumer login.",
    "Use native OpenAI-style function calling as exposed by the Gemini OpenAI-compat endpoint. Do not invent tool names.",
    ...familyLines,
    "</model_profile>",
  ].join("\n");
}

export const GOOGLE_AI_FLASH_PROFILE: ModelHarnessProfile = {
  id: "google-ai-flash",
  label: "Google AI Flash",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 14,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GOOGLE_AI_TRANSPORT_DEFERRED],
  harnessDelta: googleAiFamilyDelta("google-ai-flash", [
    "Gemini Flash via Google AI Studio: lean tool surface; prefer structured schemas; keep discovery deferred.",
  ]),
};

export const GOOGLE_AI_PRO_PROFILE: ModelHarnessProfile = {
  id: "google-ai-pro",
  label: "Google AI Pro",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 16,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GOOGLE_AI_TRANSPORT_DEFERRED],
  harnessDelta: googleAiFamilyDelta("google-ai-pro", [
    "Gemini Pro via Google AI Studio: prefer structured tool schemas; one purposeful tool turn when possible.",
  ]),
};

export const GOOGLE_AI_GENERIC_PROFILE: ModelHarnessProfile = {
  id: "google-ai-generic",
  label: "Google AI (generic)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 14,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...GOOGLE_AI_TRANSPORT_DEFERRED],
  harnessDelta: googleAiFamilyDelta("google-ai-generic", [
    "Generic Google AI Studio route: OpenAI-compatible tools; keep discovery deferred unless asked.",
  ]),
};

/**
 * Map Google AI Studio / Gemini model id → family harness.
 * Transport is Google AI Studio; distinct from OpenRouter/Together Gemini routes.
 */
export function resolveGoogleAiHarnessProfile(
  modelSlug: string | null | undefined
): ModelHarnessProfile {
  const slug = (modelSlug ?? "").trim().toLowerCase();
  if (slug.includes("pro")) return GOOGLE_AI_PRO_PROFILE;
  if (slug.includes("flash") || slug.includes("flash-lite")) {
    return GOOGLE_AI_FLASH_PROFILE;
  }
  return GOOGLE_AI_GENERIC_PROFILE;
}

/** Shared xAI console transport middleware (BYOK via OpenAI-compatible tools). */
const XAI_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

function xaiFamilyDelta(id: string, familyLines: string[]): string {
  return [
    `<model_profile id="${id}">`,
    "You are running via xAI console API (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path and not SuperGrok / X Premium OAuth.",
    "Use native OpenAI-style function calling as exposed by the xAI endpoint. Do not invent tool names.",
    ...familyLines,
    "</model_profile>",
  ].join("\n");
}

export const XAI_GROK_PROFILE: ModelHarnessProfile = {
  id: "xai-grok",
  label: "xAI Grok",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 16,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...XAI_TRANSPORT_DEFERRED],
  harnessDelta: xaiFamilyDelta("xai-grok", [
    "Grok via xAI console: lean tool surface; prefer structured schemas; keep discovery deferred.",
  ]),
};

export const XAI_GENERIC_PROFILE: ModelHarnessProfile = {
  id: "xai-generic",
  label: "xAI (generic)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 14,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...XAI_TRANSPORT_DEFERRED],
  harnessDelta: xaiFamilyDelta("xai-generic", [
    "Generic xAI console route: OpenAI-compatible tools; keep discovery deferred unless asked.",
  ]),
};

/**
 * Map xAI console model id → family harness.
 * Transport is xAI console; distinct from Cursor Grok and SuperGrok OAuth.
 */
export function resolveXaiHarnessProfile(
  modelSlug: string | null | undefined
): ModelHarnessProfile {
  const slug = (modelSlug ?? "").trim().toLowerCase();
  if (slug.includes("grok")) return XAI_GROK_PROFILE;
  return XAI_GENERIC_PROFILE;
}

/** Z.AI general payg transport (#231). Distinct from Coding Plan. */
const ZAI_PAYG_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

export const ZAI_PAYG_PROFILE: ModelHarnessProfile = {
  id: "zai-payg",
  label: "Z.AI Platform (payg)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 14,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...ZAI_PAYG_TRANSPORT_DEFERRED],
  harnessDelta: [
    '<model_profile id="zai-payg">',
    "You are running via Z.AI Platform payg (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path, not GLM Coding Plan, and not Fireworks/Together GLM hosting.",
    "Use native OpenAI-style function calling as exposed by the paas endpoint. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
    "GLM payg: lean tool surface; follow schemas closely.",
    "</model_profile>",
  ].join("\n"),
};

export function resolveZaiPaygHarnessProfile(
  _modelSlug?: string | null
): ModelHarnessProfile {
  return ZAI_PAYG_PROFILE;
}

/** MiniMax payg transport (#231). Distinct from Token Plan and hosted MiniMax routes. */
const MINIMAX_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

export const MINIMAX_PAYG_PROFILE: ModelHarnessProfile = {
  id: "minimax-payg",
  label: "MiniMax (payg)",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 14,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...MINIMAX_TRANSPORT_DEFERRED],
  harnessDelta: [
    '<model_profile id="minimax-payg">',
    "You are running via MiniMax Platform payg (openai_compatible transport, metered BYOK).",
    "This is not the Cursor SDK path, not MiniMax Token Plan, and not Fireworks/Together/OpenRouter MiniMax hosting.",
    "Use native OpenAI-style function calling as exposed by the MiniMax endpoint. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory.",
    "MiniMax payg: lean tool surface; follow schemas closely.",
    "</model_profile>",
  ].join("\n"),
};

export function resolveMinimaxPaygHarnessProfile(
  _modelSlug?: string | null
): ModelHarnessProfile {
  return MINIMAX_PAYG_PROFILE;
}

/** Z.AI GLM Coding Plan subscription transport (#230). */
const ZAI_CODING_TRANSPORT_DEFERRED = [
  "list_subagents",
  "list_agents",
  "fetch_ai_agents",
  "list_ai_agents",
  "remember",
] as const;

export const ZAI_CODING_PROFILE: ModelHarnessProfile = {
  id: "zai-coding",
  label: "Z.AI GLM Coding Plan",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 1.0, topK: 0 },
  maxChatIterations: 14,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [...ZAI_CODING_TRANSPORT_DEFERRED],
  harnessDelta: [
    '<model_profile id="zai-coding">',
    "You are running via Z.AI GLM Coding Plan (openai_compatible transport, subscription quota).",
    "This is not the Cursor SDK path, not Fireworks/Together GLM hosting, and not Z.AI general payg.",
    "Use native OpenAI-style function calling as exposed by the coding endpoint. Do not invent tool names.",
    "Greetings and simple conversational questions: answer in plain language with NO tools.",
    "Do not call discovery tools unless the USER asks about agents, org chart, or tool inventory — or @-mentions Agents.",
    "Memory and wiki sections are already retrieved — do not re-probe unless the user needs a full page.",
    "Prefer purposeful tool turns; cap exploratory loops. On tool errors, treat results as data and recover or explain.",
    "GLM Coding Plan: lean tool surface; follow schemas closely.",
    "</model_profile>",
  ].join("\n"),
};

export function resolveZaiCodingHarnessProfile(
  _modelSlug?: string | null
): ModelHarnessProfile {
  return ZAI_CODING_PROFILE;
}

export const GENERIC_LOCAL_PROFILE: ModelHarnessProfile = {
  id: "generic-local",
  label: "Local model",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 24,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: true,
  deferredDiscoveryTools: ["list_subagents"],
  harnessDelta: [
    "<model_profile id=\"generic-local\">",
    "Answer greetings without tools. Only call discovery tools when the USER asks about agents or tools.",
    "</model_profile>",
  ].join("\n"),
};

export const REMOTE_PROFILE: ModelHarnessProfile = {
  id: "remote",
  label: "Shared model",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 24,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: ["list_subagents"],
  harnessDelta: "",
};

const REGISTRY: ModelHarnessProfile[] = [
  GEMMA4_PROFILE,
  CURSOR_AUTO_PROFILE,
  CURSOR_COMPOSER_PROFILE,
  CURSOR_GROK_PROFILE,
  CURSOR_PROFILE,
  OPENAI_PROFILE,
  ANTHROPIC_PROFILE,
  OPENROUTER_DEEPSEEK_PROFILE,
  OPENROUTER_GLM_PROFILE,
  OPENROUTER_NEMOTRON_PROFILE,
  OPENROUTER_MINIMAX_PROFILE,
  OPENROUTER_KIMI_PROFILE,
  OPENROUTER_GENERIC_PROFILE,
  GROQ_LLAMA_PROFILE,
  GROQ_GPT_OSS_PROFILE,
  GROQ_QWEN_PROFILE,
  GROQ_KIMI_PROFILE,
  GROQ_COMPOUND_PROFILE,
  GROQ_GENERIC_PROFILE,
  TOGETHER_LLAMA_PROFILE,
  TOGETHER_GPT_OSS_PROFILE,
  TOGETHER_DEEPSEEK_PROFILE,
  TOGETHER_QWEN_PROFILE,
  TOGETHER_KIMI_PROFILE,
  TOGETHER_MINIMAX_PROFILE,
  TOGETHER_GLM_PROFILE,
  TOGETHER_NEMOTRON_PROFILE,
  TOGETHER_GEMMA_PROFILE,
  TOGETHER_GENERIC_PROFILE,
  FIREWORKS_LLAMA_PROFILE,
  FIREWORKS_GPT_OSS_PROFILE,
  FIREWORKS_DEEPSEEK_PROFILE,
  FIREWORKS_QWEN_PROFILE,
  FIREWORKS_KIMI_PROFILE,
  FIREWORKS_MINIMAX_PROFILE,
  FIREWORKS_GLM_PROFILE,
  FIREWORKS_NEMOTRON_PROFILE,
  FIREWORKS_GEMMA_PROFILE,
  FIREWORKS_GENERIC_PROFILE,
  DEEPSEEK_FLASH_PROFILE,
  DEEPSEEK_PRO_PROFILE,
  DEEPSEEK_GENERIC_PROFILE,
  GOOGLE_AI_FLASH_PROFILE,
  GOOGLE_AI_PRO_PROFILE,
  GOOGLE_AI_GENERIC_PROFILE,
  XAI_GROK_PROFILE,
  XAI_GENERIC_PROFILE,
  ZAI_PAYG_PROFILE,
  MINIMAX_PAYG_PROFILE,
  ZAI_CODING_PROFILE,
  REMOTE_PROFILE,
  GENERIC_LOCAL_PROFILE,
];

function isOpenRouterTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "openrouter") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("openrouter.ai");
}

function isGroqTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "groq") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.groq.com");
}

function isTogetherTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "together") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.together.ai") || base.includes("api.together.xyz");
}

function isFireworksTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "fireworks") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.fireworks.ai");
}

function isDeepSeekTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "deepseek") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.deepseek.com");
}

function isGoogleAiTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "google_ai") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("generativelanguage.googleapis.com");
}

function isXaiTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "xai") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.x.ai");
}

function isZaiPaygTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "zai") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.z.ai/api/paas") && !base.includes("/api/coding/");
}

function isMinimaxTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "minimax") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.minimax.io");
}

function isZaiCodingTransport(input: ResolveProfileInput): boolean {
  if ((input.transport ?? "").toLowerCase() === "zai_coding") return true;
  const base = (input.baseUrl ?? "").toLowerCase();
  return base.includes("api.z.ai/api/coding/");
}

export function getProfileById(id: string): ModelHarnessProfile | null {
  return REGISTRY.find((p) => p.id === id) ?? null;
}

export function listHarnessProfiles(): ModelHarnessProfile[] {
  return [...REGISTRY];
}

function basenameHint(pathOrName: string): string {
  return pathOrName.split(/[/\\]/).pop() ?? pathOrName;
}

/** Match Gemma 4 family GGUFs (26B A4B QAT Q4_0, etc.). */
export function isGemma4Model(pathOrName: string | null | undefined): boolean {
  if (!pathOrName) return false;
  return /gemma[-_]?4/i.test(basenameHint(pathOrName));
}

/** Cursor Auto / empty model id. */
export function isCursorAutoModel(model: string | null | undefined): boolean {
  const id = (model ?? "").trim().toLowerCase();
  return !id || id === "auto";
}

/** Cursor Composer family (composer-2, composer-2.5, composer-2-fast, etc.). */
export function isCursorComposerModel(model: string | null | undefined): boolean {
  if (!model) return false;
  return /composer[-_]?2(\.5)?/i.test(model) || /^composer/i.test(model.trim());
}

/** Grok family via Cursor model list (any grok-* slug). */
export function isCursorGrokModel(model: string | null | undefined): boolean {
  if (!model) return false;
  return /grok/i.test(model);
}

/** Resolve Cursor subscription model id → harness family. */
export function resolveCursorHarnessProfile(
  model: string | null | undefined
): ModelHarnessProfile {
  if (isCursorAutoModel(model)) return CURSOR_AUTO_PROFILE;
  if (isCursorGrokModel(model)) return CURSOR_GROK_PROFILE;
  if (isCursorComposerModel(model)) return CURSOR_COMPOSER_PROFILE;
  return CURSOR_PROFILE;
}

/**
 * Resolve harness profile from catalog selection or active runtime model.
 * Prefer deriving from the live model every chat turn so config cannot drift.
 */
export function resolveHarnessProfile(input: ResolveProfileInput): ModelHarnessProfile {
  if (input.source === "cursor") return resolveCursorHarnessProfile(input.model);
  if (input.source === "remote") return REMOTE_PROFILE;
  if (input.source === "provider") {
    const p = (input.provider ?? "").toLowerCase();
    if (p === "anthropic") return ANTHROPIC_PROFILE;
    if (p === "openai") return OPENAI_PROFILE;
    if (p === "openai_compatible" && isOpenRouterTransport(input)) {
      return resolveOpenRouterHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isGroqTransport(input)) {
      return resolveGroqHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isTogetherTransport(input)) {
      return resolveTogetherHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isFireworksTransport(input)) {
      return resolveFireworksHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isDeepSeekTransport(input)) {
      return resolveDeepSeekHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isGoogleAiTransport(input)) {
      return resolveGoogleAiHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isXaiTransport(input)) {
      return resolveXaiHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isZaiCodingTransport(input)) {
      return resolveZaiCodingHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isZaiPaygTransport(input)) {
      return resolveZaiPaygHarnessProfile(input.model);
    }
    if (p === "openai_compatible" && isMinimaxTransport(input)) {
      return resolveMinimaxPaygHarnessProfile(input.model);
    }
    if (p === "openai_compatible") return OPENAI_PROFILE;
    return OPENAI_PROFILE;
  }
  // local
  const hint = input.path ?? input.model ?? "";
  if (isGemma4Model(hint)) return GEMMA4_PROFILE;
  return GENERIC_LOCAL_PROFILE;
}

/**
 * Derive profile from the live agent + optional running GGUF path.
 * Prefer this every chat turn so stored harnessProfileId cannot drift.
 */
export function resolveProfileForAgent(
  agent: AgentForProfileResolve,
  runningModelPath?: string | null
): ModelHarnessProfile {
  if (agent.backend === "cursor_cloud" || agent.backend === "cursor") {
    return resolveHarnessProfile({
      source: "cursor",
      model: typeof agent.config?.model === "string" ? agent.config.model : null,
    });
  }
  if (agent.backend === "provider") {
    const cfg = agent.config ?? {};
    const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : null;
    let transport: string | null =
      typeof cfg.transport === "string" ? cfg.transport : null;
    if (!transport) {
      if (cfg.openrouter === true || (baseUrl ?? "").toLowerCase().includes("openrouter.ai")) {
        transport = "openrouter";
      } else if (cfg.groq === true || (baseUrl ?? "").toLowerCase().includes("api.groq.com")) {
        transport = "groq";
      } else if (
        cfg.together === true ||
        (baseUrl ?? "").toLowerCase().includes("api.together.ai") ||
        (baseUrl ?? "").toLowerCase().includes("api.together.xyz")
      ) {
        transport = "together";
      } else if (
        cfg.fireworks === true ||
        (baseUrl ?? "").toLowerCase().includes("api.fireworks.ai")
      ) {
        transport = "fireworks";
      } else if (
        cfg.deepseek === true ||
        (baseUrl ?? "").toLowerCase().includes("api.deepseek.com")
      ) {
        transport = "deepseek";
      } else if (
        cfg.googleAi === true ||
        (baseUrl ?? "").toLowerCase().includes("generativelanguage.googleapis.com")
      ) {
        transport = "google_ai";
      } else if (
        cfg.xai === true ||
        (baseUrl ?? "").toLowerCase().includes("api.x.ai")
      ) {
        transport = "xai";
      } else if (
        cfg.zaiCoding === true ||
        (baseUrl ?? "").toLowerCase().includes("api.z.ai/api/coding/")
      ) {
        transport = "zai_coding";
      } else if (
        cfg.zai === true ||
        ((baseUrl ?? "").toLowerCase().includes("api.z.ai/api/paas") &&
          !(baseUrl ?? "").toLowerCase().includes("/api/coding/"))
      ) {
        transport = "zai";
      } else if (
        cfg.minimax === true ||
        (baseUrl ?? "").toLowerCase().includes("api.minimax.io")
      ) {
        transport = "minimax";
      }
    }
    return resolveHarnessProfile({
      source: "provider",
      model: typeof cfg.model === "string" ? cfg.model : null,
      provider: typeof cfg.provider === "string" ? cfg.provider : null,
      transport,
      baseUrl,
    });
  }
  if (agent.backend === "remote") {
    return resolveHarnessProfile({ source: "remote" });
  }
  const path = agent.modelPath ?? runningModelPath ?? "";
  return resolveHarnessProfile({ source: "local", path });
}

/** Apply card sampling trio onto agent sampling without mutating other knobs. */
export function applyProfileSampling<T extends {
  temperature: number;
  topP: number;
  topK: number;
}>(sampling: T, profile: ModelHarnessProfile): T {
  return {
    ...sampling,
    temperature: profile.sampling.temperature,
    topP: profile.sampling.topP,
    topK: profile.sampling.topK,
  };
}

export interface AgentContextForDiscovery {
  userMessage?: string | null;
  pathname?: string | null;
  mentionIds?: string[] | null;
}

/** Whether deferred discovery tools should be offered this turn. */
export function allowDiscoveryTools(
  profile: ModelHarnessProfile,
  ctx: AgentContextForDiscovery
): boolean {
  if (!profile.deferredDiscoveryTools.length) return true;
  const text = (ctx.userMessage ?? "").toLowerCase();
  const path = (ctx.pathname ?? "").toLowerCase();
  const mentions = ctx.mentionIds ?? [];
  if (mentions.some((m) => m.startsWith("agent:") || m === "Agents" || /agent/i.test(m))) {
    return true;
  }
  if (/\/agents|agents-org|org-chart|ai-builder/i.test(path)) return true;
  if (
    /\b(agent|agents|subagent|subagents|org chart|who reports|list (my )?agents)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Soft remember deferral for Gemma: omit `remember` on greetings / simple chat.
 * Discovery tools stay gated by {@link allowDiscoveryTools}; wiki is never deferred.
 */
export function allowRememberTool(
  profile: ModelHarnessProfile,
  ctx: AgentContextForDiscovery
): boolean {
  if (!profile.deferredDiscoveryTools.includes("remember")) return true;
  const text = (ctx.userMessage ?? "").trim();
  if (!text) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yo)\b/i.test(text) && text.length < 40) {
    return false;
  }
  if (
    /\b(remember|don't forget|save this|note that|keep in mind|my (name|preference|email))\b/i.test(
      text
    )
  ) {
    return true;
  }
  // Substantive asks may remember; short chitchat stays deferred.
  return text.length >= 48 || /[.!?]/.test(text);
}

export function filterSchemasForProfile<
  T extends { function: { name: string } },
>(
  schemas: T[],
  profile: ModelHarnessProfile,
  ctx: AgentContextForDiscovery
): T[] {
  if (!profile.deferredDiscoveryTools.length) return schemas;
  const blocked = new Set<string>();
  if (!allowDiscoveryTools(profile, ctx)) {
    for (const name of profile.deferredDiscoveryTools) {
      if (name !== "remember") blocked.add(name);
    }
  }
  if (!allowRememberTool(profile, ctx)) blocked.add("remember");
  if (!blocked.size) return schemas;
  return schemas.filter((s) => !blocked.has(s.function.name));
}

/** Strip Gemma thought channels / redacted blocks from assistant text for history. */
export function stripThinkingChannels(content: string): string {
  let working = content;
  working = working.replace(/<\|channel>thought\n[\s\S]*?<channel\|>/g, "");
  working = working.replace(/<think>[\s\S]*?<\/think>/gi, "");
  working = working.replace(/[\s\S]*?<\/redacted_thinking>/i, "");
  return working.trim();
}
