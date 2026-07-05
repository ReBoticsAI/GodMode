import type { EventEmitter } from "node:events";
import type { AppDatabase } from "../db.js";
import { runAgentChat } from "./ai-agent.js";
import { resolveAgent } from "./agents/registry.js";
import type { LlmManager } from "./llm-manager.js";
import {
  getReflectionConfig,
  patchReflectionConfig,
  type ReflectionTrigger,
} from "./reflection-config.js";
import {
  executeReflectionTool,
  getReflectionToolSchemas,
  REFLECTION_TOOL_NAMES,
} from "./reflection-tools.js";
import { isUserAgentId } from "./agents/user-agent-prompt.js";

export interface ReflectionRunDeps {
  db: AppDatabase;
  llm: LlmManager;
  bus?: EventEmitter;
}

export interface ReflectionRunResult {
  ok: boolean;
  agentId: string;
  trigger: ReflectionTrigger;
  summary: string;
  error?: string;
}

function assembleReflectionBrief(db: AppDatabase, agentId: string, watermark: string): string {
  const chats = db
    .prepare(
      `SELECT id, title, updated_at FROM ai_chats
       WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 15`
    )
    .all(watermark) as Array<{ id: string; title: string; updated_at: string }>;

  const cards = db
    .prepare(
      `SELECT c.id, c.title, c.column_id, c.updated_at FROM ai_project_cards c
       JOIN ai_projects p ON p.id = c.project_id
       WHERE p.agent_id = ? AND c.updated_at > ?
       ORDER BY c.updated_at DESC LIMIT 15`
    )
    .all(agentId, watermark) as Array<{
    id: string;
    title: string;
    column_id: string;
    updated_at: string;
  }>;

  const lines = [
    `Agent: ${agentId}`,
    `Activity since watermark: ${watermark}`,
    "",
    "Recent chats:",
    chats.length
      ? chats.map((c) => `- ${c.id}: ${c.title} (${c.updated_at})`).join("\n")
      : "(none)",
    "",
    "Recent project cards:",
    cards.length
      ? cards
          .map((c) => `- ${c.id}: ${c.title} [${c.column_id}] (${c.updated_at})`)
          .join("\n")
      : "(none)",
    "",
    "Use tools to read transcripts, inspect current knowledge, and propose CRUD changes.",
    "Be conservative: avoid duplicates, over-broad rules, and one-off memories.",
  ];
  return lines.join("\n");
}

export async function runReflection(
  deps: ReflectionRunDeps,
  agentId: string,
  trigger: ReflectionTrigger
): Promise<ReflectionRunResult> {
  const { db, llm, bus } = deps;
  const config = getReflectionConfig(db, agentId);
  if (!config.enabled && trigger !== "manual") {
    return {
      ok: false,
      agentId,
      trigger,
      summary: "",
      error: "Reflection disabled for this agent",
    };
  }

  if (!llm.isReady()) {
    return {
      ok: false,
      agentId,
      trigger,
      summary: "",
      error: "Main LLM server not running",
    };
  }

  const agent = resolveAgent(db, agentId);
  const watermark = config.watermark ?? "1970-01-01 00:00:00";
  const brief = assembleReflectionBrief(db, agentId, watermark);

  const systemExtra = isUserAgentId(agentId)
    ? [
        "You are running a REFLECTION pass for this user's persona agent.",
        "Review recent chats and extract durable facts about the user: preferences, goals, values, communication style, and personal context.",
        "Use propose_user_profile_update for profile fields and propose_user_memory for free-form personal context.",
        "Be conservative — only propose high-confidence facts.",
        config.mode === "approval"
          ? "All changes are staged for user approval."
          : "Changes apply immediately — still be conservative.",
      ].join("\n")
    : [
        "You are running a REFLECTION pass for this agent.",
        "Review recent activity and decide whether to create, update, or delete Rules, Memories, Skills, Artifacts, or Workflows.",
        "Use the provided tools only. Do not invent ids — read knowledge first.",
        config.mode === "approval"
          ? "Changes are staged for user approval unless they are new pending drafts."
          : "Changes apply immediately — still be conservative.",
      ].join("\n");

  try {
    const answer = await runAgentChat({
      baseUrl: llm.getServerBaseUrl(),
      messages: [
        {
          role: "system",
          content: `${agent.systemPrompt}\n\n${systemExtra}`,
        },
        { role: "user", content: brief },
      ],
      sampling: {
        temperature: 0.3,
        topP: agent.sampling.topP,
        topK: agent.sampling.topK,
        minP: agent.sampling.minP,
        repeatPenalty: agent.sampling.repeatPenalty,
        presencePenalty: agent.sampling.presencePenalty,
        frequencyPenalty: agent.sampling.frequencyPenalty,
        maxTokens: Math.max(agent.sampling.maxTokens, 2048),
        seed: agent.sampling.seed,
      },
      nativeTools: true,
      maxIterations: 16,
      tools: getReflectionToolSchemas(),
      toolExecutor: executeReflectionTool,
      requiresConfirmation: () => false,
      toolCtx: {
        db,
        llm,
        activeAgentId: agentId,
        reflectionMode: config.mode,
        reflectionWatermark: watermark,
      },
    });

    const summary = answer.trim().slice(0, 2000) || "Reflection completed.";
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    patchReflectionConfig(db, agentId, {
      lastRunAt: now,
      lastSummary: summary,
      watermark: now,
    });

    try {
      bus?.emit("ai_notification", {
        kind: "reflection_complete",
        agentId,
        trigger,
        message: summary.slice(0, 280),
        at: new Date().toISOString(),
      });
    } catch {
      /* optional */
    }

    return { ok: true, agentId, trigger, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, agentId, trigger, summary: "", error: message };
  }
}

export { REFLECTION_TOOL_NAMES };
