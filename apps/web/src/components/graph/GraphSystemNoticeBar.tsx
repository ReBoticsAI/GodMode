import { useEffect, useState, useMemo } from "react";
import {
  ActivityIcon,
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useAiStatus } from "@/hooks/use-ai-status";
import { useIntelligence } from "@/lib/intelligence-context";
import { fetchNotifications, type AppNotification } from "@/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function formatNoticeTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function GraphSystemNoticeBar({
  onOpenNotifications,
}: {
  onOpenNotifications?: () => void;
}) {
  const { status: aiStatus } = useAiStatus();
  const { notificationsUnread } = useIntelligence();
  const [recentNotifications, setRecentNotifications] = useState<
    AppNotification[]
  >([]);
  const [customNotice, setCustomNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchNotifications({ limit: 3 })
      .then((res) => {
        setRecentNotifications(res.notifications ?? []);
      })
      .catch(() => undefined);
  }, [notificationsUnread]);

  useEffect(() => {
    const onNotice = (ev: Event) => {
      const detail = (ev as CustomEvent<{ message?: string; text?: string }>)
        .detail;
      const text = detail?.message || detail?.text;
      if (text) {
        setCustomNotice(text);
      }
    };
    window.addEventListener("godmode:system-notice", onNotice);
    return () => window.removeEventListener("godmode:system-notice", onNotice);
  }, []);

  const latestNotification = recentNotifications[0] ?? null;

  const { icon, message, badgeText } = useMemo(() => {
    if (customNotice) {
      return {
        icon: <BellIcon className="size-3.5 shrink-0 text-amber-500" />,
        message: customNotice,
        badgeText: "Notice",
      };
    }

    if (aiStatus?.state === "running") {
      const model = aiStatus.modelName || "Local model";
      const tps = aiStatus.tokensPerSecond
        ? ` · ${aiStatus.tokensPerSecond.toFixed(1)} t/s`
        : "";
      return {
        icon: (
          <ActivityIcon className="size-3.5 shrink-0 animate-pulse text-emerald-500" />
        ),
        message: `Inference active: ${model}${tps}`,
        badgeText: "Inference",
      };
    }

    if (aiStatus?.state === "starting") {
      return {
        icon: (
          <ActivityIcon className="size-3.5 shrink-0 animate-spin text-amber-500" />
        ),
        message: `Starting model runtime: ${aiStatus.modelName || "initializing"}...`,
        badgeText: "Starting",
      };
    }

    if (aiStatus?.state === "error") {
      return {
        icon: <ActivityIcon className="size-3.5 shrink-0 text-destructive" />,
        message: `Inference warning: ${aiStatus.error || "Model runtime unreachable"}`,
        badgeText: "Alert",
      };
    }

    if (notificationsUnread > 0 && latestNotification) {
      return {
        icon: <BellIcon className="size-3.5 shrink-0 text-primary" />,
        message: `${latestNotification.title}: ${latestNotification.body || "New alert"}`,
        badgeText: `${notificationsUnread} new`,
      };
    }

    return {
      icon: (
        <ActivityIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ),
      message: "System operational: GodMode universe services ready",
      badgeText: "Online",
    };
  }, [customNotice, aiStatus, notificationsUnread, latestNotification]);

  return (
    <div className="flex w-full max-w-2xl flex-col">
      <div
        role="status"
        aria-live="polite"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex h-7 w-full cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-md border border-border/60 bg-background/80 px-2.5 shadow-sm backdrop-blur-sm transition-colors hover:border-border"
        title="Click to glance recent notifications"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {icon}
          <span className="truncate text-xs text-muted-foreground select-none">
            {message}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Badge
            variant="outline"
            className="h-4 px-1.5 text-[10px] text-muted-foreground"
          >
            {badgeText}
          </Badge>
          {expanded ? (
            <ChevronDownIcon className="size-3 text-muted-foreground/60" />
          ) : (
            <ChevronRightIcon className="size-3 text-muted-foreground/60" />
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-border/60 bg-background/90 p-1.5 shadow-sm backdrop-blur-sm">
            {recentNotifications.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No recent notifications
              </p>
            ) : (
              recentNotifications.slice(0, 3).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenNotifications?.();
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-foreground">
                      {n.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatNoticeTime(n.created_at)}
                    </span>
                  </div>
                  {n.body ? (
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">
                      {n.body}
                    </span>
                  ) : null}
                </button>
              ))
            )}
            <button
              type="button"
              className="mt-0.5 px-2 py-1 text-left text-[11px] font-medium text-primary hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onOpenNotifications?.();
              }}
            >
              Open notifications
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
