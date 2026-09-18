import { useEffect, useState, useMemo } from "react";
import {
  ActivityIcon,
  BellIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useAiStatus } from "@/hooks/use-ai-status";
import { useIntelligence } from "@/lib/intelligence-context";
import { fetchNotifications, type AppNotification } from "@/api";
import { Badge } from "@/components/ui/badge";

export function GraphSystemNoticeBar({
  onOpenNotifications,
}: {
  onOpenNotifications?: () => void;
}) {
  const { status: aiStatus } = useAiStatus();
  const { notificationsUnread } = useIntelligence();
  const [latestNotification, setLatestNotification] =
    useState<AppNotification | null>(null);
  const [customNotice, setCustomNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchNotifications({ limit: 1 })
      .then((res) => {
        if (res.notifications && res.notifications.length > 0) {
          setLatestNotification(res.notifications[0]);
        }
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
        icon: <ActivityIcon className="size-3.5 shrink-0 text-emerald-500 animate-pulse" />,
        message: `Inference active: ${model}${tps}`,
        badgeText: "Inference",
      };
    }

    if (aiStatus?.state === "starting") {
      return {
        icon: <ActivityIcon className="size-3.5 shrink-0 text-amber-500 animate-spin" />,
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
      icon: <ActivityIcon className="size-3.5 shrink-0 text-muted-foreground" />,
      message: "System operational: GodMode universe services ready",
      badgeText: "Online",
    };
  }, [customNotice, aiStatus, notificationsUnread, latestNotification]);

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onOpenNotifications}
      className="flex h-7 w-full max-w-2xl cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-md border border-border/60 bg-background/80 px-2.5 shadow-sm backdrop-blur-sm transition-colors hover:border-border"
      title="Click to view notifications and activity"
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
        <ChevronRightIcon className="size-3 text-muted-foreground/60" />
      </div>
    </div>
  );
}
