/**
 * Durable Intelligence turn status (#556).
 * Survives Bridge process death (tsx watch) so boot can continue once.
 */
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { listAllTenantIds, getCloudDb } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { completeActiveWorkRunCard } from "./active-work-run-card.js";
import { tryGetAiChatTurnHandlers } from "./ai-chat-turn.js";
import type { HistoryTurn } from "./chat-history.js";

export const BRIDGE_BOOT_GENERATION = uuidv4();

export type ChatTurnStatus =
  | "idle"
  | "running"
  | "resuming"
  | "interrupted_failed";

export type ChatTurnCheckpoint = {
  name: string;
  isError?: boolean;
  preview?: string;
};

export type ChatTurnState = {
  status: ChatTurnStatus;
  userMessageId: string;
  agentId: string;
  userId: string;
  generation: string;
  checkpoint: ChatTurnCheckpoint[];
};

const CONTINUE_PREFIX =
  "[GodMode] The Bridge process restarted mid-turn (typical after a Core Bridge file save in local dev). Continue the user's request. Do not redo file or git work that already succeeded.";

export function parseChatTurnState(raw: unknown): ChatTurnState | null {
  if (raw == null || raw === "") return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const status = o.status;
  if (
    status !== "idle" &&
    status !== "running" &&
    status !== "resuming" &&
    status !== "interrupted_failed"
  ) {
    return null;
  }
  if (typeof o.userMessageId !== "string" || !o.userMessageId.trim()) return null;
  if (typeof o.agentId !== "string" || !o.agentId.trim()) return null;
  if (typeof o.userId !== "string" || !o.userId.trim()) return null;
  const checkpoint = Array.isArray(o.checkpoint)
    ? o.checkpoint
        .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
        .map((c) => ({
          name: typeof c.name === "string" ? c.name : "unknown",
          isError: c.isError === true,
          preview: typeof c.preview === "string" ? c.preview.slice(0, 240) : undefined,
        }))
    : [];
  return {
    status,
    userMessageId: o.userMessageId.trim(),
    agentId: o.agentId.trim(),
    userId: o.userId.trim(),
    generation: typeof o.generation === "string" ? o.generation : "",
    checkpoint,
  };
}

export function readChatTurnState(
  db: AppDatabase,
  chatId: string
): ChatTurnState | null {
  const row = db
    .prepare(`SELECT turn_state_json FROM ai_chats WHERE id = ?`)
    .get(chatId) as { turn_state_json?: string | null } | undefined;
  return parseChatTurnState(row?.turn_state_json);
}

export function writeChatTurnState(
  db: AppDatabase,
  chatId: string,
  state: ChatTurnState | null
): void {
  db.prepare(
    `UPDATE ai_chats SET turn_state_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(state ? JSON.stringify(state) : null, chatId);
}

export function markChatTurnRunning(
  db: AppDatabase,
  args: {
    chatId: string;
    userMessageId: string;
    agentId: string;
    userId: string;
  }
): ChatTurnState {
  const prev = readChatTurnState(db, args.chatId);
  // Keep `resuming` through the continued turn so a crash mid-resume
  // fail-closes on the next boot instead of looping forever.
  const state: ChatTurnState = {
    status: prev?.status === "resuming" ? "resuming" : "running",
    userMessageId: args.userMessageId,
    agentId: args.agentId,
    userId: args.userId,
    generation: BRIDGE_BOOT_GENERATION,
    checkpoint:
      prev?.status === "resuming" || prev?.status === "running"
        ? prev.checkpoint
        : [],
  };
  writeChatTurnState(db, args.chatId, state);
  return state;
}

/**
 * User Stop (abort while the client is still connected) clears the turn.
 * Disconnect / process death leaves `running` so boot can continue once.
 */
export function shouldKeepInterruptedTurnRunning(args: {
  aborted: boolean;
  transportClosed: boolean;
}): boolean {
  return args.aborted && args.transportClosed;
}

export function markChatTurnIdle(db: AppDatabase, chatId: string): void {
  const prev = readChatTurnState(db, chatId);
  if (!prev) return;
  writeChatTurnState(db, chatId, { ...prev, status: "idle", checkpoint: [] });
}

export function appendChatTurnCheckpoint(
  db: AppDatabase,
  chatId: string,
  entry: ChatTurnCheckpoint
): void {
  const prev = readChatTurnState(db, chatId);
  if (!prev || (prev.status !== "running" && prev.status !== "resuming")) return;
  const next = [...prev.checkpoint, entry].slice(-24);
  writeChatTurnState(db, chatId, { ...prev, checkpoint: next });
}

export function listInterruptedChatTurns(
  db: AppDatabase
): Array<{ chatId: string; state: ChatTurnState }> {
  let rows: Array<{ id: string; turn_state_json: string | null }>;
  try {
    rows = db
      .prepare(`SELECT id, turn_state_json FROM ai_chats WHERE turn_state_json IS NOT NULL`)
      .all() as Array<{ id: string; turn_state_json: string | null }>;
  } catch {
    return [];
  }
  const out: Array<{ chatId: string; state: ChatTurnState }> = [];
  for (const row of rows) {
    const state = parseChatTurnState(row.turn_state_json);
    if (!state) continue;
    if (state.status === "running" || state.status === "resuming") {
      out.push({ chatId: row.id, state });
    }
  }
  return out;
}

function checkpointPreview(result: unknown): string | undefined {
  try {
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return text.slice(0, 240);
  } catch {
    return undefined;
  }
}

export function checkpointFromToolResult(
  name: string,
  result: unknown,
  isError?: boolean
): ChatTurnCheckpoint {
  return {
    name,
    isError: Boolean(isError),
    preview: checkpointPreview(result),
  };
}

function userTextFromContent(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const o = content as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (typeof o.content === "string") return o.content;
  return "";
}

export function buildContinueMessage(args: {
  originalUserText: string;
  checkpoint: ChatTurnCheckpoint[];
}): string {
  const lines = [CONTINUE_PREFIX];
  if (args.checkpoint.length) {
    lines.push("Tools that already returned:");
    for (const c of args.checkpoint) {
      const err = c.isError ? " (error)" : "";
      const preview = c.preview ? `: ${c.preview}` : "";
      lines.push(`- ${c.name}${err}${preview}`);
    }
  } else {
    lines.push("No tool results were checkpointed before the restart.");
  }
  lines.push("Original user message:");
  lines.push(args.originalUserText.trim() || "(empty or image-only)");
  return lines.join("\n");
}

function loadHistoryAndUserText(
  db: AppDatabase,
  chatId: string,
  userMessageId: string
): { history: HistoryTurn[]; originalUserText: string } {
  const rows = db
    .prepare(
      `SELECT id, role, content_json FROM ai_messages WHERE chat_id = ? ORDER BY created_at ASC`
    )
    .all(chatId) as Array<{ id: string; role: string; content_json: string }>;
  const history: HistoryTurn[] = [];
  let originalUserText = "";
  for (const row of rows) {
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(row.content_json) as Record<string, unknown>;
    } catch {
      content = {};
    }
    if (row.id === userMessageId) {
      originalUserText = userTextFromContent(content);
      continue;
    }
    if (row.role === "user") {
      history.push({ role: "user", content: userTextFromContent(content) });
    } else if (row.role === "assistant") {
      history.push({
        role: "assistant",
        content:
          typeof content.answer === "string"
            ? content.answer
            : typeof content.content === "string"
              ? content.content
              : "",
        parts: Array.isArray(content.parts)
          ? (content.parts as HistoryTurn["parts"])
          : undefined,
      });
    }
  }
  return { history, originalUserText };
}

function failClosedInterrupted(
  db: AppDatabase,
  chatId: string,
  state: ChatTurnState,
  tenantId: string
): void {
  writeChatTurnState(db, chatId, { ...state, status: "interrupted_failed" });
  try {
    completeActiveWorkRunCard({
      db,
      cardId: `run_${chatId}`,
      tenantId,
      outcome: "error",
      summary:
        "Intelligence turn did not recover after a Bridge restart (resume itself was interrupted).",
    });
  } catch {
    /* Active Work card may not exist */
  }
}

async function continueOneTurn(args: {
  db: AppDatabase;
  tenantId: string;
  chatId: string;
  state: ChatTurnState;
}): Promise<void> {
  const handlers = tryGetAiChatTurnHandlers();
  if (!handlers) {
    failClosedInterrupted(args.db, args.chatId, args.state, args.tenantId);
    return;
  }
  const { history, originalUserText } = loadHistoryAndUserText(
    args.db,
    args.chatId,
    args.state.userMessageId
  );
  const message = buildContinueMessage({
    originalUserText,
    checkpoint: args.state.checkpoint,
  });
  const preparedResult = await handlers.prepare(
    {
      user: { id: args.state.userId, isAdmin: false },
      tenantId: args.tenantId,
      tenantRole: "editor",
      tenantDb: args.db,
    },
    {
      chatId: args.chatId,
      agentId: args.state.agentId,
      message,
      history,
      resumeInterrupted: true,
    }
  );
  if (!preparedResult.ok) {
    failClosedInterrupted(args.db, args.chatId, args.state, args.tenantId);
    return;
  }
  const abort = new AbortController();
  await handlers.run(preparedResult.prepared, {
    send: () => undefined,
    sendPing: () => undefined,
    abortSignal: abort.signal,
    isClosed: () => false,
  });
}

/**
 * After listen: fail-closed leftover `resuming`, continue `running` once.
 * Fire-and-forget so boot is not blocked on Cursor.
 */
export async function resumeInterruptedChatTurns(args: {
  tenants: Array<{ tenantId: string; db: AppDatabase }>;
}): Promise<{ resumed: number; failedClosed: number }> {
  let resumed = 0;
  let failedClosed = 0;
  const toResume: Array<{
    tenantId: string;
    db: AppDatabase;
    chatId: string;
    state: ChatTurnState;
  }> = [];
  for (const tenant of args.tenants) {
    for (const hit of listInterruptedChatTurns(tenant.db)) {
      if (hit.state.status === "resuming") {
        failClosedInterrupted(tenant.db, hit.chatId, hit.state, tenant.tenantId);
        failedClosed += 1;
        continue;
      }
      writeChatTurnState(tenant.db, hit.chatId, {
        ...hit.state,
        status: "resuming",
        generation: BRIDGE_BOOT_GENERATION,
      });
      toResume.push({
        tenantId: tenant.tenantId,
        db: tenant.db,
        chatId: hit.chatId,
        state: { ...hit.state, status: "resuming", generation: BRIDGE_BOOT_GENERATION },
      });
    }
  }
  for (const item of toResume) {
    try {
      await continueOneTurn(item);
      resumed += 1;
    } catch (err) {
      console.warn(
        `[chat-turn] resume failed chat=${item.chatId}:`,
        err instanceof Error ? err.message : err
      );
      failClosedInterrupted(item.db, item.chatId, item.state, item.tenantId);
      failedClosed += 1;
    }
  }
  return { resumed, failedClosed };
}

export function tenantDatabasesForChatResume(): Array<{
  tenantId: string;
  db: AppDatabase;
}> {
  return listAllTenantIds(getCloudDb()).map((tenantId) => ({
    tenantId,
    db: getTenantDb(tenantId),
  }));
}
