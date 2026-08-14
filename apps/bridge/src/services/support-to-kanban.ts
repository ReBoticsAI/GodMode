/**
 * Promote a Support ticket into Kanban work for the release/fix loop (#445).
 */
import type { AppDatabase } from "../db.js";
import type { CoreDatabase } from "../core-db.js";
import { getTicket } from "./support-service.js";
import {
  ensureUserProject,
  firstVisibleColumnId,
  getUserBoard,
  newId,
  resolveUserBoardId,
} from "./user-productivity.js";

export type PromoteSupportToCardResult = {
  cardId: string;
  projectId: string;
  columnId: string;
  title: string;
  supportTicketId: string;
};

export function promoteSupportTicketToCard(opts: {
  tenantDb: AppDatabase;
  hubDb: CoreDatabase;
  ticketId: string;
  userId: string;
  agentId?: string | null;
  title?: string | null;
  prompt?: string | null;
}): PromoteSupportToCardResult {
  const ticket = getTicket(opts.ticketId, opts.hubDb);
  if (!ticket) {
    throw Object.assign(new Error("Support ticket not found"), { status: 404 });
  }

  const projectId = ensureUserProject(opts.userId, opts.tenantDb);
  const boardId = resolveUserBoardId(opts.userId, opts.tenantDb);
  const board = getUserBoard(opts.userId, opts.tenantDb, boardId);
  const columnId = board ? firstVisibleColumnId(board) : "backlog";
  const title =
    String(opts.title ?? "").trim() ||
    `Support: ${String(ticket.subject ?? "ticket").slice(0, 120)}`;
  const prompt =
    String(opts.prompt ?? "").trim() ||
    [
      `Fix follow-up from support ticket ${ticket.id}.`,
      `Subject: ${ticket.subject}`,
      ticket.body ? `Body:\n${String(ticket.body).slice(0, 4000)}` : "",
      "Ship the fix within Authority (confirm gated git/release tools).",
    ]
      .filter(Boolean)
      .join("\n\n");

  const cardId = newId();
  const context = {
    source: "support",
    support_ticket_id: ticket.id,
    support_subject: ticket.subject,
    support_status: ticket.status,
  };
  const tags = ["auto", "support", "release-followup"];

  const order = (
    opts.tenantDb
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS value
         FROM ai_project_cards WHERE project_id=? AND column_id=?`
      )
      .get(projectId, columnId) as { value: number }
  ).value;

  opts.tenantDb
    .prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, description, prompt, context_json,
        tags_json, priority, assigned_agent_id, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cardId,
      projectId,
      columnId,
      title,
      String(ticket.body ?? "").slice(0, 2000) || null,
      prompt,
      JSON.stringify(context),
      JSON.stringify(tags),
      2,
      opts.agentId ?? null,
      order + 1,
      "pending"
    );

  return {
    cardId,
    projectId,
    columnId,
    title,
    supportTicketId: ticket.id,
  };
}
