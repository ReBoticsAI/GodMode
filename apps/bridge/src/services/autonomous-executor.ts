import type { AppDatabase } from "../db.js";
import type { LlmManager } from "./llm-manager.js";
import { runSubagent } from "./agents/runner.js";
import { createNotification } from "./notification-service.js";
import {
  clearCardAwaiting,
  isBacktestInFlightStatus,
  isBacktestTerminalStatus,
  readCardAwaiting,
} from "./card-awaiting.js";
import { v4 as uuidv4 } from "uuid";
import { broadcastCardActivity } from "../ws-broker.js";
import { getPluginHost, type SierraPb1SchedulerHost } from "@godmode/plugin-host";

function getPb1Scheduler(): SierraPb1SchedulerHost | null {
  return getPluginHost().getSierraPb1Scheduler?.() ?? null;
}

/**
 * Durable, priority-driven autonomous executor.
 *
 * The loop CONTROL is deterministic code here; the local LLM only does ONE
 * bounded turn per tick. That makes the system resilient to a flaky model: a
 * bad turn just wastes one tick because real progress is persisted to the
 * Kanban board every tick and re-read deterministically next time.
 *
 * State machine (per top-level "Task" = a parent card tagged `auto`):
 *   backlog/pending -> in_progress/working -> done/accepted        (success)
 *                                          -> status='blocked'      (needs human)
 *
 * Selection: STRICT priority (1=high first), prefer an already in_progress
 * Task over a backlog one, then FIFO by created_at. Blocked/done/cancelled
 * Tasks are excluded so the runner never tight-loops a stuck Task.
 */

export interface AutonomousDeps {
  db: AppDatabase;
  llm: LlmManager;
  bridgePort?: number;
  tenantId?: string | null;
}

export type TickStatus = "continue" | "done" | "blocked" | "idle" | "error";

export interface TickResult {
  status: TickStatus;
  taskId?: string;
  agentId?: string;
  detail?: string;
}

/** Max work-turns spent on a single Task before it is auto-blocked. */
const MAX_TASK_TICKS = 18;
/** Consecutive no-progress turns on a Task before it is auto-blocked. */
const MAX_NO_PROGRESS_TICKS = 4;
/** Chatty turns can be useful, but card state must still advance eventually. */
const MAX_TICKS_WITHOUT_BOARD_CHANGE = 8;
/** Per-turn agent tool-iteration budget (kept small so each tick returns and
 * persists progress promptly on a slow local model). */
const PER_TICK_ITERATIONS = 8;
/** Hard wall-clock ceiling for a single agent turn. If the model hangs or runs
 * away, the tick abandons the turn, keeps whatever the tools already persisted,
 * and the loop continues — so one bad turn can never block the executor. */
const TURN_TIMEOUT_MS = 240_000;

const TIMEOUT_SENTINEL = Symbol("turn-timeout");

async function withTimeout<T>(
  p: Promise<T>,
  ms: number
): Promise<T | typeof TIMEOUT_SENTINEL> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pace re-enqueues while the LLM is still loading (avoids burning the chain
 * budget in a tight spin during model warm-up). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Tools the autonomous runner may execute WITHOUT a human confirm. Read tools
 * and safe writes only. Deliberately EXCLUDES deploy_playbook, flatten_playbook,
 * flatten_all, sc_remove_all (kill-switches / destructive) — SC safety.
 */
const AUTO_OK_TOOLS = new Set<string>([
  // playbook + backtest iteration
  "get_playbooks",
  "read_playbook_spec",
  "run_backtest",
  "get_backtest_status",
  "get_backtest_results",
  "list_backtest_runs",
  "cancel_backtest",
  "watch_backtest",
  "upsert_playbook_spec",
  "set_study_input",
  "verify_playbook",
  "sc_list_studies",
  "sc_tail_log",
  // board + notifications + memory
  "todo_write",
  "create_project_card",
  "create_subtask",
  "move_project_card",
  "update_card",
  "set_card_priority",
  "list_project_cards",
  "list_subtasks",
  "comment_card",
  "add_card_comment",
  "list_card_comments",
  "create_notification",
  "mark_notification_read",
  "list_notifications",
  "remember",
  "save_artifact",
]);

interface CardRow {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  description: string | null;
  prompt: string | null;
  context_json: string | null;
  priority: number;
  parent_card_id: string | null;
  status: string | null;
  assigned_agent_id: string | null;
  tags_json: string | null;
  created_at: string;
}

interface TaskMeta {
  autoTicks: number;
  doneSeen: number;
  noProgressTicks: number;
  ticksWithoutBoardChange?: number;
  /** Per-task work-turn budget (default MAX_TASK_TICKS). Set on optimization parents. */
  maxTaskTicks?: number;
}

function readMeta(card: CardRow): TaskMeta {
  try {
    const ctx = card.context_json ? JSON.parse(card.context_json) : {};
    const auto = (ctx.__auto ?? {}) as Partial<TaskMeta>;
    return {
      autoTicks: Number(auto.autoTicks ?? 0),
      doneSeen: Number(auto.doneSeen ?? 0),
      noProgressTicks: Number(auto.noProgressTicks ?? 0),
      ticksWithoutBoardChange: Number(auto.ticksWithoutBoardChange ?? 0),
      maxTaskTicks:
        auto.maxTaskTicks != null ? Number(auto.maxTaskTicks) : undefined,
    };
  } catch {
    return { autoTicks: 0, doneSeen: 0, noProgressTicks: 0 };
  }
}

function taskTickBudget(meta: TaskMeta): number {
  return meta.maxTaskTicks != null && meta.maxTaskTicks > 0
    ? meta.maxTaskTicks
    : MAX_TASK_TICKS;
}

function writeMeta(db: AppDatabase, card: CardRow, meta: TaskMeta): void {
  let ctx: Record<string, unknown> = {};
  try {
    ctx = card.context_json ? JSON.parse(card.context_json) : {};
  } catch {
    ctx = {};
  }
  ctx.__auto = meta;
  db.prepare(
    `UPDATE ai_project_cards SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(ctx), card.id);
}

function planFromContext(card: CardRow): string[] {
  try {
    const ctx = card.context_json ? JSON.parse(card.context_json) : {};
    const plan = ctx.plan;
    if (Array.isArray(plan)) return plan.map((p) => String(p)).filter(Boolean);
  } catch {
    /* ignore */
  }
  return [];
}

function addComment(
  db: AppDatabase,
  cardId: string,
  body: string,
  kind: string,
  tenantId?: string | null
): void {
  db.prepare(
    `INSERT INTO ai_card_comments (id, card_id, author, body, kind) VALUES (?, ?, 'agent', ?, ?)`
  ).run(uuidv4(), cardId, body, kind);
  broadcastCardActivity(tenantId, { cardId, reason: "auto-comment" });
}

function notify(
  deps: AutonomousDeps,
  title: string,
  body: string
): void {
  try {
    createNotification({
      recipientKind: "user",
      recipientId: "system-local",
      recipientTenantId: deps.tenantId ?? null,
      category: "system",
      title,
      body,
    });
  } catch {
    /* notifications are best-effort */
  }
}

/** Subtasks of a parent, ordered. */
function getSubtasks(db: AppDatabase, parentId: string): CardRow[] {
  return db
    .prepare(
      `SELECT * FROM ai_project_cards WHERE parent_card_id = ? ORDER BY sort_order ASC, created_at ASC`
    )
    .all(parentId) as CardRow[];
}

function isSubtaskDone(c: CardRow): boolean {
  return (
    c.column_id === "done" ||
    c.status === "accepted" ||
    c.status === "done" ||
    c.status === "cancelled"
  );
}

/** Recent audit comments for prompt context. */
function recentComments(db: AppDatabase, cardIds: string[], limit = 6): string[] {
  if (cardIds.length === 0) return [];
  const ph = cardIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT body, kind FROM ai_card_comments WHERE card_id IN (${ph})
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(...cardIds, limit) as Array<{ body: string; kind: string | null }>;
  return rows.reverse().map((r) => `- [${r.kind ?? "note"}] ${r.body}`);
}

function countComments(db: AppDatabase, cardIds: string[]): number {
  if (cardIds.length === 0) return 0;
  const ph = cardIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ai_card_comments WHERE card_id IN (${ph})`
    )
    .get(...cardIds) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

function hasNewSubstantiveAgentComment(
  db: AppDatabase,
  cardIds: string[],
  beforeCount: number
): boolean {
  if (cardIds.length === 0) return false;
  const ph = cardIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT author, body FROM ai_card_comments
       WHERE card_id IN (${ph})
       ORDER BY created_at ASC, id ASC
       LIMIT -1 OFFSET ?`
    )
    .all(...cardIds, beforeCount) as Array<{
    author: string | null;
    body: string | null;
  }>;
  return rows.some((r) => {
    if (r.author !== "agent") return false;
    const body = String(r.body ?? "").trim();
    if (body.length < 40) return false;
    if (/^(status:\s*)?(continue|done|blocked)\b/i.test(body)) return false;
    return /\b(phase|backtest|sweep|window|baseline|param|metric|result|complete|done|next)\b/i.test(
      body
    );
  });
}

function hasRecentCompletionComment(
  db: AppDatabase,
  cardIds: string[]
): boolean {
  if (cardIds.length === 0) return false;
  const ph = cardIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT body FROM ai_card_comments
       WHERE card_id IN (${ph}) AND author = 'agent'
       ORDER BY created_at DESC, id DESC
       LIMIT 8`
    )
    .all(...cardIds) as Array<{ body: string | null }>;
  return rows.some((r) =>
    /\b(complete|completed|done|moving to|move to|ready for phase)\b/i.test(
      String(r.body ?? "")
    )
  );
}

/**
 * Pick the single highest-priority actionable Task across ALL agent boards.
 * Only parent cards opted-in via a `auto` tag are eligible.
 */
function selectActiveTask(db: AppDatabase): CardRow | null {
  const rows = db
    .prepare(
      `SELECT c.* FROM ai_project_cards c
       WHERE c.parent_card_id IS NULL
         AND (c.tags_json LIKE '%"auto"%' OR c.tags_json LIKE '%auto%')
         AND COALESCE(c.status,'') NOT IN ('blocked','accepted','cancelled','done')
         AND c.column_id != 'done'
       ORDER BY c.priority ASC,
                CASE c.column_id WHEN 'in_progress' THEN 0 ELSE 1 END,
                c.created_at ASC
       LIMIT 1`
    )
    .get() as CardRow | undefined;
  return rows ?? null;
}

function resolveAgentId(db: AppDatabase, card: CardRow): string {
  if (card.assigned_agent_id) return card.assigned_agent_id;
  const proj = db
    .prepare(`SELECT agent_id FROM ai_projects WHERE id = ?`)
    .get(card.project_id) as { agent_id: string | null } | undefined;
  return proj?.agent_id ?? "sierra-chart";
}

/** Force the board invariant: exactly one not-done subtask is in_progress. */
function enforceSingleInProgress(db: AppDatabase, subtasks: CardRow[]): void {
  const notDone = subtasks.filter((s) => !isSubtaskDone(s));
  if (notDone.length === 0) return;
  const inProg = notDone.filter((s) => s.column_id === "in_progress");
  if (inProg.length === 1) return;
  if (inProg.length === 0) {
    const first = notDone[0];
    db.prepare(
      `UPDATE ai_project_cards SET column_id='in_progress', status='working', updated_at=datetime('now') WHERE id = ?`
    ).run(first.id);
  } else {
    // keep the first in_progress, demote the rest to backlog
    inProg.slice(1).forEach((s) =>
      db
        .prepare(
          `UPDATE ai_project_cards SET column_id='backlog', status='pending', updated_at=datetime('now') WHERE id = ?`
        )
        .run(s.id)
    );
  }
}

/** Deterministic fallback decomposition from context.plan when the model fails. */
function seedSubtasksFromPlan(
  db: AppDatabase,
  parent: CardRow,
  plan: string[]
): void {
  plan.forEach((title, i) => {
    db.prepare(
      `INSERT INTO ai_project_cards
         (id, project_id, column_id, title, status, priority, sort_order, parent_card_id, assigned_agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      parent.project_id,
      i === 0 ? "in_progress" : "backlog",
      title,
      i === 0 ? "working" : "pending",
      parent.priority,
      i,
      parent.id,
      parent.assigned_agent_id
    );
  });
}

function getActiveSubtask(subtasks: CardRow[]): CardRow | null {
  const inProg = subtasks.filter(
    (s) => s.column_id === "in_progress" && !isSubtaskDone(s)
  );
  return inProg[0] ?? null;
}

function expectsBacktestRun(subtask: CardRow | null | undefined): boolean {
  if (!subtask) return false;
  const title = subtask.title.toLowerCase();
  if (isDeclarationOnlySubtask(subtask)) return false;
  return (
    /\bbacktest\b/.test(title) ||
    /\bsweeps?\b/.test(title) ||
    /\bvalidation\b/.test(title) ||
    /\boos\b/.test(title) ||
    /\bphase\s*[1-4]\b/.test(title)
  );
}

function isDeclarationOnlySubtask(subtask: CardRow): boolean {
  const title = subtask.title.toLowerCase();
  if (/\b(backtest|sweep|validation|run|replay)\b/.test(title)) return false;
  return (
    /\bphase\s*0\b/.test(title) ||
    /\b(declare|define|setup|set up|window|baseline params|methodology)\b/.test(
      title
    )
  );
}

function nextActionableSubtask(subtasks: CardRow[]): CardRow | null {
  return getActiveSubtask(subtasks) ?? subtasks.find((s) => !isSubtaskDone(s)) ?? null;
}

function buildPrompt(
  parent: CardRow,
  subtasks: CardRow[],
  comments: string[],
  needsDecompose: boolean,
  resumeBacktest?: { runId: string; status: string }
): string {
  const sub = subtasks
    .map(
      (s) =>
        `  - [${isSubtaskDone(s) ? "DONE" : s.column_id === "in_progress" ? "IN PROGRESS" : "pending"}] (${s.id}) ${s.title}`
    )
    .join("\n");
  const goal = parent.prompt || parent.description || parent.title;
  const focusedSubtask = nextActionableSubtask(subtasks);
  const lines: string[] = [];
  if (resumeBacktest) {
    lines.push(
      `RESUME: Backtest ${resumeBacktest.runId} finished with status "${resumeBacktest.status}".`,
      `Call get_backtest_results("${resumeBacktest.runId}") now, comment_card on the IN PROGRESS subtask with the metrics, then mark that subtask done (update_card columnId:"done", status:"accepted") or start the next iteration per the GOAL.`,
      `Do NOT poll get_backtest_status — the run is already complete.`,
      ``
    );
  }
  lines.push(
    `You are the autonomous executor working ONE Task on the Kanban board. Do real work THIS turn using your tools — do not just plan.`,
    ``,
    `TASK (parent card id ${parent.id}): ${parent.title}`,
    `GOAL: ${goal}`,
    ``,
  );
  if (needsDecompose) {
    lines.push(
      `This Task has NO subtasks yet. FIRST decompose it: call create_subtask once per step with parentCardId="${parent.id}" and a short title (use columnId:"backlog"). Create 3-6 concrete, ordered steps that accomplish the GOAL. Then begin the first step. Leave a comment_card on the parent noting the plan.`
    );
  } else {
    lines.push(`SUBTASKS:`);
    lines.push(sub);
    lines.push(``);
    lines.push(
      `Work the ONE subtask marked IN PROGRESS now. Execute the real tools needed (e.g. run_backtest with simOnly:true, startDate/endDate for IS/OOS windows, or paramsOverride within the playbook tuning envelope).`,
      `LONG-RUNNING OPTIMIZATION: parent Tasks should use phase subtasks (Phase0 setup → Phase1 baseline IS → Phase2 one-factor sweeps → Phase3 combine → Phase4 OOS → Phase5 report). Set context_json.__auto.maxTaskTicks to ~200 on the parent when creating the optimization Task.`,
      `LONG-RUNNING BACKTESTS: when you call run_backtest, do NOT mark the subtask done in that same turn — the platform parks the subtask and resumes you automatically when the replay finishes. End with STATUS: CONTINUE after starting a backtest.`,
      `When a backtest has already finished (RESUME banner above), call get_backtest_results, comment_card with metrics, then mark the subtask done with update_card(cardId, columnId:"done", status:"accepted").`
    );
    if (expectsBacktestRun(focusedSubtask) && !resumeBacktest) {
      lines.push(
        ``,
        `IMMEDIATE BACKTEST DIRECTIVE for "${focusedSubtask?.title ?? "current subtask"}": your NEXT action MUST be exactly one run_backtest tool call, then stop with STATUS: CONTINUE. A comment without that tool call does NOT advance this task.`,
        `Use the target playbookId from the task context, simOnly:true, and the IS window dates declared on the parent task. Phase4 OOS uses a different declared OOS week.`,
        `For Phase2/3 non-baseline runs include paramsOverride inside the declared tuning envelope only. Never change structural keys, triggers, taps, or visual study inputs.`
      );
    }
  }
  if (comments.length) {
    lines.push(``, `RECENT AUDIT LOG (most recent last):`, ...comments);
  }
  lines.push(
    ``,
    `RULES:`,
    `- One subtask of focus per turn. Persist progress to the board (comment_card + update_card) before you stop.`,
    `- NEVER deploy, flatten, remove studies, or place live trades. Backtests are sim-only.`,
    `- Do NOT change core strategy composition (which signals exist or entry/exit trigger layout). You MAY tune NUMERIC params/inputs within sane bounds.`,
    `- End your message with EXACTLY ONE status line:`,
    `    STATUS: CONTINUE   (made progress, more steps remain)`,
    `    STATUS: DONE       (every subtask is finished)`,
    `    STATUS: BLOCKED: <one-line reason>   (you need a human / missing input / a guardrail stopped you)`
  );
  return lines.join("\n");
}

function parseStatus(text: string): { kind: TickStatus; reason?: string } {
  const m = /STATUS:\s*(DONE|CONTINUE|BLOCKED)\s*:?\s*([^\n]*)/i.exec(text);
  if (!m) return { kind: "continue" };
  const k = m[1].toUpperCase();
  if (k === "DONE") return { kind: "done" };
  if (k === "BLOCKED") return { kind: "blocked", reason: (m[2] || "").trim() };
  return { kind: "continue" };
}

function blockTask(
  deps: AutonomousDeps,
  parent: CardRow,
  reason: string
): TickResult {
  deps.db
    .prepare(
      `UPDATE ai_project_cards SET status='blocked', updated_at=datetime('now') WHERE id = ?`
    )
    .run(parent.id);
  addComment(deps.db, parent.id, `BLOCKED: ${reason}`, "issue", deps.tenantId);
  // Status moved to blocked above; ping so live panels surface it immediately.
  broadcastCardActivity(deps.tenantId, { cardId: parent.id, reason: "blocked" });
  notify(deps, `Task blocked: ${parent.title}`, reason);
  return { status: "blocked", taskId: parent.id, detail: reason };
}

function finalizeDone(deps: AutonomousDeps, parent: CardRow): TickResult {
  deps.db
    .prepare(
      `UPDATE ai_project_cards SET column_id='done', status='accepted', updated_at=datetime('now') WHERE id = ?`
    )
    .run(parent.id);
  addComment(
    deps.db,
    parent.id,
    `Task complete — all subtasks done.`,
    "result",
    deps.tenantId
  );
  broadcastCardActivity(deps.tenantId, { cardId: parent.id, reason: "done" });
  notify(deps, `Task complete: ${parent.title}`, `All subtasks finished.`);
  return { status: "done", taskId: parent.id };
}

function autoAcceptCompletedBacktestSubtask(
  db: AppDatabase,
  subtask: CardRow,
  resumeBacktest: { runId: string; status: string } | undefined,
  tenantId?: string | null
): boolean {
  if (getPb1Scheduler()?.isMultiBacktestSubtask(subtask)) return false;
  if (!resumeBacktest || resumeBacktest.status !== "done") return false;
  const run = db
    .prepare(
      `SELECT total_trades, net_pnl, profit_factor FROM backtest_runs WHERE id = ?`
    )
    .get(resumeBacktest.runId) as
    | {
        total_trades: number | null;
        net_pnl: number | null;
        profit_factor: number | null;
      }
    | undefined;
  if (!run || (run.total_trades ?? 0) <= 0) return false;

  clearCardAwaiting(db, subtask.id);
  db.prepare(
    `UPDATE ai_project_cards
     SET column_id='done', status='accepted', updated_at=datetime('now')
     WHERE id = ? AND column_id != 'done'`
  ).run(subtask.id);
  addComment(
    db,
    subtask.id,
    `Auto-accepted completed backtest ${resumeBacktest.runId}: ${run.total_trades ?? 0} trades, net ${Number(run.net_pnl ?? 0).toFixed(2)}, PF ${Number(run.profit_factor ?? 0).toFixed(3)}.`,
    "result",
    tenantId
  );
  return true;
}

function autoAcceptCompletedDeclarationSubtask(
  db: AppDatabase,
  parent: CardRow,
  subtask: CardRow,
  tenantId?: string | null
): boolean {
  if (!isDeclarationOnlySubtask(subtask)) return false;
  if (readCardAwaiting(subtask)) return false;
  if (!hasRecentCompletionComment(db, [subtask.id, parent.id])) return false;

  db.prepare(
    `UPDATE ai_project_cards
     SET column_id='done', status='accepted', updated_at=datetime('now')
     WHERE id = ? AND column_id != 'done'`
  ).run(subtask.id);
  addComment(
    db,
    subtask.id,
    `Auto-accepted declaration/setup phase after completion comment.`,
    "result",
    tenantId
  );
  return true;
}

function clearAwaitingOnAcceptedSubtasks(db: AppDatabase, subtasks: CardRow[]): boolean {
  let changed = false;
  for (const subtask of subtasks) {
    if (isSubtaskDone(subtask) && readCardAwaiting(subtask)) {
      clearCardAwaiting(db, subtask.id);
      changed = true;
    }
  }
  return changed;
}

/**
 * Execute a single autonomous tick. Deterministic selection + reconciliation
 * wraps one bounded agent turn. Returns the resulting state so the queue worker
 * can decide whether to re-enqueue the loop.
 */
export async function runAutonomousTick(
  deps: AutonomousDeps
): Promise<TickResult> {
  const db = deps.db;
  const parent = selectActiveTask(db);
  if (!parent) return { status: "idle" };

  // If the local model isn't loaded yet, don't burn a real work-turn — pace a
  // moment and let the loop re-enqueue so the Task is still picked up promptly.
  if (!deps.llm.isReady()) {
    await sleep(4000);
    return { status: "continue", taskId: parent.id, detail: "llm-not-ready" };
  }

  const agentId = resolveAgentId(db, parent);
  const meta = readMeta(parent);

  // Guardrail: per-Task tick cap (configurable via context_json.__auto.maxTaskTicks).
  const tickBudget = taskTickBudget(meta);
  if (meta.autoTicks >= tickBudget) {
    return blockTask(
      deps,
      parent,
      `Exceeded max work-turns (${tickBudget}) without completing.`
    );
  }

  // Move a fresh backlog Task into in_progress.
  if (parent.column_id !== "in_progress") {
    db.prepare(
      `UPDATE ai_project_cards SET column_id='in_progress', status='working', updated_at=datetime('now') WHERE id = ?`
    ).run(parent.id);
  }

  let subtasks = getSubtasks(db, parent.id);
  if (clearAwaitingOnAcceptedSubtasks(db, subtasks)) {
    subtasks = getSubtasks(db, parent.id);
  }

  // Already complete? (all subtasks done)
  if (subtasks.length > 0 && subtasks.every(isSubtaskDone)) {
    return finalizeDone(deps, parent);
  }

  const needsDecompose = subtasks.length === 0;
  if (!needsDecompose) enforceSingleInProgress(db, subtasks);
  subtasks = getSubtasks(db, parent.id);

  const activeSubtask = getActiveSubtask(subtasks);
  let resumeBacktest: { runId: string; status: string } | undefined;
  let deterministicKick = false;
  let sweepFinalized = false;

  if (activeSubtask) {
    const awaiting = readCardAwaiting(activeSubtask);
    if (awaiting?.kind === "backtest") {
      const runRow = db
        .prepare(`SELECT status FROM backtest_runs WHERE id = ?`)
        .get(awaiting.refId) as { status: string } | undefined;
      const runStatus = runRow?.status ?? awaiting.terminalStatus ?? "";
      if (isBacktestInFlightStatus(runStatus)) {
        // Parked on external backtest — do not burn tick budget or no-progress counter.
        return {
          status: "continue",
          taskId: parent.id,
          agentId,
          detail: "awaiting-backtest",
        };
      }
      if (isBacktestTerminalStatus(runStatus)) {
        resumeBacktest = { runId: awaiting.refId, status: runStatus };
        const pb1 = getPb1Scheduler();
        if (
          pb1?.isMultiBacktestSubtask(activeSubtask) &&
          resumeBacktest.status === "done"
        ) {
          if (pb1.isCombinePhaseSubtask(activeSubtask)) {
            pb1.recordCompletedCombineRun(
              deps,
              parent,
              activeSubtask,
              resumeBacktest.runId,
              resumeBacktest.status
            );
          } else if (pb1.isOosPhaseSubtask(activeSubtask)) {
            pb1.recordCompletedOosRun(
              deps,
              parent,
              activeSubtask,
              resumeBacktest.runId,
              resumeBacktest.status
            );
          } else {
            pb1.recordCompletedSweepRun(
              deps,
              parent,
              activeSubtask,
              resumeBacktest.runId,
              resumeBacktest.status
            );
          }
          resumeBacktest = undefined;
          subtasks = getSubtasks(db, parent.id);
        } else {
          clearCardAwaiting(db, activeSubtask.id);
        }
      }
    }
  }

  const activeForKick =
    getActiveSubtask(subtasks) ??
    subtasks.find((s) => !isSubtaskDone(s)) ??
    null;
  const parentFresh = db
    .prepare(`SELECT * FROM ai_project_cards WHERE id = ?`)
    .get(parent.id) as CardRow;
  const pb1Scheduler = getPb1Scheduler();
  if (activeForKick && pb1Scheduler?.isSweepPhaseSubtask(activeForKick)) {
    pb1Scheduler.syncSweepCursorFromRuns(db, parentFresh);
  } else if (activeForKick && pb1Scheduler?.isCombinePhaseSubtask(activeForKick)) {
    pb1Scheduler.syncCombineCursorFromRuns(db, parentFresh);
  } else if (activeForKick && pb1Scheduler?.isOosPhaseSubtask(activeForKick)) {
    pb1Scheduler.syncOosCursorFromRuns(db, parentFresh);
  }
  const parentSynced = db
    .prepare(`SELECT * FROM ai_project_cards WHERE id = ?`)
    .get(parent.id) as CardRow;
  if (
    pb1Scheduler &&
    activeForKick &&
    !resumeBacktest &&
    !readCardAwaiting(activeForKick) &&
    (pb1Scheduler.isSweepPhaseSubtask(activeForKick) ||
      pb1Scheduler.isCombinePhaseSubtask(activeForKick) ||
      pb1Scheduler.isOosPhaseSubtask(activeForKick))
  ) {
    const phaseKind = pb1Scheduler.isOosPhaseSubtask(activeForKick)
      ? "oos"
      : pb1Scheduler.isCombinePhaseSubtask(activeForKick)
        ? "combine"
        : "sweep";
    try {
      const finalized =
        phaseKind === "oos"
          ? pb1Scheduler.finalizeOosPhaseIfComplete(deps, parentSynced, activeForKick)
          : phaseKind === "combine"
            ? pb1Scheduler.finalizeCombinePhaseIfComplete(deps, parentSynced, activeForKick)
            : pb1Scheduler.finalizeSweepPhaseIfComplete(deps, parentSynced, activeForKick);
      if (finalized) {
        sweepFinalized = true;
        subtasks = getSubtasks(db, parent.id);
      } else {
        const kicked =
          phaseKind === "oos"
            ? await pb1Scheduler.tryDeterministicPb1OosKick(deps, parentSynced, activeForKick)
            : phaseKind === "combine"
              ? await pb1Scheduler.tryDeterministicPb1CombineKick(
                  deps,
                  parentSynced,
                  activeForKick
                )
              : await pb1Scheduler.tryDeterministicPb1SweepKick(
                  deps,
                  parentSynced,
                  activeForKick
                );
        if (kicked) deterministicKick = true;
      }
    } catch (err) {
      addComment(
        db,
        parent.id,
        `Deterministic ${phaseKind} kick failed: ${err instanceof Error ? err.message : String(err)}`,
        "issue",
        deps.tenantId
      );
    }
  }

  if (deterministicKick || sweepFinalized) {
    subtasks = getSubtasks(db, parent.id);
    if (subtasks.length > 0 && subtasks.every(isSubtaskDone)) {
      return finalizeDone(deps, parent);
    }
    if (subtasks.length > 0) enforceSingleInProgress(db, subtasks);
    meta.autoTicks += 1;
    meta.noProgressTicks = 0;
    meta.ticksWithoutBoardChange = 0;
    meta.doneSeen = subtasks.filter(isSubtaskDone).length;
    writeMeta(db, { ...parent, context_json: parent.context_json }, meta);
    return {
      status: "continue",
      taskId: parent.id,
      agentId,
      detail: deterministicKick
        ? "deterministic-sweep-kick"
        : "sweep-phase-finalized",
    };
  }

  const doneBefore = subtasks.filter(isSubtaskDone).length;
  const commentIds = [parent.id, ...subtasks.map((s) => s.id)];
  const commentCountBefore = countComments(db, commentIds);
  const comments = recentComments(db, commentIds);
  const prompt = buildPrompt(
    parent,
    subtasks,
    comments,
    needsDecompose,
    resumeBacktest
  );

  let answer = "";
  let runError: string | null = null;
  try {
    const raced = await withTimeout(
      runSubagent({
        db,
        llm: deps.llm,
        agentId,
        prompt,
        toolCtx: {
          db,
          bridgePort: deps.bridgePort,
          llm: deps.llm,
          activeTaskCardId: parent.id,
          activeSubtaskCardId: activeSubtask?.id,
          autonomousTick: true,
        },
        maxIterations: PER_TICK_ITERATIONS,
        onConfirmRequired: async ({ name }) => AUTO_OK_TOOLS.has(name),
      }),
      TURN_TIMEOUT_MS
    );
    if (raced === TIMEOUT_SENTINEL) {
      runError = `agent turn exceeded ${Math.round(TURN_TIMEOUT_MS / 1000)}s wall-clock limit`;
    } else {
      answer = raced;
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }

  // Re-read board state AFTER the turn.
  let after = getSubtasks(db, parent.id);
  const hasSoftCommentProgress = hasNewSubstantiveAgentComment(
    db,
    commentIds,
    commentCountBefore
  );

  // Decomposition fallback: if still no subtasks, seed from context.plan.
  if (after.length === 0) {
    const plan = planFromContext(parent);
    if (plan.length > 0) {
      seedSubtasksFromPlan(db, parent, plan);
      addComment(
        db,
        parent.id,
        `Seeded ${plan.length} subtasks from task plan (model did not decompose).`,
        "action",
        deps.tenantId
      );
      after = getSubtasks(db, parent.id);
    }
  }

  const activeAfterTurn = activeSubtask
    ? after.find((s) => s.id === activeSubtask.id)
    : undefined;
  if (
    activeAfterTurn &&
    !isSubtaskDone(activeAfterTurn) &&
    (autoAcceptCompletedBacktestSubtask(db, activeAfterTurn, resumeBacktest, deps.tenantId) ||
      autoAcceptCompletedDeclarationSubtask(
        db,
        parent,
        activeAfterTurn,
        deps.tenantId
      ))
  ) {
    after = getSubtasks(db, parent.id);
  }
  if (clearAwaitingOnAcceptedSubtasks(db, after)) {
    after = getSubtasks(db, parent.id);
  }

  // All done now?
  if (after.length > 0 && after.every(isSubtaskDone)) {
    return finalizeDone(deps, parent);
  }

  // Enforce invariant for next turn.
  if (after.length > 0) enforceSingleInProgress(db, after);

  // Status + progress accounting.
  const status = parseStatus(answer);
  const doneAfter = after.filter(isSubtaskDone).length;
  const activeAfter = getActiveSubtask(after);
  const nowAwaiting =
    activeAfter != null && readCardAwaiting(activeAfter) != null;
  const boardChanged =
    doneAfter > doneBefore ||
    after.length > subtasks.length ||
    nowAwaiting ||
    resumeBacktest != null;
  const madeProgress =
    boardChanged || hasSoftCommentProgress;

  if (runError && !madeProgress) {
    meta.noProgressTicks += 1;
  } else if (madeProgress) {
    meta.noProgressTicks = 0;
  } else {
    meta.noProgressTicks += 1;
  }
  meta.ticksWithoutBoardChange = boardChanged
    ? 0
    : Number(meta.ticksWithoutBoardChange ?? 0) + 1;
  meta.autoTicks += 1;
  meta.doneSeen = doneAfter;
  writeMeta(db, { ...parent, context_json: parent.context_json }, meta);

  if (status.kind === "blocked") {
    return blockTask(deps, parent, status.reason || "Agent reported blocked.");
  }
  if (meta.noProgressTicks >= MAX_NO_PROGRESS_TICKS) {
    return blockTask(
      deps,
      parent,
      `No board progress after ${MAX_NO_PROGRESS_TICKS} turns${runError ? ` (last error: ${runError})` : ""}.`
    );
  }
  if (
    Number(meta.ticksWithoutBoardChange ?? 0) >= MAX_TICKS_WITHOUT_BOARD_CHANGE
  ) {
    return blockTask(
      deps,
      parent,
      `No card state change after ${MAX_TICKS_WITHOUT_BOARD_CHANGE} turns.`
    );
  }

  return {
    status: "continue",
    taskId: parent.id,
    agentId,
    detail: madeProgress ? "progress" : "no-progress",
  };
}

/** True if any actionable autonomous Task remains on any board. */
export function hasActionableTask(db: AppDatabase): boolean {
  return selectActiveTask(db) != null;
}

