import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { broadcastCardActivity } from "../ws-broker.js";
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
 * Strip accidental `undefined` string prefixes from template/concat bugs
 * (e.g. `${maybeUndefined}${ask}` when maybeUndefined was unset).
 */
export function sanitizeRunCardUserMessage(userMessage: string): string {
  return userMessage
    .replace(/^\s*undefined(?=[A-Za-z0-9"'(])/i, "")
    .replace(/^\s*undefined\s+/i, "")
    .trim();
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
  tenantId?: string | null;
}): { cardId: string; projectId: string; title: string } {
  const projectId = ensureAgentProject(args.agentId, args.db);
  const cardId = runCardId(args.chatId);
  const cleaned = sanitizeRunCardUserMessage(args.userMessage);
  const preview = cleaned.replace(/\s+/g, " ").slice(0, 120);
  const summary = summarizeRunCardTitle(cleaned);
  const title =
    summary && summary !== "Run"
      ? summary
      : preview
        ? clipTitle(preview, TITLE_MAX)
        : `Run ${args.chatId.slice(0, 8)}`;

  // Card ids are globally unique. Remap project_id if the agent board changed.
  const existing = args.db
    .prepare(`SELECT id, project_id FROM ai_project_cards WHERE id=?`)
    .get(cardId) as { id: string; project_id: string } | undefined;

  const description = [
    "Host Active-work card for this Intelligence chat.",
    `Chat: ${args.chatId}`,
    "",
    "Latest user ask:",
    cleaned.slice(0, 2000) || "(image or empty)",
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
         SET project_id=?, title=?, description=?, column_id=?, status=?, linked_chat_id=?,
             assigned_agent_id=?, context_json=?, updated_at=datetime('now')
         WHERE id=?`
      )
      .run(
        projectId,
        title,
        description,
        "in_progress",
        "working",
        args.chatId,
        args.agentId,
        contextJson,
        cardId
      );
    // Children keep parent_card_id but may still sit on the old board after remap.
    if (existing.project_id !== projectId) {
      args.db
        .prepare(
          `UPDATE ai_project_cards
           SET project_id=?, updated_at=datetime('now')
           WHERE parent_card_id=?`
        )
        .run(projectId, cardId);
    }
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

  broadcastCardActivity(args.tenantId, {
    cardId,
    reason: "active-work-begin",
  });

  return { cardId, projectId, title };
}

/**
 * Model-visible host status for this chat turn (SSE alone is UI-only).
 * Append to the assembled system prompt so agents do not invent a second plan parent.
 */
export function formatActiveWorkHostContext(
  hostCardId: string | null | undefined
): string {
  if (hostCardId?.trim()) {
    return [
      "<active_work_host>",
      `Host-run card id: ${hostCardId.trim()}. todo_write nests under this card automatically.`,
      "Do NOT open a second plan parent with create_project_card or create_subtask for this chat plan.",
      "</active_work_host>",
    ].join("\n");
  }
  return [
    "<active_work_host>",
    "Host-run card unavailable this turn (begin failed). Prefer todo_write as a top-level nested plan.",
    "Do NOT invent a second plan parent with create_project_card or create_subtask, and do not narrate a board glitch.",
    "</active_work_host>",
  ].join("\n");
}

function isTerminalSubtask(columnId: string, status: string | null): boolean {
  return (
    columnId === "done" ||
    status === "accepted" ||
    status === "done" ||
    status === "cancelled"
  );
}

/**
 * Finish the host Active-work run card after a successful chat turn:
 * close open todo subtasks, move the parent to Done, and append activity.
 */
export function completeActiveWorkRunCard(args: {
  db: AppDatabase;
  cardId: string;
  tenantId?: string | null;
  outcome: "success" | "error" | "aborted";
  summary?: string;
}): boolean {
  const parent = args.db
    .prepare(
      `SELECT id, column_id, status, context_json FROM ai_project_cards WHERE id = ?`
    )
    .get(args.cardId) as
    | {
        id: string;
        column_id: string;
        status: string | null;
        context_json: string | null;
      }
    | undefined;
  if (!parent) return false;

  let isHostRun = false;
  try {
    const ctx = parent.context_json ? JSON.parse(parent.context_json) : null;
    isHostRun = Boolean(ctx && typeof ctx === "object" && ctx.__activeWorkRun);
  } catch {
    isHostRun = false;
  }
  if (!isHostRun) return false;

  if (args.outcome !== "success") {
    const body =
      args.summary?.trim() ||
      (args.outcome === "aborted"
        ? "Chat turn stopped before completion."
        : "Chat turn failed.");
    args.db
      .prepare(
        `INSERT INTO ai_card_comments (id, card_id, author, body, kind)
         VALUES (?, ?, 'system', ?, ?)`
      )
      .run(uuidv4(), args.cardId, body, "issue");
    broadcastCardActivity(args.tenantId, {
      cardId: args.cardId,
      reason: "active-work-incomplete",
    });
    return true;
  }

  const subtasks = args.db
    .prepare(
      `SELECT id, column_id, status FROM ai_project_cards WHERE parent_card_id = ?`
    )
    .all(args.cardId) as Array<{
    id: string;
    column_id: string;
    status: string | null;
  }>;

  for (const sub of subtasks) {
    if (isTerminalSubtask(sub.column_id, sub.status)) continue;
    args.db
      .prepare(
        `UPDATE ai_project_cards
         SET column_id = 'done', status = 'accepted', updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(sub.id);
  }

  args.db
    .prepare(
      `UPDATE ai_project_cards
       SET column_id = 'done', status = 'accepted', updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(args.cardId);

  const body =
    args.summary?.trim() ||
    (subtasks.length > 0
      ? `Chat turn finished. Closed ${subtasks.length} linked task${subtasks.length === 1 ? "" : "s"}.`
      : "Chat turn finished.");
  args.db
    .prepare(
      `INSERT INTO ai_card_comments (id, card_id, author, body, kind)
       VALUES (?, ?, 'system', ?, ?)`
    )
    .run(uuidv4(), args.cardId, body, "result");

  broadcastCardActivity(args.tenantId, {
    cardId: args.cardId,
    reason: "active-work-complete",
  });
  return true;
}
