/**
 * Structured message "parts" that let an assistant turn interleave streamed
 * text, collapsible reasoning, tool-call cards and a live todo list — the way
 * Cursor's agent chat renders a turn. The streaming handler in IntelligencePanel
 * builds these incrementally from SSE events; ChatTurn renders them.
 */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id?: string;
  content: string;
  status: TodoStatus;
  /** Nested steps from todo_write (persisted in message parts JSON). */
  subtasks?: TodoItem[];
}

export type KanbanTodoCard = {
  title: string;
  column_id: string;
  status: string | null;
};

/** Parent + nested subtasks for display. */
export function flattenTodosForDisplay(items: TodoItem[]): TodoItem[] {
  const out: TodoItem[] = [];
  for (const item of items) {
    out.push({
      id: item.id,
      content: item.content,
      status: item.status,
    });
    for (const sub of item.subtasks ?? []) {
      out.push({
        id: sub.id,
        content: sub.content,
        status: sub.status,
      });
    }
  }
  return out;
}

function kanbanRowToTodoStatus(
  columnId: string,
  cardStatus: string | null
): TodoStatus {
  if (columnId === "done" || cardStatus === "accepted" || cardStatus === "done")
    return "completed";
  if (cardStatus === "cancelled") return "cancelled";
  if (columnId === "in_progress" || cardStatus === "working") return "in_progress";
  return "pending";
}

/** Overlay live Kanban column/status onto frozen chat todo parts. */
export function mergeTodoItemsWithKanban(
  items: TodoItem[],
  cards: KanbanTodoCard[]
): TodoItem[] {
  const byTitle = new Map<string, KanbanTodoCard>();
  for (const c of cards) {
    byTitle.set(c.title.trim().toLowerCase(), c);
  }
  const mergeOne = (item: TodoItem): TodoItem => {
    const card = byTitle.get(item.content.trim().toLowerCase());
    const mergedSubs = item.subtasks?.map(mergeOne);
    if (!card) {
      return mergedSubs ? { ...item, subtasks: mergedSubs } : item;
    }
    return {
      ...item,
      status: kanbanRowToTodoStatus(card.column_id, card.status),
      ...(mergedSubs ? { subtasks: mergedSubs } : {}),
    };
  };
  return items.map(mergeOne);
}

export function displayTodoItems(
  items: TodoItem[],
  kanbanCards?: KanbanTodoCard[]
): TodoItem[] {
  const merged = kanbanCards?.length
    ? mergeTodoItemsWithKanban(items, kanbanCards)
    : items;
  return flattenTodosForDisplay(merged);
}

export type ToolStatus =
  | "running"
  | "awaiting_confirm"
  | "done"
  | "error"
  | "denied";

export type MsgPart =
  | { kind: "thinking"; text: string; startedAt: number; endedAt?: number }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      result?: unknown;
      startedAt: number;
      endedAt?: number;
      terminalStream?: string;
    }
  | { kind: "todos"; items: TodoItem[] };

const THINK_MARKERS: Array<{ s: string; e: string }> = [
  { s: "<think>", e: "</think>" },
  { s: "<thinking>", e: "</thinking>" },
  { s: "<|channel>thought\n", e: "<channel|>" },
];

/**
 * Split a (possibly still-streaming) raw model string into reasoning vs answer.
 * Handles `<think>`/`<thinking>` tags, the Gemma `<|channel>thought` channel,
 * the leading `<|think|>` prefix, and an OPEN thinking block with no close yet
 * (everything after the open marker is treated as live reasoning).
 */
export function splitThinking(raw: string): {
  thinking: string;
  answer: string;
  thinkingActive: boolean;
} {
  const stripped = raw.replace(/^<\|think\|>\s*/i, "");
  let answer = "";
  let thinking = "";
  let active = false;
  let i = 0;
  while (i < stripped.length) {
    let next: { idx: number; mk: { s: string; e: string } } | null = null;
    for (const mk of THINK_MARKERS) {
      const idx = stripped.indexOf(mk.s, i);
      if (idx >= 0 && (!next || idx < next.idx)) next = { idx, mk };
    }
    if (!next) {
      answer += stripped.slice(i);
      break;
    }
    answer += stripped.slice(i, next.idx);
    const afterStart = next.idx + next.mk.s.length;
    const endIdx = stripped.indexOf(next.mk.e, afterStart);
    if (endIdx < 0) {
      thinking += stripped.slice(afterStart);
      active = true;
      break;
    }
    thinking += stripped.slice(afterStart, endIdx) + "\n";
    i = endIdx + next.mk.e.length;
  }
  return { thinking: thinking.trim(), answer: answer.trim(), thinkingActive: active };
}

/** Rough token estimate (~4 chars/token) for a live context meter. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/** Tool ids/names like "create_division" -> "Create division". */
export function prettifyToolName(name: string): string {
  const cleaned = name.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return name;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Tools whose name signals a todo-list write. */
export function isTodoTool(name: string): boolean {
  return name === "todo_write" || name === "update_todos" || name === "write_todos";
}

/** Coerce arbitrary tool args into a todo list. */
export function todosFromArgs(args: Record<string, unknown>): TodoItem[] {
  const raw = (args.todos ?? args.items ?? args.tasks) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t): TodoItem | null => {
      if (typeof t === "string") return { content: t, status: "pending" };
      if (t && typeof t === "object") {
        const o = t as Record<string, unknown>;
        const content = String(o.content ?? o.title ?? o.task ?? "").trim();
        if (!content) return null;
        const status = String(o.status ?? "pending") as TodoStatus;
        return {
          id: o.id != null ? String(o.id) : undefined,
          content,
          status: [
            "pending",
            "in_progress",
            "completed",
            "cancelled",
          ].includes(status)
            ? status
            : "pending",
        };
      }
      return null;
    })
    .filter((t): t is TodoItem => t != null);
}

/** Flatten parts into plain text (for token estimation and history). */
export function partsToPlainText(parts: MsgPart[] | undefined): string {
  if (!parts) return "";
  return parts
    .map((p) => {
      if (p.kind === "text") return p.text;
      if (p.kind === "thinking") return p.text;
      if (p.kind === "todos")
        return p.items.map((t) => `- [${t.status}] ${t.content}`).join("\n");
      if (p.kind === "tool")
        return `${p.name}(${JSON.stringify(p.args)})`;
      return "";
    })
    .join("\n");
}

/** Just the answer text of a turn (used to seed conversation history). */
export function partsAnswerText(parts: MsgPart[] | undefined): string {
  if (!parts) return "";
  return parts
    .filter((p): p is Extract<MsgPart, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}

/**
 * Incremental builder that turns ordered SSE events (token / tool_call /
 * tool_result) into a parts array. Text between tool calls is its own segment
 * so reasoning and answer split correctly per segment.
 */
export class PartsBuilder {
  private committed: MsgPart[] = [];
  private segRaw = "";
  private reasoningRaw = "";
  private thinkingStartedAt: number | null = null;

  private deriveSegment(finalize: boolean): MsgPart[] {
    const out: MsgPart[] = [];
    const { thinking, answer, thinkingActive } = splitThinking(this.segRaw);
    const combinedThinking = [this.reasoningRaw, thinking].filter(Boolean).join("\n").trim();
    if (combinedThinking) {
      if (this.thinkingStartedAt == null) this.thinkingStartedAt = Date.now();
      const done = finalize || (!thinkingActive && !this.reasoningRaw);
      out.push({
        kind: "thinking",
        text: combinedThinking,
        startedAt: this.thinkingStartedAt,
        endedAt: done ? Date.now() : undefined,
      });
    }
    if (answer) out.push({ kind: "text", text: answer });
    return out;
  }

  private commitSegment(): void {
    const seg = this.deriveSegment(true);
    this.committed.push(...seg);
    this.segRaw = "";
    this.reasoningRaw = "";
    this.thinkingStartedAt = null;
  }

  onToken(content: string): void {
    this.segRaw += content;
  }

  onReasoning(content: string): void {
    this.reasoningRaw += content;
    if (this.thinkingStartedAt == null) this.thinkingStartedAt = Date.now();
  }

  onToolCallDelta(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): void {
    const tool = [...this.committed]
      .reverse()
      .find(
        (p): p is Extract<MsgPart, { kind: "tool" }> =>
          p.kind === "tool" && p.id === id
      );
    if (tool) {
      tool.args = args;
      tool.name = name;
    } else {
      this.onToolCall(name, args, id);
    }
  }

  onToolCall(name: string, args: Record<string, unknown>, id: string): void {
    this.commitSegment();
    if (isTodoTool(name)) {
      const items = todosFromArgs(args);
      const existing = this.committed.find(
        (p): p is Extract<MsgPart, { kind: "todos" }> => p.kind === "todos"
      );
      if (existing) existing.items = items;
      else this.committed.push({ kind: "todos", items });
      return;
    }
    this.committed.push({
      kind: "tool",
      id,
      name,
      args,
      status: "running",
      startedAt: Date.now(),
    });
  }

  onToolConfirmRequired(id: string): void {
    const tool = [...this.committed]
      .reverse()
      .find(
        (p): p is Extract<MsgPart, { kind: "tool" }> =>
          p.kind === "tool" && p.id === id
      );
    if (tool) tool.status = "awaiting_confirm";
  }

  markToolRunning(id: string): void {
    const tool = [...this.committed]
      .reverse()
      .find(
        (p): p is Extract<MsgPart, { kind: "tool" }> =>
          p.kind === "tool" && p.id === id
      );
    if (tool && tool.status === "awaiting_confirm") tool.status = "running";
  }

  onTerminalOutput(
    id: string,
    stream: "stdout" | "stderr",
    text: string
  ): void {
    const tool = [...this.committed]
      .reverse()
      .find(
        (p): p is Extract<MsgPart, { kind: "tool" }> =>
          p.kind === "tool" && p.id === id
      );
    if (!tool) return;
    const prefix = stream === "stderr" ? "[stderr] " : "";
    tool.terminalStream = (tool.terminalStream ?? "") + prefix + text;
  }

  onToolResult(id: string, result: unknown, isError: boolean): void {
    const tool = [...this.committed]
      .reverse()
      .find(
        (p): p is Extract<MsgPart, { kind: "tool" }> =>
          p.kind === "tool" && p.id === id
      );
    if (tool) {
      tool.result = result;
      const declined =
        isError &&
        result &&
        typeof result === "object" &&
        (result as { error?: string }).error === "User declined tool execution";
      tool.status = declined ? "denied" : isError ? "error" : "done";
      tool.endedAt = Date.now();
    }
  }

  /** Current snapshot = committed parts + the live (uncommitted) segment. */
  snapshot(): MsgPart[] {
    return [...this.committed, ...this.deriveSegment(false)];
  }

  finalize(): MsgPart[] {
    this.commitSegment();
    for (const p of this.committed) {
      if (
        p.kind === "tool" &&
        (p.status === "running" || p.status === "awaiting_confirm")
      ) {
        p.status = p.status === "awaiting_confirm" ? "denied" : "done";
        p.endedAt = Date.now();
      }
    }
    return this.committed;
  }
}
