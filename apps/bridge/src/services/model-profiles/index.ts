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

export const OPENAI_PROFILE: ModelHarnessProfile = {
  id: "openai",
  label: "OpenAI",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 32,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [],
  harnessDelta: "",
};

export const ANTHROPIC_PROFILE: ModelHarnessProfile = {
  id: "anthropic",
  label: "Anthropic",
  toolMode: "native",
  sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
  maxChatIterations: 32,
  enableThinkingDefault: false,
  stripThinkingFromHistory: true,
  requireJinja: false,
  deferredDiscoveryTools: [],
  harnessDelta: "",
};

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
  REMOTE_PROFILE,
  GENERIC_LOCAL_PROFILE,
];

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
    return resolveHarnessProfile({
      source: "provider",
      model: typeof agent.config?.model === "string" ? agent.config.model : null,
      provider:
        typeof agent.config?.provider === "string" ? agent.config.provider : null,
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
