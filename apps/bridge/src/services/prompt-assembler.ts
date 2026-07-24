import type { AppDatabase } from "../db.js";
import type { PlatformContext } from "../types/platform-context.js";
import { getActiveRulesText, departmentIdForAgent } from "./ai-rules.js";
import { getSkillsIndexText } from "./ai-skills.js";
import { getToolSchemasForLlm, getToolsIndexText } from "./ai-tools-registry.js";
import { getContextProfile, renderContextProfile } from "./engines/context.js";
import { type EmbeddingClient } from "./embeddings/embedding-client.js";
import { getHybridMemoriesText } from "./vector-rag.js";
import { getAgent } from "./agents/agents-db.js";
import type { AiAgent } from "./agents/types.js";
import { assembleAgentProfileSection } from "./agents/agent-profile-prompt.js";
import { assembleUserContextSection } from "./agents/user-context-prompt.js";
import {
  getHarnessEarlyBlock,
  getHarnessLateBlockForAgent,
  HARNESS_VERSION,
} from "./harness-prompt.js";
import type { IntelligenceChatMode } from "./chat-mode.js";
import { agentCodeAccess } from "./agents/agents-db.js";
import { config } from "../config.js";
import { grammarToolsIndexText } from "./tool-grammar.js";

export type PromptSectionId =
  | "profile"
  | "user"
  | "base"
  | "rules"
  | "memory"
  | "wiki"
  | "skills"
  | "capabilities"
  | "tools"
  | "platform"
  | "mentions"
  | "chatHistory"
  | "userMessage"
  | "final";

export interface PromptFlowSectionConfig {
  id: PromptSectionId;
  enabled: boolean;
  order: number;
}

/** Bump when default section orders change; load migrates stored configs. */
export const PROMPT_FLOW_VERSION = 3;

export interface PromptFlowConfig {
  /** Cursor-parity section order version. Missing/older values are migrated on load. */
  promptFlowVersion?: number;
  sections: PromptFlowSectionConfig[];
  positions?: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface AssembledSection {
  id: PromptSectionId;
  label: string;
  enabled: boolean;
  included: boolean;
  preview: string;
  charCount: number;
  /** Sections merged into the system message. */
  inSystemPrompt: boolean;
}

export interface AssembleResult {
  systemPrompt: string;
  sections: AssembledSection[];
  omitted: string[];
  estimatedChars: number;
}

const SECTION_LABELS: Record<PromptSectionId, string> = {
  profile: "Agent Profile",
  user: "User Context",
  base: "Base Prompt",
  rules: "Rules",
  memory: "Memory",
  wiki: "Wiki",
  skills: "Skills Index",
  capabilities: "Capabilities (RAG)",
  tools: "Tools Available",
  platform: "Page Context",
  mentions: "@ Mentions",
  chatHistory: "Chat History",
  userMessage: "User Message",
  final: "Final LLM Request",
};

/**
 * Cursor-shaped default order (#71):
 * identity → environment → rules/skills → GodMode RAG → tools → …
 * Early/late harness are injected by assemblePrompt, not listed as sections.
 */
export const DEFAULT_FLOW_SECTIONS: PromptFlowSectionConfig[] = [
  { id: "profile", enabled: true, order: 0 },
  { id: "user", enabled: true, order: 1 },
  { id: "base", enabled: true, order: 2 },
  { id: "platform", enabled: true, order: 3 },
  { id: "rules", enabled: true, order: 4 },
  { id: "skills", enabled: true, order: 5 },
  { id: "memory", enabled: true, order: 6 },
  { id: "wiki", enabled: true, order: 7 },
  { id: "capabilities", enabled: true, order: 8 },
  { id: "tools", enabled: true, order: 9 },
  { id: "mentions", enabled: true, order: 10 },
  { id: "chatHistory", enabled: true, order: 11 },
  { id: "userMessage", enabled: true, order: 12 },
  { id: "final", enabled: true, order: 13 },
];

/** System-prompt emission order (Cursor cognitive shape). */
const CURSOR_SYSTEM_ORDER: PromptSectionId[] = [
  "profile",
  "user",
  "base",
  "platform",
  "rules",
  "skills",
  "memory",
  "wiki",
  "capabilities",
  "tools",
  "mentions",
];

const GODMODE_WRAP: Partial<Record<PromptSectionId, { open: string; close: string }>> =
  {
    user: { open: "<godmode_user>", close: "</godmode_user>" },
    memory: { open: "<godmode_memory>", close: "</godmode_memory>" },
    wiki: { open: "<godmode_wiki>", close: "</godmode_wiki>" },
    capabilities: {
      open: "<godmode_capabilities>",
      close: "</godmode_capabilities>",
    },
  };

const SYSTEM_SECTION_IDS = new Set<PromptSectionId>(CURSOR_SYSTEM_ORDER);

function wrapGodModeSection(id: PromptSectionId, body: string): string {
  const wrap = GODMODE_WRAP[id];
  if (!wrap || !body.trim()) return body;
  return `${wrap.open}\n${body}\n${wrap.close}`;
}

export function getDefaultPromptFlowConfig(): PromptFlowConfig {
  return {
    promptFlowVersion: PROMPT_FLOW_VERSION,
    sections: DEFAULT_FLOW_SECTIONS.map((s) => ({ ...s })),
  };
}

/**
 * Re-apply default orders when promptFlowVersion is stale; preserve enabled flags
 * and UI positions/viewport.
 */
export function migratePromptFlowConfig(config: PromptFlowConfig): PromptFlowConfig {
  const version = config.promptFlowVersion ?? 0;
  const byId = new Map(config.sections.map((s) => [s.id, s]));
  const needsOrderMigration = version < PROMPT_FLOW_VERSION;

  const sections: PromptFlowSectionConfig[] = DEFAULT_FLOW_SECTIONS.map((def) => {
    const existing = byId.get(def.id);
    return {
      id: def.id,
      enabled: existing?.enabled ?? def.enabled,
      order: needsOrderMigration ? def.order : (existing?.order ?? def.order),
    };
  });

  for (const def of DEFAULT_FLOW_SECTIONS) {
    byId.delete(def.id);
  }
  // Drop unknown legacy ids; known defaults already merged above.

  return {
    ...config,
    promptFlowVersion: PROMPT_FLOW_VERSION,
    sections: sections.sort((a, b) => a.order - b.order),
  };
}

export function loadPromptFlowConfig(db: AppDatabase): PromptFlowConfig {
  const row = db
    .prepare(`SELECT config_json FROM ai_prompt_flow WHERE id = 'default'`)
    .get() as { config_json: string } | undefined;
  if (!row) return getDefaultPromptFlowConfig();
  try {
    const parsed = JSON.parse(row.config_json) as PromptFlowConfig;
    if (!parsed.sections?.length) return getDefaultPromptFlowConfig();
    const priorVersion = parsed.promptFlowVersion ?? 0;
    const migrated = migratePromptFlowConfig(parsed);
    if (priorVersion < PROMPT_FLOW_VERSION) {
      savePromptFlowConfig(db, migrated);
    }
    return migrated;
  } catch {
    return getDefaultPromptFlowConfig();
  }
}

export function savePromptFlowConfig(db: AppDatabase, flow: PromptFlowConfig): void {
  const toSave: PromptFlowConfig = {
    ...flow,
    promptFlowVersion: flow.promptFlowVersion ?? PROMPT_FLOW_VERSION,
  };
  db.prepare(
    `INSERT INTO ai_prompt_flow (id, config_json, updated_at)
     VALUES ('default', ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`
  ).run(JSON.stringify(toSave));
}

const DEFAULT_AGENT_ID = "intelligence";

function getMemoriesText(
  db: AppDatabase,
  chatId?: string,
  agentId: string = DEFAULT_AGENT_ID
): string {
  // Backward compat: rows created before agent scoping have agent_id NULL and
  // belong to the root 'intelligence' agent.
  const agentClause =
    agentId === DEFAULT_AGENT_ID
      ? `(agent_id = ? OR agent_id IS NULL)`
      : `agent_id = ?`;
  const global = db
    .prepare(
      `SELECT text FROM ai_memories WHERE scope = 'global' AND enabled = 1 AND status = 'active' AND ${agentClause} ORDER BY updated_at DESC LIMIT 50`
    )
    .all(agentId) as Array<{ text: string }>;
  const chat =
    chatId != null
      ? (db
          .prepare(
            `SELECT text FROM ai_memories WHERE scope = 'chat' AND chat_id = ? AND enabled = 1 AND status = 'active' AND ${agentClause} ORDER BY updated_at DESC LIMIT 20`
          )
          .all(chatId, agentId) as Array<{ text: string }>)
      : [];
  const all = [...global, ...chat];
  if (all.length === 0) return "";
  return (
    "--- What you remember about the user ---\n" +
    all.map((m) => `- ${m.text}`).join("\n")
  );
}

/**
 * Semantic (RAG) memory retrieval: embeds the live query and returns the
 * cosine top-K active memories for the agent. Falls back to the recency-based
 * {@link getMemoriesText} when the embedder is unavailable, the query is empty,
 * or no stored memory has an embedding yet — so chat never depends on the
 * embedding engine being up.
 */
export async function getSemanticMemoriesText(
  db: AppDatabase,
  embedder: EmbeddingClient | undefined,
  query: string,
  opts: { chatId?: string; agentId?: string; topK?: number } = {}
): Promise<string> {
  return getHybridMemoriesText(db, embedder, query, opts);
}

function renderPlatform(ctx: PlatformContext | undefined): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (ctx.breadcrumb?.length) {
    lines.push(`Current location: ${ctx.breadcrumb.join(" > ")}`);
  }
  if (ctx.pathname) lines.push(`Route: ${ctx.pathname}`);
  if (ctx.pageKind) lines.push(`Page type: ${ctx.pageKind}`);
  if (ctx.pageLabel) lines.push(`Page: ${ctx.pageLabel}`);
  if (ctx.gitSnapshot?.summary) {
    lines.push(`Git: ${ctx.gitSnapshot.summary}`);
  }
  if (ctx.pageSnapshot) {
    lines.push("\n--- Current page data ---");
    lines.push(JSON.stringify(ctx.pageSnapshot, null, 2));
  }
  return lines.length ? lines.join("\n") : "";
}

/** Compact department context profile for a `dept-<id>` agent, else "". */
function renderDeptContextProfile(db: AppDatabase, agentId: string): string {
  const departmentId = departmentIdForAgent(agentId);
  if (!departmentId) return "";
  const profile = getContextProfile(db, "department", departmentId);
  if (!profile) return "";
  return renderContextProfile(profile);
}

function renderMentions(ctx: PlatformContext | undefined): string {
  if (!ctx?.mentionedSources?.length) return "";
  const lines: string[] = [];
  for (const src of ctx.mentionedSources) {
    lines.push(`\n--- @${src.label} ---`);
    lines.push(JSON.stringify(src.data, null, 2));
  }
  return lines.join("\n");
}

function sectionBody(
  id: PromptSectionId,
  db: AppDatabase,
  basePrompt: string,
  ctx: PlatformContext | undefined,
  chatId?: string,
  historyCount?: number,
  userPreview?: string,
  nativeTools?: boolean,
  agentId: string = DEFAULT_AGENT_ID,
  agent?: AiAgent | null,
  tenantId?: string,
  capabilitiesOverride?: string
): string {
  switch (id) {
    case "profile":
      return agent ? assembleAgentProfileSection(db, agent) : "";
    case "user":
      return agent ? assembleUserContextSection(tenantId, agent) : "";
    case "base":
      return basePrompt;
    case "rules":
      return getActiveRulesText(db, ctx?.pathname, agentId);
    case "memory":
      return getMemoriesText(db, chatId, agentId);
    case "wiki":
      return "";
    case "skills":
      return getSkillsIndexText(db, agentId);
    case "capabilities":
      return capabilitiesOverride ?? "";
    case "tools":
      if (capabilitiesOverride?.trim()) {
        return "(tools passed natively via API — see capabilities section above)";
      }
      if (nativeTools && config.ai.defaultToolMode === "grammar") {
        return grammarToolsIndexText(getToolSchemasForLlm(db, agentId));
      }
      if (nativeTools) {
        return "(tools passed natively via API — not duplicated in system prompt)";
      }
      return getToolsIndexText(db, agentId);
    case "platform": {
      const parts = [renderPlatform(ctx), renderDeptContextProfile(db, agentId)];
      return parts.filter(Boolean).join("\n\n");
    }
    case "mentions":
      return renderMentions(ctx);
    case "chatHistory":
      return historyCount != null && historyCount > 0
        ? `(${historyCount} prior message(s) sent as separate user/assistant turns)`
        : "(no prior messages)";
    case "userMessage":
      return userPreview?.trim() || "(current user turn)";
    case "final":
      return "(assembled below)";
    default:
      return "";
  }
}

export function assemblePrompt(
  db: AppDatabase,
  opts: {
    basePrompt: string;
    platformContext?: PlatformContext;
    chatId?: string;
    historyCount?: number;
    userPreview?: string;
    flowConfig?: PromptFlowConfig;
    enableThinking?: boolean;
    thinkingEfficiency?: "normal" | "low";
    nativeTools?: boolean;
    agentId?: string;
    tenantId?: string;
    agent?: AiAgent | null;
    /**
     * Pre-computed memory section (e.g. semantic top-K from the embedding
     * engine). When provided it replaces the default recency-based memory
     * body; when omitted the synchronous recency path is used.
     */
    memoryOverride?: string;
    /** Pre-computed wiki hybrid snippets for the prompt. */
    wikiOverride?: string;
    capabilitiesOverride?: string;
    chatMode?: IntelligenceChatMode;
    /** Model harness profile delta appended after the late harness. */
    harnessDelta?: string;
  }
): AssembleResult {
  const flow = migratePromptFlowConfig(
    opts.flowConfig ?? loadPromptFlowConfig(db)
  );
  const ordered = [...flow.sections].sort((a, b) => a.order - b.order);
  const enabledById = new Map(flow.sections.map((s) => [s.id, s.enabled]));
  const nativeTools = opts.nativeTools ?? false;
  const agentId = opts.agentId ?? DEFAULT_AGENT_ID;
  const agent = opts.agent !== undefined ? opts.agent : getAgent(db, agentId);

  const bodyById = new Map<PromptSectionId, string>();
  const sections: AssembledSection[] = [];
  const omitted: string[] = [];

  for (const sec of ordered) {
    if (!sec.enabled) {
      sections.push({
        id: sec.id,
        label: SECTION_LABELS[sec.id],
        enabled: false,
        included: false,
        preview: "(disabled)",
        charCount: 0,
        inSystemPrompt: SYSTEM_SECTION_IDS.has(sec.id),
      });
      continue;
    }

    const body =
      sec.id === "memory" && opts.memoryOverride != null
        ? opts.memoryOverride
        : sec.id === "wiki" && opts.wikiOverride != null
          ? opts.wikiOverride
          : sec.id === "capabilities" && opts.capabilitiesOverride != null
            ? opts.capabilitiesOverride
            : sectionBody(
                sec.id,
                db,
                opts.basePrompt,
                opts.platformContext,
                opts.chatId,
                opts.historyCount,
                opts.userPreview,
                nativeTools,
                agentId,
                agent,
                opts.tenantId,
                opts.capabilitiesOverride
              );
    bodyById.set(sec.id, body);

    const inSystem = SYSTEM_SECTION_IDS.has(sec.id);
    const hasContent =
      body.trim().length > 0 &&
      !body.startsWith("(tools passed natively");
    const included = hasContent || sec.id === "base";

    if (inSystem && !hasContent && sec.id !== "base") {
      omitted.push(sec.id);
    }

    if (sec.id === "final") {
      sections.push({
        id: sec.id,
        label: SECTION_LABELS[sec.id],
        enabled: sec.enabled,
        included: sec.enabled,
        preview: "(see assembled system prompt)",
        charCount: 0,
        inSystemPrompt: false,
      });
      continue;
    }

    const preview =
      body.length > 400 ? `${body.slice(0, 400)}…` : body || "(empty)";
    sections.push({
      id: sec.id,
      label: SECTION_LABELS[sec.id],
      enabled: sec.enabled,
      included,
      preview,
      charCount: body.length,
      inSystemPrompt: inSystem,
    });
  }

  const systemParts: string[] = [];
  let earlyInserted = false;

  const insertEarly = () => {
    if (earlyInserted) return;
    systemParts.push(getHarnessEarlyBlock("GodMode"));
    earlyInserted = true;
  };

  for (const id of CURSOR_SYSTEM_ORDER) {
    const enabled = enabledById.get(id) ?? true;
    if (!enabled) {
      // Still place early harness before environment/rules even if identity sections off.
      if (id === "platform" || id === "rules") insertEarly();
      continue;
    }

    let body = bodyById.get(id) ?? "";
    if (id === "base" && !body.trim()) {
      body = opts.basePrompt;
    }
    const hasContent =
      body.trim().length > 0 &&
      !body.startsWith("(tools passed natively");
    if (!hasContent && id !== "base") {
      if (id === "platform" || id === "rules") insertEarly();
      continue;
    }
    if (id === "base" && !body.trim()) {
      insertEarly();
      continue;
    }

    systemParts.push(wrapGodModeSection(id, body));

    if (id === "base") {
      insertEarly();
    }
  }

  insertEarly();

  const codeAccess = agent ? agentCodeAccess(agent) : false;
  let late = getHarnessLateBlockForAgent(codeAccess, opts.chatMode);
  const harnessDelta = opts.harnessDelta?.trim();
  if (harnessDelta) late = `${late}\n\n${harnessDelta}`;
  systemParts.push(late);
  systemParts.push(`<!-- harness:${HARNESS_VERSION} -->`);

  let systemPrompt = systemParts.filter(Boolean).join("\n\n");

  if (opts.enableThinking) {
    const thinkPrefix = "<|think|>\n";
    const efficiencyNote =
      opts.thinkingEfficiency === "low"
        ? "\nThink efficiently and keep internal reasoning concise."
        : "";
    systemPrompt = thinkPrefix + systemPrompt + efficiencyNote;
  }

  const finalSec = sections.find((s) => s.id === "final");
  if (finalSec) {
    finalSec.preview =
      systemPrompt.length > 500
        ? `${systemPrompt.slice(0, 500)}…`
        : systemPrompt;
    finalSec.charCount = systemPrompt.length;
  }

  return {
    systemPrompt,
    sections,
    omitted,
    estimatedChars: systemPrompt.length,
  };
}
