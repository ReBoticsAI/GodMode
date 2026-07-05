import type { AppDatabase } from "../db.js";
import { broadcastCardActivity } from "../ws-broker.js";

type CardLite = {
  id: string;
  parent_card_id: string | null;
  column_id: string;
  status: string | null;
  sort_order: number;
};

function isDone(card: CardLite): boolean {
  return card.column_id === "done" || card.status === "accepted" || card.status === "done";
}

function isWorking(card: CardLite): boolean {
  return card.column_id === "in_progress" || card.status === "working";
}

function markDone(db: AppDatabase, cardId: string): void {
  db.prepare(
    `UPDATE ai_project_cards
     SET column_id = 'done', status = 'accepted', updated_at = datetime('now')
     WHERE id = ?`
  ).run(cardId);
}

function markInProgress(db: AppDatabase, cardId: string): void {
  db.prepare(
    `UPDATE ai_project_cards
     SET column_id = 'in_progress', status = 'working', updated_at = datetime('now')
     WHERE id = ?`
  ).run(cardId);
}

function listSubtasks(db: AppDatabase, parentId: string): CardLite[] {
  return db
    .prepare(
      `SELECT id, parent_card_id, column_id, status, sort_order
       FROM ai_project_cards WHERE parent_card_id = ? ORDER BY sort_order ASC`
    )
    .all(parentId) as CardLite[];
}

function agentCommentCount(db: AppDatabase, cardId: string, kinds?: string[]): number {
  if (kinds?.length) {
    const ph = kinds.map(() => "?").join(",");
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM ai_card_comments
         WHERE card_id = ? AND author = 'agent' AND kind IN (${ph})`
      )
      .get(cardId, ...kinds) as { c: number } | undefined;
    return Number(row?.c ?? 0);
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ai_card_comments WHERE card_id = ? AND author = 'agent'`
    )
    .get(cardId) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

function hasAgentResultComment(db: AppDatabase, cardId: string): boolean {
  return agentCommentCount(db, cardId, ["result"]) > 0;
}

/**
 * After an agent `result` comment on a subtask, mark it done and advance the plan.
 */
export function advanceSubtaskOnResultComment(
  db: AppDatabase,
  cardId: string,
  tenantId?: string | null
): boolean {
  const card = db
    .prepare(
      `SELECT id, parent_card_id, column_id, status, sort_order FROM ai_project_cards WHERE id = ?`
    )
    .get(cardId) as CardLite | undefined;
  if (!card?.parent_card_id || isDone(card)) return false;

  markDone(db, card.id);
  reconcileParentProgress(db, card.parent_card_id, tenantId);
  return true;
}

/**
 * Align Kanban subtask columns with the audit log. Interactive chat often posts
 * comment_card entries without a follow-up todo_write — this keeps Active Work in sync.
 */
export function reconcileParentProgress(
  db: AppDatabase,
  parentId: string,
  tenantId?: string | null
): boolean {
  const parent = db
    .prepare(`SELECT id, column_id, status FROM ai_project_cards WHERE id = ?`)
    .get(parentId) as CardLite | undefined;
  if (!parent) return false;

  const subtasks = listSubtasks(db, parentId);
  if (subtasks.length === 0) return false;

  let changed = false;

  for (const sub of subtasks) {
    if (isDone(sub)) continue;
    if (hasAgentResultComment(db, sub.id)) {
      markDone(db, sub.id);
      changed = true;
    }
  }

  const refreshed = listSubtasks(db, parentId);
  const open = refreshed.filter((s) => !isDone(s));

  // Parent-only audit trail: one agent comment per planned step (common in chat).
  if (open.length === refreshed.length) {
    const parentNotes = agentCommentCount(db, parentId);
    if (parentNotes >= refreshed.length) {
      for (const sub of open) {
        markDone(db, sub.id);
      }
      changed = true;
    }
  }

  const after = listSubtasks(db, parentId);
  const stillOpen = after.filter((s) => !isDone(s));
  const hasActive = stillOpen.some(isWorking);

  if (stillOpen.length > 0 && !hasActive) {
    markInProgress(db, stillOpen[0]!.id);
    changed = true;
  }

  if (stillOpen.length === 0 && !isDone(parent)) {
    markDone(db, parentId);
    changed = true;
  }

  if (changed && tenantId) {
    broadcastCardActivity(tenantId, { cardId: parentId, reason: "progress-reconcile" });
  }

  return changed;
}
