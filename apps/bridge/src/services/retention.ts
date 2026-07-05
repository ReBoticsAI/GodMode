import type Database from "better-sqlite3";

export interface RetentionPolicy {
  table: string;
  /** DELETE WHERE created_at < datetime('now', ?) */
  ageHours?: number;
  /** Keep at most N rows (by created_at DESC or rowid DESC). */
  maxRows?: number;
  /** Column used for age-based delete; defaults to created_at. */
  timeCol?: string;
  /** Optional WHERE fragment, e.g. "chat_id IS NOT NULL". */
  where?: string;
}

const DEFAULT_POLICIES: RetentionPolicy[] = [
  { table: "platform_action_log", ageHours: 24 * 90, maxRows: 50_000 },
  { table: "data_audit", ageHours: 24 * 30, maxRows: 100_000, timeCol: "ts" },
  { table: "setup_phases", ageHours: 24 * 14, maxRows: 200_000 },
  { table: "order_lifecycle", ageHours: 24 * 14, maxRows: 200_000 },
  { table: "ai_workflow_runs", ageHours: 24 * 60, maxRows: 10_000 },
  { table: "ai_prompt_queue", ageHours: 24 * 7, maxRows: 5_000 },
];

const INTERVAL_MS = Number(process.env.RETENTION_INTERVAL_MS ?? 60 * 60 * 1000);

function trimByAge(db: Database.Database, p: RetentionPolicy): number {
  if (!p.ageHours) return 0;
  const col = p.timeCol ?? "created_at";
  const where = p.where ? ` AND ${p.where}` : "";
  const r = db
    .prepare(
      `DELETE FROM ${p.table} WHERE ${col} < datetime('now', ?)${where}`
    )
    .run(`-${p.ageHours} hours`);
  return r.changes;
}

function trimByMaxRows(db: Database.Database, p: RetentionPolicy): number {
  if (!p.maxRows) return 0;
  const col = p.timeCol ?? "created_at";
  const where = p.where ? ` WHERE ${p.where}` : "";
  const countRow = db
    .prepare(`SELECT COUNT(*) AS c FROM ${p.table}${where}`)
    .get() as { c: number };
  const excess = countRow.c - p.maxRows;
  if (excess <= 0) return 0;
  const r = db.prepare(
    `DELETE FROM ${p.table} WHERE rowid IN (
       SELECT rowid FROM ${p.table}${where} ORDER BY ${col} ASC LIMIT ?
     )`
  ).run(excess);
  return r.changes;
}

/** Per-chat message cap: keep newest N messages per chat. */
function trimAiMessages(db: Database.Database, perChat = 500): number {
  const chats = db
    .prepare(`SELECT DISTINCT chat_id FROM ai_messages`)
    .all() as Array<{ chat_id: string }>;
  let total = 0;
  for (const { chat_id } of chats) {
    const r = db.prepare(
      `DELETE FROM ai_messages WHERE chat_id = ? AND rowid NOT IN (
         SELECT rowid FROM ai_messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
       )`
    ).run(chat_id, chat_id, perChat);
    total += r.changes;
  }
  return total;
}

export function runRetentionPass(db: Database.Database, policies = DEFAULT_POLICIES): void {
  let total = 0;
  for (const p of policies) {
    total += trimByAge(db, p);
    total += trimByMaxRows(db, p);
  }
  total += trimAiMessages(db);
  if (total > 0) {
    console.log(`[retention] trimmed ${total} rows`);
  }
}

export function startRetentionScheduler(db: Database.Database): () => void {
  const run = () => {
    try {
      runRetentionPass(db);
    } catch (err) {
      console.warn("[retention] pass failed:", err instanceof Error ? err.message : err);
    }
  };
  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
