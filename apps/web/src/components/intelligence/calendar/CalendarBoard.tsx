import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import {
  createCalendarEvent,
  createUserCalendarEvent,
  deleteCalendarEvent,
  deleteUserCalendarEvent,
  fetchCalendarActivity,
  fetchCalendarEvents,
  fetchUserCalendarActivity,
  fetchUserCalendarEvents,
  updateCalendarEvent,
  updateUserCalendarEvent,
  type AiCalendarEvent,
  type AiCalendarKind,
  type AiProjectCard,
  type AiWorkflowRun,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductivityScope } from "@/lib/productivity-scope";
import { isUserScope, scopeReadOnly } from "@/lib/productivity-scope";
import { cn } from "@/lib/utils";
import {
  CALENDAR_VIEW_KEY,
  LEGACY_CALENDAR_VIEW_KEY,
  readMigratedKey,
  writeMigratedKey,
} from "@/lib/storage-keys";

type CalView = "day" | "week" | "month" | "gantt";

const VIEW_OPTIONS: { value: CalView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "gantt", label: "Gantt" },
];

function loadView(): CalView {
  if (typeof window === "undefined") return "month";
  const v = readMigratedKey(CALENDAR_VIEW_KEY, LEGACY_CALENDAR_VIEW_KEY);
  return v === "day" || v === "week" || v === "month" || v === "gantt" ? v : "month";
}

const HOUR_PX = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_ACCENT: Record<AiCalendarKind, string> = {
  event: "border-l-2 border-sky-500/70 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  task: "border-l-2 border-violet-500/70 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  appointment:
    "border-l-2 border-amber-500/70 bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const KIND_DOT: Record<AiCalendarKind, string> = {
  event: "bg-sky-500",
  task: "bg-violet-500",
  appointment: "bg-amber-500",
};

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function startOfWeek(d: Date): Date {
  const n = startOfDay(d);
  n.setDate(n.getDate() - n.getDay());
  return n;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfMonth(d: Date): Date {
  const n = startOfDay(d);
  n.setDate(1);
  return n;
}

function addMonths(d: Date, n: number): Date {
  const r = startOfMonth(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Convert a Date to the value a native datetime-local input expects. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Parse a stored ISO-ish timestamp; treat naive strings as local time. */
function parseTs(s: string | null | undefined): Date | null {
  if (!s) return null;
  let str = s.trim();
  if (!str) return null;
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC.
  if (str.includes(" ") && !str.includes("T")) str = str.replace(" ", "T") + "Z";
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface ActivityBlock {
  run: AiWorkflowRun;
  start: Date;
  end: Date;
}

export function CalendarBoard({ scope }: { scope: ProductivityScope }) {
  const [view, setViewState] = useState<CalView>(loadView);
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<AiCalendarEvent[]>([]);
  const [runs, setRuns] = useState<AiWorkflowRun[]>([]);
  const [cards, setCards] = useState<AiProjectCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [createOpen, setCreateOpen] = useState(false);
  const [createDefault, setCreateDefault] = useState<Date | null>(null);
  const [editEvent, setEditEvent] = useState<AiCalendarEvent | null>(null);
  const [activity, setActivity] = useState<ActivityBlock | null>(null);
  const [dueCard, setDueCard] = useState<AiProjectCard | null>(null);

  const setView = useCallback((v: CalView) => {
    setViewState(v);
    if (typeof window !== "undefined") {
      writeMigratedKey(CALENDAR_VIEW_KEY, LEGACY_CALENDAR_VIEW_KEY, v);
    }
  }, []);

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const monthGridStart = useMemo(() => startOfWeek(startOfMonth(anchor)), [anchor]);
  const monthDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i)),
    [monthGridStart]
  );

  // The window of time loaded from the API for the active view.
  const viewWindow = useMemo(() => {
    if (view === "day") {
      const from = startOfDay(anchor);
      return { from, to: addDays(from, 1) };
    }
    if (view === "week") {
      return { from: weekStart, to: addDays(weekStart, 7) };
    }
    // month + gantt share the 6-week month grid window
    return { from: monthGridStart, to: addDays(monthGridStart, 42) };
  }, [view, anchor, weekStart, monthGridStart]);

  const range = useMemo(
    () => ({ from: viewWindow.from.toISOString(), to: viewWindow.to.toISOString() }),
    [viewWindow]
  );

  const readOnly = scopeReadOnly(scope);

  const openCreate = useCallback((at?: Date) => {
    setCreateDefault(at ?? null);
    setCreateOpen(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isUserScope(scope)) {
        const [ev, act] = await Promise.all([
          fetchUserCalendarEvents(range, scope.userId),
          fetchUserCalendarActivity(range, scope.userId),
        ]);
        setEvents(ev.events);
        setRuns(act.runs);
        setCards(act.cards);
      } else {
        const [ev, act] = await Promise.all([
          fetchCalendarEvents(scope.agentId, range),
          fetchCalendarActivity(scope.agentId, range),
        ]);
        setEvents(ev.events);
        setRuns(act.runs);
        setCards(act.cards);
      }
    } catch {
      /* surfaced via empty state */
    } finally {
      setLoading(false);
    }
  }, [scope, range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const activityBlocks = useMemo<ActivityBlock[]>(() => {
    return runs
      .map((run) => {
        const start = parseTs(run.started_at) ?? parseTs(run.created_at);
        if (!start) return null;
        const end =
          run.status === "running" || run.status === "awaiting_input"
            ? now
            : parseTs(run.finished_at) ?? parseTs(run.updated_at) ?? now;
        return { run, start, end: end > start ? end : new Date(start.getTime() + 60_000) };
      })
      .filter((b): b is ActivityBlock => b != null);
  }, [runs, now]);

  const rangeLabel = useMemo(() => {
    if (view === "day") {
      return anchor.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    if (view === "month" || view === "gantt") {
      return anchor.toLocaleDateString([], { month: "long", year: "numeric" });
    }
    const end = addDays(weekStart, 6);
    const sameMonth = weekStart.getMonth() === end.getMonth();
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${weekStart.toLocaleDateString([], opts)} – ${end.toLocaleDateString(
      [],
      sameMonth ? { day: "numeric", year: "numeric" } : { ...opts, year: "numeric" }
    )}`;
  }, [anchor, weekStart, view]);

  const navigate = useCallback(
    (dir: 1 | -1) => {
      setAnchor((d) => {
        if (view === "day") return addDays(d, dir);
        if (view === "week") return addDays(d, dir * 7);
        return addMonths(d, dir);
      });
    },
    [view]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous"
            onClick={() => navigate(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next"
            onClick={() => navigate(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
        </div>
        <span className="text-xs font-medium text-foreground">{rangeLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex overflow-hidden rounded-md border border-border">
            {VIEW_OPTIONS.map((opt, i) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setView(opt.value)}
                className={cn(
                  "px-2 py-1 text-[11px]",
                  i > 0 && "border-l border-border",
                  view === opt.value
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={readOnly}
            onClick={() => openCreate()}
          >
            <Plus className="size-3.5" />
            New
          </Button>
        </div>
      </div>

      {view === "day" && (
        <DayView
          day={anchor}
          now={now}
          events={events}
          activity={activityBlocks}
          cards={cards}
          onEvent={setEditEvent}
          onActivity={setActivity}
          onCard={setDueCard}
        />
      )}

      {view === "week" && (
        <WeekView
          days={weekDays}
          events={events}
          activity={activityBlocks}
          cards={cards}
          now={now}
          onEvent={setEditEvent}
          onActivity={setActivity}
          onCard={setDueCard}
        />
      )}

      {view === "month" && (
        <MonthView
          days={monthDays}
          monthAnchor={anchor}
          now={now}
          events={events}
          cards={cards}
          onEvent={setEditEvent}
          onCard={setDueCard}
          onCreate={readOnly ? undefined : openCreate}
        />
      )}

      {view === "gantt" && (
        <GanttView
          from={viewWindow.from}
          to={viewWindow.to}
          now={now}
          events={events}
          activity={activityBlocks}
          onEvent={setEditEvent}
          onActivity={setActivity}
        />
      )}

      {loading && events.length === 0 && (
        <p className="text-center text-[11px] text-muted-foreground">Loading…</p>
      )}

      <EventDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        scope={scope}
        defaultStart={createDefault ?? anchor}
        onSaved={() => {
          setCreateOpen(false);
          void load();
        }}
      />

      <EventDialog
        open={editEvent != null}
        onOpenChange={(o) => !o && setEditEvent(null)}
        scope={scope}
        event={editEvent}
        readOnly={readOnly}
        onSaved={() => {
          setEditEvent(null);
          void load();
        }}
        onDeleted={() => {
          setEditEvent(null);
          void load();
        }}
      />

      <ActivityDialog block={activity} onClose={() => setActivity(null)} />
      <CardDialog card={dueCard} onClose={() => setDueCard(null)} />
    </div>
  );
}

interface ViewProps {
  events: AiCalendarEvent[];
  activity: ActivityBlock[];
  cards: AiProjectCard[];
  onEvent: (e: AiCalendarEvent) => void;
  onActivity: (b: ActivityBlock) => void;
  onCard: (c: AiProjectCard) => void;
}

function WeekView({
  days,
  now,
  events,
  activity,
  cards,
  onEvent,
  onActivity,
  onCard,
}: ViewProps & { days: Date[]; now: Date }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="flex shrink-0 border-b border-border bg-muted/40">
        <div className="w-10 shrink-0" />
        {days.map((d) => {
          const isToday = isSameDay(d, now);
          const allDay = [
            ...events.filter(
              (e) => e.all_day && isSameDay(parseTs(e.start_at) ?? new Date(0), d)
            ),
          ];
          const dayCards = cards.filter((c) =>
            isSameDay(parseTs(c.due_at) ?? new Date(0), d)
          );
          return (
            <div
              key={d.toISOString()}
              className="min-w-0 flex-1 border-l border-border px-1 py-1"
            >
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">
                  {d.toLocaleDateString([], { weekday: "short" })}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    isToday
                      ? "flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white"
                      : "text-foreground"
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {allDay.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onEvent(e)}
                    className={cn(
                      "block w-full truncate rounded px-1 py-0.5 text-left text-[10px]",
                      KIND_ACCENT[e.kind]
                    )}
                  >
                    {e.title}
                  </button>
                ))}
                {dayCards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onCard(c)}
                    className="flex w-full items-center gap-1 truncate rounded bg-rose-500/15 px-1 py-0.5 text-left text-[10px] text-rose-700 dark:text-rose-300"
                  >
                    <ListChecks className="size-2.5 shrink-0" />
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-10 shrink-0">
            {hours.map((h) => (
              <div
                key={h}
                className="relative border-b border-border/40"
                style={{ height: HOUR_PX }}
              >
                <span className="absolute -top-1.5 right-1 text-[9px] text-muted-foreground">
                  {h === 0 ? "" : h <= 12 ? `${h}${h < 12 ? "a" : "p"}` : `${h - 12}p`}
                </span>
              </div>
            ))}
          </div>
          {days.map((d) => (
            <DayColumn
              key={d.toISOString()}
              day={d}
              now={now}
              hours={hours}
              events={events}
              activity={activity}
              onEvent={onEvent}
              onActivity={onActivity}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  now,
  hours,
  events,
  activity,
  onEvent,
  onActivity,
}: {
  day: Date;
  now: Date;
  hours: number[];
  events: AiCalendarEvent[];
  activity: ActivityBlock[];
  onEvent: (e: AiCalendarEvent) => void;
  onActivity: (b: ActivityBlock) => void;
}) {
  const dayStart = startOfDay(day);
  const isToday = isSameDay(day, now);

  const timed = events.filter((e) => {
    if (e.all_day) return false;
    const s = parseTs(e.start_at);
    return s != null && isSameDay(s, day);
  });

  const blocks = activity.filter((b) => {
    return b.start < addDays(dayStart, 1) && b.end > dayStart;
  });

  const posFor = (start: Date, end: Date) => {
    const top = Math.max(0, (start.getTime() - dayStart.getTime()) / DAY_MS) * 24 * HOUR_PX;
    const rawH = ((end.getTime() - start.getTime()) / DAY_MS) * 24 * HOUR_PX;
    return { top, height: Math.max(14, rawH) };
  };

  return (
    <div className="relative min-w-0 flex-1 border-l border-border">
      {hours.map((h) => (
        <div
          key={h}
          className="border-b border-border/40"
          style={{ height: HOUR_PX }}
        />
      ))}

      {blocks.map((b) => {
        const clampedStart = b.start < dayStart ? dayStart : b.start;
        const clampedEnd = b.end > addDays(dayStart, 1) ? addDays(dayStart, 1) : b.end;
        const { top, height } = posFor(clampedStart, clampedEnd);
        const running = b.run.status === "running" || b.run.status === "awaiting_input";
        return (
          <button
            key={b.run.id}
            type="button"
            onClick={() => onActivity(b)}
            style={{ top, height }}
            className={cn(
              "absolute right-0.5 left-0.5 overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-[9px]",
              running
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : b.run.status === "failed"
                  ? "border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                  : "border-muted-foreground/60 bg-muted text-muted-foreground"
            )}
          >
            <span className="flex items-center gap-0.5 truncate font-medium">
              <Clock className="size-2.5 shrink-0" />
              {b.run.workflow_name ?? "Run"}
            </span>
          </button>
        );
      })}

      {timed.map((e) => {
        const s = parseTs(e.start_at)!;
        const end = parseTs(e.end_at) ?? new Date(s.getTime() + 30 * 60_000);
        const { top, height } = posFor(s, end);
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onEvent(e)}
            style={{ top, height }}
            className={cn(
              "absolute right-0.5 left-7 overflow-hidden rounded px-1 py-0.5 text-left text-[9px]",
              KIND_ACCENT[e.kind]
            )}
          >
            <span className="block truncate font-medium">{e.title}</span>
            <span className="block truncate opacity-80">{fmtTime(s)}</span>
          </button>
        );
      })}

      {isToday && (
        <div
          className="pointer-events-none absolute right-0 left-0 z-10 border-t border-rose-500"
          style={{ top: ((now.getTime() - dayStart.getTime()) / DAY_MS) * 24 * HOUR_PX }}
        >
          <span className="absolute -top-1 -left-1 size-2 rounded-full bg-rose-500" />
        </div>
      )}
    </div>
  );
}

function DayView({
  day,
  now,
  events,
  activity,
  cards,
  onEvent,
  onActivity,
  onCard,
}: ViewProps & { day: Date; now: Date }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const allDay = events.filter(
    (e) => e.all_day && isSameDay(parseTs(e.start_at) ?? new Date(0), day)
  );
  const dayCards = cards.filter((c) => isSameDay(parseTs(c.due_at) ?? new Date(0), day));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      {(allDay.length > 0 || dayCards.length > 0) && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-border bg-muted/40 px-2 py-1">
          {allDay.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onEvent(e)}
              className={cn(
                "truncate rounded px-1.5 py-0.5 text-left text-[10px]",
                KIND_ACCENT[e.kind]
              )}
            >
              {e.title}
            </button>
          ))}
          {dayCards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onCard(c)}
              className="flex items-center gap-1 truncate rounded bg-rose-500/15 px-1.5 py-0.5 text-left text-[10px] text-rose-700 dark:text-rose-300"
            >
              <ListChecks className="size-2.5 shrink-0" />
              <span className="truncate">{c.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-10 shrink-0">
            {hours.map((h) => (
              <div
                key={h}
                className="relative border-b border-border/40"
                style={{ height: HOUR_PX }}
              >
                <span className="absolute -top-1.5 right-1 text-[9px] text-muted-foreground">
                  {h === 0 ? "" : h <= 12 ? `${h}${h < 12 ? "a" : "p"}` : `${h - 12}p`}
                </span>
              </div>
            ))}
          </div>
          <DayColumn
            day={day}
            now={now}
            hours={hours}
            events={events}
            activity={activity}
            onEvent={onEvent}
            onActivity={onActivity}
          />
        </div>
      </div>
    </div>
  );
}

function MonthView({
  days,
  monthAnchor,
  now,
  events,
  cards,
  onEvent,
  onCard,
  onCreate,
}: {
  days: Date[];
  monthAnchor: Date;
  now: Date;
  events: AiCalendarEvent[];
  cards: AiProjectCard[];
  onEvent: (e: AiCalendarEvent) => void;
  onCard: (c: AiProjectCard) => void;
  onCreate?: (at: Date) => void;
}) {
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  const MAX_CHIPS = 3;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="grid shrink-0 grid-cols-7 border-b border-border bg-muted/40">
        {days.slice(0, 7).map((d) => (
          <div
            key={d.getDay()}
            className="px-1 py-1 text-center text-[10px] uppercase text-muted-foreground"
          >
            {d.toLocaleDateString([], { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6 overflow-y-auto">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((d) => {
              const inMonth = isSameMonth(d, monthAnchor);
              const isToday = isSameDay(d, now);
              const dayEvents = events
                .filter((e) => isSameDay(parseTs(e.start_at) ?? new Date(0), d))
                .sort((a, b) => {
                  const ta = parseTs(a.start_at)?.getTime() ?? 0;
                  const tb = parseTs(b.start_at)?.getTime() ?? 0;
                  return ta - tb;
                });
              const dayCards = cards.filter((c) =>
                isSameDay(parseTs(c.due_at) ?? new Date(0), d)
              );
              const chips: { id: string; node: ReactNode }[] = [];
              for (const e of dayEvents) {
                chips.push({
                  id: `e-${e.id}`,
                  node: (
                    <button
                      key={`e-${e.id}`}
                      type="button"
                      onClick={() => onEvent(e)}
                      className={cn(
                        "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px]",
                        KIND_ACCENT[e.kind]
                      )}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", KIND_DOT[e.kind])} />
                      {!e.all_day && (
                        <span className="shrink-0 tabular-nums opacity-70">
                          {fmtTime(parseTs(e.start_at) ?? d)}
                        </span>
                      )}
                      <span className="truncate">{e.title}</span>
                    </button>
                  ),
                });
              }
              for (const c of dayCards) {
                chips.push({
                  id: `c-${c.id}`,
                  node: (
                    <button
                      key={`c-${c.id}`}
                      type="button"
                      onClick={() => onCard(c)}
                      className="flex w-full items-center gap-1 truncate rounded bg-rose-500/15 px-1 py-0.5 text-left text-[10px] text-rose-700 dark:text-rose-300"
                    >
                      <ListChecks className="size-2.5 shrink-0" />
                      <span className="truncate">{c.title}</span>
                    </button>
                  ),
                });
              }
              const shown = chips.slice(0, MAX_CHIPS);
              const extra = chips.length - shown.length;
              return (
                <div
                  key={d.toISOString()}
                  onClick={onCreate ? () => onCreate(d) : undefined}
                  className={cn(
                    "flex min-h-0 flex-col gap-0.5 border-t border-l border-border p-1",
                    wi === 0 && "border-t-0",
                    onCreate && "cursor-pointer hover:bg-muted/40",
                    !inMonth && "bg-muted/20"
                  )}
                >
                  <span
                    className={cn(
                      "ml-auto text-[10px]",
                      isToday
                        ? "flex size-4 items-center justify-center rounded-full bg-emerald-500 font-medium text-white"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground"
                    )}
                  >
                    {d.getDate()}
                  </span>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {shown.map((c) => c.node)}
                    {extra > 0 && (
                      <span className="px-1 text-[9px] text-muted-foreground">+{extra} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

interface GanttRow {
  key: string;
  label: string;
  start: Date;
  end: Date;
  className: string;
  onClick: () => void;
}

function GanttView({
  from,
  to,
  now,
  events,
  activity,
  onEvent,
  onActivity,
}: {
  from: Date;
  to: Date;
  now: Date;
  events: AiCalendarEvent[];
  activity: ActivityBlock[];
  onEvent: (e: AiCalendarEvent) => void;
  onActivity: (b: ActivityBlock) => void;
}) {
  const spanMs = Math.max(1, to.getTime() - from.getTime());
  const dayCount = Math.round(spanMs / DAY_MS);
  const ticks = Array.from({ length: dayCount + 1 }, (_, i) => addDays(from, i)).filter(
    (d) => d.getDay() === 0 || d.getDate() === 1
  );

  const rows: GanttRow[] = [];
  for (const e of events) {
    const s = parseTs(e.start_at);
    if (!s) continue;
    const end =
      parseTs(e.end_at) ?? new Date(s.getTime() + (e.all_day ? DAY_MS : 60 * 60_000));
    rows.push({
      key: `e-${e.id}`,
      label: e.title,
      start: s,
      end,
      className: KIND_ACCENT[e.kind],
      onClick: () => onEvent(e),
    });
  }
  for (const b of activity) {
    const running = b.run.status === "running" || b.run.status === "awaiting_input";
    rows.push({
      key: `a-${b.run.id}`,
      label: b.run.workflow_name ?? "Workflow run",
      start: b.start,
      end: b.end,
      className: running
        ? "border-l-2 border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        : b.run.status === "failed"
          ? "border-l-2 border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300"
          : "border-l-2 border-muted-foreground/60 bg-muted text-muted-foreground",
      onClick: () => onActivity(b),
    });
  }
  rows.sort((a, b) => a.start.getTime() - b.start.getTime());

  const pct = (d: Date) =>
    Math.min(100, Math.max(0, ((d.getTime() - from.getTime()) / spanMs) * 100));
  const nowInRange = now >= from && now <= to;

  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-border text-center text-muted-foreground">
        <CalendarDays className="size-8 opacity-50" />
        <p className="text-xs">No events or activity in this range.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="flex shrink-0 border-b border-border bg-muted/40">
        <div className="w-32 shrink-0 border-r border-border px-2 py-1 text-[10px] font-medium text-muted-foreground">
          Item
        </div>
        <div className="relative h-6 flex-1">
          {ticks.map((t) => (
            <span
              key={t.toISOString()}
              className="absolute top-1 -translate-x-1/2 text-[9px] text-muted-foreground"
              style={{ left: `${pct(t)}%` }}
            >
              {t.toLocaleDateString([], { month: "short", day: "numeric" })}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((r) => {
          const left = pct(r.start < from ? from : r.start);
          const right = pct(r.end > to ? to : r.end);
          const width = Math.max(1.5, right - left);
          return (
            <div key={r.key} className="flex items-center border-b border-border/40">
              <div className="w-32 shrink-0 truncate border-r border-border px-2 py-1 text-[10px] text-foreground">
                {r.label}
              </div>
              <div className="relative h-6 flex-1">
                {ticks.map((t) => (
                  <span
                    key={t.toISOString()}
                    className="absolute inset-y-0 border-l border-border/30"
                    style={{ left: `${pct(t)}%` }}
                  />
                ))}
                {nowInRange && (
                  <span
                    className="absolute inset-y-0 z-10 border-l border-rose-500"
                    style={{ left: `${pct(now)}%` }}
                  />
                )}
                <button
                  type="button"
                  onClick={r.onClick}
                  title={r.label}
                  className={cn(
                    "absolute top-1 bottom-1 overflow-hidden rounded px-1 text-left text-[9px]",
                    r.className
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  <span className="block truncate leading-4">{r.label}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventDialog({
  open,
  onOpenChange,
  scope,
  event,
  defaultStart,
  readOnly = false,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scope: ProductivityScope;
  event?: AiCalendarEvent | null;
  defaultStart?: Date;
  readOnly?: boolean;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const [kind, setKind] = useState<AiCalendarKind>("event");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (event) {
      setKind(event.kind);
      setTitle(event.title);
      setDescription(event.description ?? "");
      const s = parseTs(event.start_at);
      setStart(s ? toLocalInput(s) : "");
      const e = parseTs(event.end_at);
      setEnd(e ? toLocalInput(e) : "");
      setAllDay(event.all_day === 1);
      setLocation(event.location ?? "");
    } else {
      const base = defaultStart ? new Date(defaultStart) : new Date();
      base.setMinutes(0, 0, 0);
      if (base < new Date()) base.setHours(new Date().getHours() + 1, 0, 0, 0);
      setKind("event");
      setTitle("");
      setDescription("");
      setStart(toLocalInput(base));
      setEnd(toLocalInput(new Date(base.getTime() + 60 * 60_000)));
      setAllDay(false);
      setLocation("");
    }
  }, [open, event, defaultStart]);

  const save = async () => {
    if (!title.trim() || !start) return;
    setBusy(true);
    try {
      const startIso = new Date(start).toISOString();
      const endIso = end ? new Date(end).toISOString() : undefined;
      if (event) {
        if (isUserScope(scope)) {
          await updateUserCalendarEvent(event.id, {
            kind,
            title: title.trim(),
            description: description.trim() || null,
            start_at: startIso,
            end_at: endIso ?? null,
            all_day: allDay,
            location: location.trim() || null,
          });
        } else {
          await updateCalendarEvent(event.id, {
            kind,
            title: title.trim(),
            description: description.trim() || null,
            start_at: startIso,
            end_at: endIso ?? null,
            all_day: allDay,
            location: location.trim() || null,
            agentId: scope.agentId,
          });
        }
      } else if (isUserScope(scope)) {
        await createUserCalendarEvent({
          kind,
          title: title.trim(),
          description: description.trim() || undefined,
          start_at: startIso,
          end_at: endIso,
          all_day: allDay,
          location: location.trim() || undefined,
        });
      } else {
        await createCalendarEvent({
          agentId: scope.agentId,
          kind,
          title: title.trim(),
          description: description.trim() || undefined,
          start_at: startIso,
          end_at: endIso,
          all_day: allDay,
          location: location.trim() || undefined,
        });
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    setBusy(true);
    try {
      if (isUserScope(scope)) {
        await deleteUserCalendarEvent(event.id);
      } else {
        await deleteCalendarEvent(event.id, scope.agentId);
      }
      onDeleted?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {event ? "Edit event" : "New event"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isUserScope(scope)
              ? "Schedule an item on your personal calendar."
              : "Schedule an item on this agent's calendar."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as AiCalendarKind)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="event">Event</SelectItem>
                <SelectItem value="task">Task</SelectItem>
                <SelectItem value="appointment">Appointment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cal-title" className="text-xs">
              Title
            </Label>
            <Input
              id="cal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="h-8 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="size-3.5 accent-emerald-500"
            />
            All day
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Start</Label>
              <Input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">End</Label>
              <Input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cal-loc" className="text-xs">
              Location
            </Label>
            <Input
              id="cal-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional"
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cal-desc" className="text-xs">
              Description
            </Label>
            <Textarea
              id="cal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="min-h-[56px] text-xs"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {event && onDeleted ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
              disabled={busy || readOnly}
              onClick={() => void remove()}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy || readOnly || !title.trim() || !start}
              onClick={() => void save()}
            >
              {event ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActivityDialog({
  block,
  onClose,
}: {
  block: ActivityBlock | null;
  onClose: () => void;
}) {
  const run = block?.run;
  let result: string | null = null;
  if (run?.result_json) {
    try {
      result = JSON.stringify(JSON.parse(run.result_json), null, 2);
    } catch {
      result = run.result_json;
    }
  }
  return (
    <Dialog open={block != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {run?.workflow_name ?? "Workflow run"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Read-only view of this agent work execution.
          </DialogDescription>
        </DialogHeader>
        {run && block && (
          <div className="flex max-h-[55vh] flex-col gap-2 overflow-auto text-xs">
            <DetailRow label="Status" value={run.status} />
            <DetailRow
              label="Started"
              value={block.start.toLocaleString()}
            />
            <DetailRow
              label="Ended"
              value={
                run.status === "running" || run.status === "awaiting_input"
                  ? "running…"
                  : block.end.toLocaleString()
              }
            />
            {run.card_id && <DetailRow label="Card" value={run.card_id} />}
            <DetailRow label="Workflow" value={run.workflow_id} />
            {run.trigger_input && (
              <div className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Trigger
                </span>
                <pre className="overflow-auto rounded-md bg-muted p-2 text-[10px]">
                  {run.trigger_input}
                </pre>
              </div>
            )}
            {run.error && (
              <div className="grid gap-1">
                <span className="text-[11px] font-medium text-destructive">Error</span>
                <pre className="overflow-auto rounded-md bg-destructive/10 p-2 text-[10px] text-destructive">
                  {run.error}
                </pre>
              </div>
            )}
            {result && (
              <div className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Result
                </span>
                <pre className="overflow-auto rounded-md bg-muted p-2 text-[10px]">
                  {result}
                </pre>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CardDialog({
  card,
  onClose,
}: {
  card: AiProjectCard | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={card != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{card?.title ?? "Task"}</DialogTitle>
          <DialogDescription className="text-xs">
            Assigned task with a due date.
          </DialogDescription>
        </DialogHeader>
        {card && (
          <div className="flex flex-col gap-2 text-xs">
            {card.due_at && (
              <DetailRow
                label="Due"
                value={parseTs(card.due_at)?.toLocaleString() ?? card.due_at}
              />
            )}
            {card.status && <DetailRow label="Status" value={card.status} />}
            {card.priority != null && (
              <DetailRow label="Priority" value={String(card.priority)} />
            )}
            {card.description && (
              <div className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Description
                </span>
                <p className="whitespace-pre-wrap text-foreground">{card.description}</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-right text-foreground">{value}</span>
    </div>
  );
}
