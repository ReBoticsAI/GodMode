import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import type { LlmManager } from "./llm-manager.js";
import { getAgent } from "./agents/agents-db.js";
import { indexMemory } from "./embeddings/memory-embeddings.js";
import type { EmbeddingClient } from "./embeddings/embedding-client.js";

const MIN_USER_TURNS = 2;
const MAX_TURNS = 40;

export interface EpisodicDistillResult {
  ok: boolean;
  skipped?: string;
  memoryIds?: string[];
  titleHint?: string;
}

/**
 * Distill recent chat turns into 1–3 episode memories (category=episode, source=distill).
 * Default status is pending unless the agent config sets episodicDistillAuto=true.
 */
export async function runEpisodicDistill(opts: {
  db: AppDatabase;
  llm: LlmManager;
  chatId: string;
  agentId: string;
  embedder?: EmbeddingClient | null;
  force?: boolean;
}): Promise<EpisodicDistillResult> {
  const { db, llm, chatId, agentId } = opts;
  if (!llm.isReady()) return { ok: false, skipped: "llm_not_ready" };

  const chat = db
    .prepare(`SELECT id, title, distilled_at, distill_msg_count FROM ai_chats WHERE id = ?`)
    .get(chatId) as
    | {
        id: string;
        title: string;
        distilled_at: string | null;
        distill_msg_count: number | null;
      }
    | undefined;
  if (!chat) return { ok: false, skipped: "chat_not_found" };

  const msgCountRow = db
    .prepare(`SELECT COUNT(*) AS n FROM ai_messages WHERE chat_id = ?`)
    .get(chatId) as { n: number };
  const msgCount = msgCountRow?.n ?? 0;
  if (!opts.force && chat.distill_msg_count != null && chat.distill_msg_count >= msgCount) {
    return { ok: false, skipped: "already_distilled" };
  }

  const turns = db
    .prepare(
      `SELECT role, content_json FROM ai_messages
       WHERE chat_id = ? AND role IN ('user', 'assistant')
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(chatId, MAX_TURNS) as Array<{ role: string; content_json: string }>;

  const chronological = turns.reverse();
  const userTurns = chronological.filter((t) => t.role === "user").length;
  if (userTurns < MIN_USER_TURNS) {
    return { ok: false, skipped: "too_short" };
  }

  const transcript = chronological
    .map((t) => {
      let text = "";
      try {
        const parsed = JSON.parse(t.content_json) as { text?: string; content?: string };
        text = String(parsed.text ?? parsed.content ?? t.content_json);
      } catch {
        text = t.content_json;
      }
      return `${t.role === "user" ? "User" : "Assistant"}: ${text.slice(0, 1200)}`;
    })
    .join("\n")
    .slice(0, 12_000);

  const prompt = [
    "Summarize this chat into durable episodic memory for a personal AI assistant.",
    "Return JSON only: {\"bullets\":[\"...\"],\"openLoops\":[\"...\"],\"titleHint\":\"optional one-line title\"}",
    "bullets: 1–3 durable facts/outcomes (not greetings).",
    "openLoops: 0–2 unfinished threads (ephemeral).",
    "Skip if nothing worth remembering — use empty arrays.",
    "",
    "CHAT:",
    transcript,
  ].join("\n");

  let parsed: { bullets?: string[]; openLoops?: string[]; titleHint?: string };
  try {
    const sampling = llm.getSamplingParams(db);
    const res = await fetch(`${llm.getServerBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        messages: [
          {
            role: "system",
            content:
              "You extract episodic memories. Reply with JSON only. No markdown fences.",
          },
          { role: "user", content: prompt },
        ],
        stream: false,
        temperature: 0.2,
        top_p: sampling.topP,
        max_tokens: 800,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    parsed = JSON.parse(extractJson(raw)) as typeof parsed;
  } catch (err) {
    return {
      ok: false,
      skipped: `llm_parse:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const agent = getAgent(db, agentId);
  const auto =
    Boolean((agent?.config as { episodicDistillAuto?: boolean } | null)?.episodicDistillAuto) ||
    readAutoSetting(db);
  const status = auto ? "active" : "pending";

  const memoryIds: string[] = [];
  const bullets = (parsed.bullets ?? []).map((b) => String(b).trim()).filter(Boolean).slice(0, 3);
  const openLoops = (parsed.openLoops ?? [])
    .map((b) => String(b).trim())
    .filter(Boolean)
    .slice(0, 2);

  for (const text of bullets) {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO ai_memories
         (id, scope, chat_id, agent_id, text, category, source, status, enabled)
       VALUES (?, 'global', ?, ?, ?, 'episode', 'distill', ?, 1)`
    ).run(id, chatId, agentId, text, status);
    if (status === "active") indexMemory(db, opts.embedder, id, text);
    memoryIds.push(id);
  }

  for (const text of openLoops) {
    const id = uuidv4();
    // Open loops expire in ~14 days.
    db.prepare(
      `INSERT INTO ai_memories
         (id, scope, chat_id, agent_id, text, category, source, status, enabled, valid_until)
       VALUES (?, 'chat', ?, ?, ?, 'episode', 'distill', ?, 1,
               datetime('now', '+14 days'))`
    ).run(id, chatId, agentId, `Open loop: ${text}`, status);
    if (status === "active") indexMemory(db, opts.embedder, id, `Open loop: ${text}`);
    memoryIds.push(id);
  }

  db.prepare(
    `UPDATE ai_chats SET distilled_at = datetime('now'), distill_msg_count = ? WHERE id = ?`
  ).run(msgCount, chatId);

  const titleHint = parsed.titleHint?.trim();
  if (titleHint && (!chat.title || chat.title === "New chat")) {
    db.prepare(`UPDATE ai_chats SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(
      titleHint.slice(0, 80),
      chatId
    );
  }

  return { ok: true, memoryIds, titleHint };
}

function readAutoSetting(db: AppDatabase): boolean {
  try {
    const row = db
      .prepare(`SELECT value FROM ai_settings WHERE key = ?`)
      .get("episodicDistillAuto") as { value: string } | undefined;
    return row?.value === "true" || row?.value === "1";
  } catch {
    return false;
  }
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
