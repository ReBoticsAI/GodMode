import type { AppDatabase } from "../db.js";
import { ensureAgentProject } from "./user-productivity.js";
import { summarizeRunCardTitle } from "./run-card-title.js";

function runCardId(chatId: string): string {
  return `run_${chatId}`;
}

const TITLE_MAX = 72;

function clipTitle(text: string, max = TITLE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  const base = (at > 24 ? cut.slice(0, at) : cut).trim();
  return `${base}…`;
}

/**
 * Upsert the host Active-work run card for this chat with a short title.
 * Returns the parent card id so todo_write can nest under it.
 */
export function beginActiveWorkRunCard(args: {
  db: AppDatabase;
  agentId: string;
  chatId: string;
  userMessage: string;
}): { cardId: string; projectId: string; title: string } {
  const projectId = ensureAgentProject(args.agentId, args.db);
  const cardId = runCardId(args.chatId);
  const preview = args.userMessage.trim().replace(/\s+/g, " ").slice(0, 120);
  const summary = summarizeRunCardTitle(args.userMessage);
  const title =
    summary && summary !== "Run"
      ? summary
      : preview
        ? clipTitle(preview, TITLE_MAX)
        : `Run ${args.chatId.slice(0, 8)}`;

  const existing = args.db
    .prepare(`SELECT id FROM ai_project_cards WHERE id=? AND project_id=?`)
    .get(cardId, projectId) as { id: string } | undefined;

  const description = [
    "Host Active-work card for this Intelligence chat.",
    `Chat: ${args.chatId}`,
    "",
    "Latest user ask:",
    args.userMessage.trim().slice(0, 2000) || "(image or empty)",
  ].join("\n");

  const contextJson = JSON.stringify({
    __activeWorkRun: true,
    chatId: args.chatId,
    agentId: args.agentId,
  });

  if (existing) {
    args.db
      .prepare(
        `UPDATE ai_project_cards
         SET title=?, description=?, column_id=?, status=?, linked_chat_id=?,
             assigned_agent_id=?, context_json=?, updated_at=datetime('now')
         WHERE id=? AND project_id=?`
      )
      .run(
        title,
        description,
        "in_progress",
        "working",
        args.chatId,
        args.agentId,
        contextJson,
        cardId,
        projectId
      );
  } else {
    const order = (
      args.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS value
           FROM ai_project_cards WHERE project_id=? AND column_id=?`
        )
        .get(projectId, "in_progress") as { value: number }
    ).value;
    args.db
      .prepare(
        `INSERT INTO ai_project_cards
         (id, project_id, column_id, title, description, context_json,
          linked_chat_id, priority, parent_card_id, status, assigned_agent_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, 2, NULL, ?, ?, ?)`
      )
      .run(
        cardId,
        projectId,
        "in_progress",
        title,
        description,
        contextJson,
        args.chatId,
        "working",
        args.agentId,
        order + 1
      );
  }

  return { cardId, projectId, title };
}
