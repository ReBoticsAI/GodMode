import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";

export type AwaitingKind = "backtest";

/** Durable wait handle stored on a Kanban card's context_json.__awaiting. */
export interface CardAwaitingState {
  kind: AwaitingKind;
  refId: string;
  startedAt: string;
  playbookId?: string;
  parentTaskId?: string;
  /** Populated by the completion handler when the external run finishes. */
  terminalStatus?: string;
  terminalAt?: string;
  totalTrades?: number | null;
  netPnl?: number | null;
  profitFactor?: number | null;
  resumeReady?: boolean;
}

export interface CardRowLite {
  id: string;
  context_json: string | null;
  parent_card_id: string | null;
  column_id: string;
  title: string;
}

function parseContext(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readCardAwaiting(
  card: { context_json: string | null }
): CardAwaitingState | null {
  const ctx = parseContext(card.context_json);
  const awaiting = ctx.__awaiting;
  if (!awaiting || typeof awaiting !== "object") return null;
  const a = awaiting as Partial<CardAwaitingState>;
  if (!a.kind || !a.refId || !a.startedAt) return null;
  return {
    kind: a.kind as AwaitingKind,
    refId: String(a.refId),
    startedAt: String(a.startedAt),
    playbookId: a.playbookId != null ? String(a.playbookId) : undefined,
    parentTaskId: a.parentTaskId != null ? String(a.parentTaskId) : undefined,
    terminalStatus: a.terminalStatus != null ? String(a.terminalStatus) : undefined,
    terminalAt: a.terminalAt != null ? String(a.terminalAt) : undefined,
    totalTrades: a.totalTrades ?? undefined,
    netPnl: a.netPnl ?? undefined,
    profitFactor: a.profitFactor ?? undefined,
    resumeReady: a.resumeReady === true,
  };
}

export function setCardAwaiting(
  db: AppDatabase,
  cardId: string,
  state: CardAwaitingState
): void {
  const row = db
    .prepare(`SELECT context_json FROM ai_project_cards WHERE id = ?`)
    .get(cardId) as { context_json: string | null } | undefined;
  if (!row) throw new Error(`Card not found: ${cardId}`);
  const ctx = parseContext(row.context_json);
  ctx.__awaiting = state;
  db.prepare(
    `UPDATE ai_project_cards SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(ctx), cardId);
}

export function markCardAwaitingTerminal(
  db: AppDatabase,
  cardId: string,
  patch: {
    terminalStatus: string;
    terminalAt?: string;
    totalTrades?: number | null;
    netPnl?: number | null;
    profitFactor?: number | null;
  }
): void {
  const row = db
    .prepare(`SELECT context_json FROM ai_project_cards WHERE id = ?`)
    .get(cardId) as { context_json: string | null } | undefined;
  if (!row) return;
  const ctx = parseContext(row.context_json);
  const existing = (ctx.__awaiting ?? {}) as Partial<CardAwaitingState>;
  ctx.__awaiting = {
    ...existing,
    ...patch,
    terminalAt: patch.terminalAt ?? new Date().toISOString(),
    resumeReady: true,
  };
  db.prepare(
    `UPDATE ai_project_cards SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(ctx), cardId);
}

export function clearCardAwaiting(db: AppDatabase, cardId: string): void {
  const row = db
    .prepare(`SELECT context_json FROM ai_project_cards WHERE id = ?`)
    .get(cardId) as { context_json: string | null } | undefined;
  if (!row) return;
  const ctx = parseContext(row.context_json);
  delete ctx.__awaiting;
  db.prepare(
    `UPDATE ai_project_cards SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(ctx), cardId);
}

export function findCardsAwaitingRef(
  db: AppDatabase,
  kind: AwaitingKind,
  refId: string
): CardRowLite[] {
  return db
    .prepare(
      `SELECT id, context_json, parent_card_id, column_id, title
       FROM ai_project_cards
       WHERE json_extract(context_json, '$.__awaiting.kind') = ?
         AND json_extract(context_json, '$.__awaiting.refId') = ?`
    )
    .all(kind, refId) as CardRowLite[];
}

export function appendCardComment(
  db: AppDatabase,
  cardId: string,
  body: string,
  kind: "note" | "action" | "result" | "issue" = "result"
): void {
  db.prepare(
    `INSERT INTO ai_card_comments (id, card_id, author, body, kind) VALUES (?, ?, 'system', ?, ?)`
  ).run(uuidv4(), cardId, body, kind);
}

/** True when a backtest run status means no further external wait is needed. */
export function isBacktestTerminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

export function isBacktestInFlightStatus(status: string): boolean {
  return status === "queued" || status === "running";
}
