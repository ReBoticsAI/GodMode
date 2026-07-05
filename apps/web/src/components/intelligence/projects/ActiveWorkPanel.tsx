import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  ExternalLink,
  FlaskConical,
  ListTree,
  Loader2,
} from "lucide-react";
import {
  fetchAiProjects,
  fetchCardComments,
  fetchCardSubtasks,
  getActiveTenantId,
  type AiCardComment,
  type AiProjectCard,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ActivityComment = AiCardComment & { cardTitle?: string };

interface ActiveTask {
  parent: AiProjectCard;
  subtasks: AiProjectCard[];
  timeline: ActivityComment[];
}

interface AutoMeta {
  autoTicks: number;
  maxTaskTicks: number;
  noProgressTicks: number;
}

interface AwaitingMeta {
  kind: string;
  refId: string;
  terminalStatus?: string;
  resumeReady?: boolean;
  totalTrades?: number | null;
  netPnl?: number | null;
}

function parseContext(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readAuto(card: AiProjectCard): AutoMeta | null {
  const ctx = parseContext(card.context_json);
  const auto = ctx.__auto as Partial<AutoMeta> | undefined;
  if (!auto) return null;
  return {
    autoTicks: Number(auto.autoTicks ?? 0),
    maxTaskTicks: Number(auto.maxTaskTicks ?? 18),
    noProgressTicks: Number(auto.noProgressTicks ?? 0),
  };
}

function readAwaiting(card: AiProjectCard): AwaitingMeta | null {
  const ctx = parseContext(card.context_json);
  const a = ctx.__awaiting as Partial<AwaitingMeta> | undefined;
  if (!a || !a.kind || !a.refId) return null;
  return {
    kind: String(a.kind),
    refId: String(a.refId),
    terminalStatus: a.terminalStatus != null ? String(a.terminalStatus) : undefined,
    resumeReady: a.resumeReady === true,
    totalTrades: a.totalTrades ?? null,
    netPnl: a.netPnl ?? null,
  };
}

function isSubtaskDone(c: AiProjectCard): boolean {
  return (
    c.column_id === "done" ||
    c.status === "accepted" ||
    c.status === "done" ||
    c.status === "cancelled"
  );
}

function isTerminalParent(c: AiProjectCard): boolean {
  return (
    c.column_id === "done" ||
    c.status === "accepted" ||
    c.status === "done" ||
    c.status === "cancelled"
  );
}

function isActiveSubtask(c: AiProjectCard): boolean {
  return c.status === "working" || (c.column_id === "in_progress" && !isSubtaskDone(c));
}

function isActiveParent(c: AiProjectCard): boolean {
  if (isTerminalParent(c)) return false;
  return (
    c.column_id === "in_progress" ||
    c.status === "working" ||
    c.status === "blocked" ||
    readAwaiting(c) != null
  );
}

function shortTime(iso: string): string {
  // DB stores UTC like "2026-06-15 20:51:11"; render local HH:MM.
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const COMMENT_KIND_BADGE: Record<string, string> = {
  action: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  result: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  issue: "bg-amber-500/15 text-amber-500 border-amber-500/30",
};

function TaskCard({
  task,
  onOpenBoard,
}: {
  task: ActiveTask;
  onOpenBoard?: () => void;
}) {
  const { parent, subtasks, timeline } = task;
  const auto = readAuto(parent);
  const awaiting =
    readAwaiting(parent) ?? subtasks.map(readAwaiting).find(Boolean) ?? null;
  const total = subtasks.length;
  const done = subtasks.filter(isSubtaskDone).length;
  const activeSub = subtasks.find(isActiveSubtask);
  const blocked = parent.status === "blocked";
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the activity feed pinned to the newest entry, Cursor-style.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  const backtestRunning =
    awaiting?.kind === "backtest" && !awaiting.terminalStatus && !awaiting.resumeReady;
  const backtestAwaiting =
    awaiting?.kind === "backtest" && (awaiting.terminalStatus || awaiting.resumeReady);

  return (
    <div className="rounded-md border bg-card/60 p-2">
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0 font-medium leading-tight">{parent.title}</span>
        {onOpenBoard && (
          <button
            type="button"
            title="Open in Automations board"
            onClick={onOpenBoard}
            className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
        {blocked && (
          <Badge
            variant="outline"
            className="h-4 gap-0.5 border-amber-500/50 bg-amber-500/15 px-1 text-[8px] font-semibold text-amber-500"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            BLOCKED
          </Badge>
        )}
        {total > 0 && (
          <span className="inline-flex items-center gap-0.5" title="Phase progress">
            <ListTree className="h-2.5 w-2.5" />
            {done}/{total} phases
          </span>
        )}
        {backtestRunning && (
          <span className="inline-flex items-center gap-0.5 text-sky-400" title="Backtest in flight">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            backtest running
          </span>
        )}
        {backtestAwaiting && (
          <span className="inline-flex items-center gap-0.5 text-emerald-400" title="Backtest finished — awaiting resume">
            <FlaskConical className="h-2.5 w-2.5" />
            backtest {awaiting?.terminalStatus ?? "done"}
            {awaiting?.totalTrades != null ? ` · ${awaiting.totalTrades} trades` : ""}
          </span>
        )}
        {auto && auto.autoTicks > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 tabular-nums",
              auto.autoTicks >= auto.maxTaskTicks && "text-amber-500"
            )}
            title="Autonomous work-turn budget used"
          >
            <Activity className="h-2.5 w-2.5" />
            {auto.autoTicks}/{auto.maxTaskTicks} ticks
          </span>
        )}
        {auto && auto.autoTicks === 0 && total > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-sky-400/90"
            title="Work is driven by this chat session; autonomous tick budget is unused"
          >
            <CircleDot className="h-2.5 w-2.5" />
            in chat
          </span>
        )}
      </div>

      {total > 0 && (
        <>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-muted">
            <div
              className={cn(
                "h-full transition-all",
                blocked ? "bg-amber-500" : "bg-emerald-500"
              )}
              style={{ width: `${total ? (done / total) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {subtasks.map((s) => {
              const sdone = isSubtaskDone(s);
              const sactive = isActiveSubtask(s);
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]",
                    sactive && "bg-primary/10"
                  )}
                >
                  {sdone ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                  ) : sactive ? (
                    <CircleDot className="h-3 w-3 shrink-0 animate-pulse text-primary" />
                  ) : (
                    <Circle className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "truncate",
                      sdone && "text-muted-foreground line-through",
                      sactive && "font-medium"
                    )}
                  >
                    {s.title}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeSub && (
        <div className="mt-1.5 truncate text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">Now:</span> {activeSub.title}
        </div>
      )}

      {/* Cursor-style streaming activity timeline (parent + subtask comments). */}
      <div className="mt-2 border-t pt-1.5">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          Activity
        </div>
        <div ref={scrollRef} className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {timeline.length === 0 && (
            <span className="text-[10px] text-muted-foreground">No activity yet.</span>
          )}
          {timeline.map((c) => (
            <div key={c.id} className="flex flex-col rounded bg-muted/40 px-1.5 py-1 text-[11px]">
              <div className="flex items-center gap-1 text-[8px] uppercase opacity-70">
                <span className="font-semibold">{c.author}</span>
                {c.kind && (
                  <span
                    className={cn(
                      "rounded border px-1 font-medium",
                      COMMENT_KIND_BADGE[c.kind] ?? "border-border bg-background/60"
                    )}
                  >
                    {c.kind}
                  </span>
                )}
                {c.cardTitle && c.cardTitle !== parent.title && (
                  <span className="truncate rounded bg-background/60 px-1 font-medium normal-case">
                    {c.cardTitle}
                  </span>
                )}
                <span className="ml-auto tabular-nums opacity-80">
                  {shortTime(c.created_at)}
                </span>
              </div>
              <span className="mt-0.5 whitespace-pre-wrap leading-snug text-foreground/90">
                {c.body}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Live "Active Work" view for the agent instance behind the current chat
 * session. Surfaces the in-progress task card(s), their phase subtasks, and a
 * streaming activity timeline (merged card comments = the audit log). Scopes by
 * the session's `chatId` (cards linked via todo_write) and falls back to the
 * agent's active auto tasks when the session has no linked cards yet.
 */
export function ActiveWorkPanel({
  agentId,
  chatId,
  onOpenBoard,
}: {
  agentId: string;
  chatId: string | null;
  onOpenBoard?: () => void;
}) {
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const loadingRef = useRef(false);
  const reloadQueuedRef = useRef(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    if (loadingRef.current) {
      reloadQueuedRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      const { cards } = await fetchAiProjects(agentId);
      const parents = cards.filter((c) => !c.parent_card_id);
      // Prefer cards linked to THIS chat session (one agent instance); else
      // fall back to the agent's active auto tasks so a fresh session that has
      // not created todos yet still shows what the agent is working on.
      const hasChatParents = chatId
        ? parents.some((c) => c.linked_chat_id === chatId)
        : false;
      let active = chatId
        ? parents.filter((c) => c.linked_chat_id === chatId && isActiveParent(c))
        : [];
      if (active.length === 0 && !hasChatParents) {
        active = parents.filter(isActiveParent);
      }
      active = active
        .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2))
        .slice(0, 5);

      const detail = await Promise.all(
        active.map(async (parent) => {
          const subtasks = await fetchCardSubtasks(parent.id)
            .then((r) => r.subtasks)
            .catch(() => [] as AiProjectCard[]);
          const parentComments = await fetchCardComments(parent.id)
            .then((r) =>
              r.comments.map((c) => ({ ...c, cardTitle: parent.title }))
            )
            .catch(() => [] as ActivityComment[]);
          const subComments = (
            await Promise.all(
              subtasks.map((s) =>
                fetchCardComments(s.id)
                  .then((r) => r.comments.map((c) => ({ ...c, cardTitle: s.title })))
                  .catch(() => [] as ActivityComment[])
              )
            )
          ).flat();
          const timeline = [...parentComments, ...subComments].sort((a, b) =>
            a.created_at.localeCompare(b.created_at)
          );
          return { parent, subtasks, timeline } satisfies ActiveTask;
        })
      );
      setTasks(detail);
    } catch {
      setTasks([]);
    } finally {
      loadingRef.current = false;
      if (reloadQueuedRef.current) {
        reloadQueuedRef.current = false;
        void load();
      }
    }
  }, [agentId, chatId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling backstop so the panel never looks "dead" even if a WS ping is
  // missed (e.g. an insert site that doesn't broadcast).
  useEffect(() => {
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [load]);

  // Live WS: the bridge broadcasts `card_activity` to the tenant room whenever a
  // card comment is appended or a card changes. Refetch (debounced) on receipt.
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const tenantId = getActiveTenantId();
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    let sock: WebSocket | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      sock = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
    } catch {
      return;
    }
    sock.onopen = () => {
      if (tenantId) {
        sock?.send(
          JSON.stringify({ type: "join_room", room: `tenant:${tenantId}` })
        );
      }
    };
    sock.onmessage = (ev) => {
      let msg: { type?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "card_activity") {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void load(), 400);
      }
    };
    return () => {
      if (debounce) clearTimeout(debounce);
      try {
        if (sock && sock.readyState <= 1) sock.close();
      } catch {
        /* ignore */
      }
    };
  }, [load]);

  const summary = useMemo(() => {
    if (tasks.length === 0) return "";
    const first = tasks[0].parent.title;
    return tasks.length > 1 ? `${first} +${tasks.length - 1} more` : first;
  }, [tasks]);

  if (tasks.length === 0) return null;

  return (
    <div className="shrink-0 border-b bg-muted/20">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Active work
        <span className="rounded bg-muted px-1 text-[9px] tabular-nums">
          {tasks.length}
        </span>
        {collapsed && summary && (
          <span className="truncate font-normal text-foreground/70">— {summary}</span>
        )}
      </button>
      {!collapsed && (
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto px-2 pb-2 text-xs">
          {tasks.map((t) => (
            <TaskCard key={t.parent.id} task={t} onOpenBoard={onOpenBoard} />
          ))}
        </div>
      )}
    </div>
  );
}
