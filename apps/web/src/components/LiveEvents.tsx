import { useMemo, useState } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type EventCategory = "orders" | "positions" | "market" | "levels" | "system";

export interface UiEvent {
  id: number;
  ts: number;
  category: EventCategory;
  type: string;
  detail: string;
  raw: unknown;
  ok?: boolean;
}

export const EVENT_BUFFER_CAP = 2000;

const CATEGORY_STYLES: Record<EventCategory, string> = {
  orders: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  positions: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  market: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  levels: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  system: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

// Bridge -> WS broadcasters (apps/bridge/src/ws.ts):
//   orders     order, fill, sc_fill, sc_fill_reset, sc_trade, sc_trade_reset
//   positions  sc_position
//   market     sc_market, master_symbol
//   levels     sc_level, sc_levels_refresh
//   system     status, deployment, data_audit, sc_account, sc_trade_stats,
//              pb_cmd_ack, connected, sc_chart_props, sc_replay_state,
//              sc_drawing, sc_drawings_refresh, ipc (System -> IPC), local

const ORDERS_TYPES = new Set([
  "order",
  "fill",
  "sc_fill",
  "sc_fill_reset",
  "sc_trade",
  "sc_trade_reset",
]);

const POSITIONS_TYPES = new Set(["sc_position"]);

const MARKET_TYPES = new Set([
  "sc_market",
  "sc_quote",
  "sc_tick",
  "sc_ticks",
  "sc_dom",
  "sc_profile",
  "sc_footprint",
  "master_symbol",
]);

const LEVELS_TYPES = new Set(["sc_level", "sc_levels_refresh", "sc_signal"]);

export function categorizeEvent(type: string): EventCategory {
  if (ORDERS_TYPES.has(type)) return "orders";
  if (POSITIONS_TYPES.has(type)) return "positions";
  if (MARKET_TYPES.has(type)) return "market";
  if (LEVELS_TYPES.has(type)) return "levels";
  return "system";
}

export function formatEventDetail(data: unknown, payload?: unknown): string {
  const src =
    data !== undefined && data !== null
      ? data
      : payload !== undefined && payload !== null
        ? payload
        : null;
  if (src === null) return "";
  if (typeof src === "string") return src.slice(0, 140);
  try {
    return JSON.stringify(src).slice(0, 140);
  } catch {
    return String(src).slice(0, 140);
  }
}

export function buildWsEvent(
  id: number,
  msg: { type: string; data?: unknown; payload?: unknown; timestamp?: number }
): UiEvent {
  const type = msg.type;
  const raw = msg.data ?? msg.payload ?? msg;
  let detail = formatEventDetail(msg.data, msg.payload);
  if (!detail && msg.timestamp != null) {
    detail = `at ${new Date(msg.timestamp).toLocaleTimeString()}`;
  }
  return {
    id,
    ts: msg.timestamp ?? Date.now(),
    category: categorizeEvent(type),
    type,
    detail,
    raw,
  };
}

export function buildLocalEvent(
  id: number,
  label: string,
  ok: boolean,
  err?: unknown
): UiEvent {
  return {
    id,
    ts: Date.now(),
    category: "system",
    type: "local",
    detail: ok ? `${label} OK` : `${label} FAIL ${String(err ?? "")}`.slice(0, 140),
    raw: { label, ok, error: err != null ? String(err) : undefined },
    ok,
  };
}

type MainTab = "all" | EventCategory;

interface LiveEventsProps {
  events: UiEvent[];
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  onClear: () => void;
}

function countByCategory(events: UiEvent[]): Record<EventCategory, number> {
  const counts: Record<EventCategory, number> = {
    orders: 0,
    positions: 0,
    market: 0,
    levels: 0,
    system: 0,
  };
  for (const e of events) counts[e.category]++;
  return counts;
}

function filterEvents(
  events: UiEvent[],
  tab: MainTab,
  query: string,
  systemPane: "activity" | "ipc"
): UiEvent[] {
  let list = events;
  if (tab !== "all") {
    list = list.filter((e) => e.category === tab);
    if (tab === "system") {
      list =
        systemPane === "ipc"
          ? list.filter((e) => e.type === "ipc")
          : list.filter((e) => e.type !== "ipc");
    }
  }
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (e) =>
      e.type.toLowerCase().includes(q) ||
      e.detail.toLowerCase().includes(q) ||
      e.category.includes(q)
  );
}

function EventRow({ event }: { event: UiEvent }) {
  const [open, setOpen] = useState(false);
  const isFail = event.ok === false;
  const isOk = event.ok === true;

  return (
    <li className="border-b last:border-0">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
      >
        {isFail ? (
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        ) : isOk ? (
          <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
        ) : (
          <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="w-20 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {new Date(event.ts).toLocaleTimeString()}
        </span>
        <Badge
          variant="outline"
          className={cn("shrink-0 font-mono text-[10px]", CATEGORY_STYLES[event.category])}
        >
          {event.type}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
          {event.detail || "—"}
        </span>
      </button>
      {open && (
        <pre className="max-h-40 overflow-auto border-t bg-muted/30 px-4 py-2 font-mono text-[10px] leading-relaxed text-foreground/80">
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      )}
    </li>
  );
}

function EventList({ items }: { items: UiEvent[] }) {
  if (items.length === 0) {
    return (
      <Empty className="border-0 py-8">
        <EmptyHeader>
          <CircleIcon className="size-6 text-muted-foreground" />
          <EmptyTitle>No matching events</EmptyTitle>
          <EmptyDescription>
            Events will appear here as the bridge streams data.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ScrollArea className="h-72">
      <ul className="flex flex-col">
        {items.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </ul>
    </ScrollArea>
  );
}

function TabCount({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px] tabular-nums">
      {n > 999 ? "999+" : n}
    </Badge>
  );
}

export function LiveEvents({ events, paused, onPausedChange, onClear }: LiveEventsProps) {
  const [mainTab, setMainTab] = useState<MainTab>("all");
  const [systemPane, setSystemPane] = useState<"activity" | "ipc">("activity");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => countByCategory(events), [events]);
  const systemIpcCount = useMemo(
    () => events.filter((e) => e.category === "system" && e.type === "ipc").length,
    [events]
  );
  const systemActivityCount = counts.system - systemIpcCount;

  const filtered = useMemo(
    () => filterEvents(events, mainTab, query, systemPane),
    [events, mainTab, query, systemPane]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Events</CardTitle>
        <CardDescription>
          WebSocket stream from the bridge — tabbed by category. Click a row to expand
          raw JSON.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            variant={paused ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onPausedChange(!paused)}
          >
            {paused ? (
              <PlayIcon data-icon="inline-start" className="size-3.5" />
            ) : (
              <PauseIcon data-icon="inline-start" className="size-3.5" />
            )}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={events.length === 0}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Clear
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0 pt-0">
        <div className="relative px-4">
          <SearchIcon className="absolute top-1/2 left-7 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter type or detail…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 font-mono text-xs"
          />
        </div>

        <Tabs
          value={mainTab}
          onValueChange={(v) => setMainTab((v as MainTab) || "all")}
          className="gap-0"
        >
          <div className="overflow-x-auto px-4 pb-2">
            <TabsList variant="line" className="h-auto w-max min-w-full flex-wrap gap-0.5">
              <TabsTrigger value="all">
                All
                <TabCount n={events.length} />
              </TabsTrigger>
              <TabsTrigger value="orders">
                Orders &amp; Fills
                <TabCount n={counts.orders} />
              </TabsTrigger>
              <TabsTrigger value="positions">
                Positions
                <TabCount n={counts.positions} />
              </TabsTrigger>
              <TabsTrigger value="market">
                Market
                <TabCount n={counts.market} />
              </TabsTrigger>
              <TabsTrigger value="levels">
                Levels
                <TabCount n={counts.levels} />
              </TabsTrigger>
              <TabsTrigger value="system">
                System
                <TabCount n={counts.system} />
              </TabsTrigger>
            </TabsList>
          </div>

          {mainTab === "system" && (
            <div className="flex items-center gap-1 px-4 pb-2">
              <Button
                type="button"
                size="sm"
                variant={systemPane === "activity" ? "secondary" : "ghost"}
                className="h-7 text-xs"
                onClick={() => setSystemPane("activity")}
              >
                Activity
                <TabCount n={systemActivityCount} />
              </Button>
              <Button
                type="button"
                size="sm"
                variant={systemPane === "ipc" ? "secondary" : "ghost"}
                className="h-7 text-xs"
                onClick={() => setSystemPane("ipc")}
              >
                IPC
                <TabCount n={systemIpcCount} />
              </Button>
            </div>
          )}

          {paused && (
            <p className="px-4 pb-2 text-xs text-warning-foreground">
              Paused — new events are buffered and will appear when you resume.
            </p>
          )}
        </Tabs>

        <EventList items={filtered} />
      </CardContent>
    </Card>
  );
}
