import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import {
  clearNotifications,
  deleteNotification,
  fetchNotifications,
  markNotificationsRead,
  type AppNotification,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIntelligence } from "@/lib/intelligence-context";

function timeAgo(iso: string): string {
  const then = new Date(iso.includes("Z") ? iso : `${iso}Z`).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const CATEGORY_TONE: Record<string, string> = {
  dm: "bg-blue-500/15 text-blue-400",
  hook: "bg-amber-500/15 text-amber-400",
  support: "bg-violet-500/15 text-violet-400",
  share: "bg-emerald-500/15 text-emerald-400",
  system: "bg-muted text-muted-foreground",
};

export function NotificationsList({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { refreshNotificationsUnread } = useIntelligence();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchNotifications({ limit: 100 });
      setItems(res.notifications);
    } finally {
      setLoading(false);
    }
    void refreshNotificationsUnread();
  }, [refreshNotificationsUnread]);

  useEffect(() => {
    void load();
  }, [load]);

  const onClickItem = useCallback(
    async (n: AppNotification) => {
      if (!n.read_at) {
        await markNotificationsRead({ ids: [n.id] }).catch(() => undefined);
        setItems((prev) =>
          prev.map((it) =>
            it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it
          )
        );
        void refreshNotificationsUnread();
      }
      if (n.link) navigate(n.link);
    },
    [navigate, refreshNotificationsUnread]
  );

  const markAll = useCallback(async () => {
    await markNotificationsRead({ all: true }).catch(() => undefined);
    setItems((prev) =>
      prev.map((it) => ({ ...it, read_at: it.read_at ?? new Date().toISOString() }))
    );
    void refreshNotificationsUnread();
  }, [refreshNotificationsUnread]);

  const removeOne = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      await deleteNotification(id).catch(() => undefined);
      void refreshNotificationsUnread();
    },
    [refreshNotificationsUnread]
  );

  const clearAll = useCallback(async () => {
    await clearNotifications({}).catch(() => undefined);
    setItems([]);
    void refreshNotificationsUnread();
  }, [refreshNotificationsUnread]);

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void markAll()}
            disabled={unread === 0}
          >
            Mark all read
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => void clearAll()}
            disabled={items.length === 0}
          >
            Clear all
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((n) => (
              <li key={n.id} className="group relative">
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeOne(n.id);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void onClickItem(n)}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-md border px-3 py-2 pr-7 text-left transition-colors hover:bg-accent/50",
                    n.read_at
                      ? "border-transparent bg-transparent"
                      : "border-primary/30 bg-primary/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {!n.read_at && (
                      <span className="size-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <span
                      className={cn(
                        "truncate text-sm",
                        n.read_at ? "font-normal" : "font-semibold"
                      )}
                    >
                      {n.title}
                    </span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "ml-auto shrink-0 text-[10px]",
                        CATEGORY_TONE[n.category] ?? CATEGORY_TONE.system
                      )}
                    >
                      {n.category}
                    </Badge>
                  </div>
                  {n.body && !compact && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {timeAgo(n.created_at)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
