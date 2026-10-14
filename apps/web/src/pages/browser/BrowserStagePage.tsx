import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GlobeIcon,
  PauseIcon,
  PlayIcon,
  HandIcon,
  SquareIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import {
  ApiError,
  browserSessionClose,
  browserSessionSetMode,
  fetchBrowserFrame,
  fetchBrowserSessions,
  fetchBrowserStatus,
  type BrowserSession,
} from "@/api";
import { toast } from "sonner";

type Props = { embedded?: boolean };

export default function BrowserStagePage({ embedded }: Props) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [denyMessage, setDenyMessage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null,
    [sessions, activeId]
  );

  const refreshSessions = useCallback(async () => {
    try {
      const status = await fetchBrowserStatus();
      setAllowed(status.allowed);
      setDenyMessage(status.message);
      if (!status.allowed) {
        setSessions([]);
        setLoading(false);
        return;
      }
      const res = await fetchBrowserSessions();
      setSessions(res.sessions);
      setActiveId((prev) => {
        if (prev && res.sessions.some((s) => s.id === prev)) return prev;
        return res.sessions[0]?.id ?? null;
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const t = window.setInterval(() => void refreshSessions(), 2500);
    return () => window.clearInterval(t);
  }, [refreshSessions]);

  useEffect(() => {
    if (!active?.id || !allowed) {
      setFrameSrc(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const { frame } = await fetchBrowserFrame(active.id);
        if (cancelled) return;
        setFrameSrc(`data:${frame.mimeType};base64,${frame.dataBase64}`);
      } catch {
        /* no frame yet */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 700);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [active?.id, allowed]);

  const setMode = async (mode: "agent" | "paused" | "human") => {
    if (!active) return;
    try {
      await browserSessionSetMode(active.id, mode);
      await refreshSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  };

  const stopSession = async () => {
    if (!active) return;
    try {
      await browserSessionClose(active.id);
      setFrameSrc(null);
      await refreshSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  };

  const body = (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {allowed === false ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Browser stage unavailable</EmptyTitle>
            <EmptyDescription>
              {denyMessage ??
                "Use GodMode Local desktop for Browser sessions. Cloud is gated until disposable browser jobs land."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading Browser stage…</p>
      ) : sessions.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No browser sessions</EmptyTitle>
            <EmptyDescription>
              Ask Intelligence (or an Agent) to call browser_session_create. A
              supervised Chromium window opens here so you can watch, pause, or
              take over.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <GlobeIcon data-icon="inline-start" />
              {active?.title || active?.url || "Session"}
            </Badge>
            <Badge variant="outline">{active?.mode}</Badge>
            <span className="text-xs text-muted-foreground">
              {active?.stepCount}/{active?.maxSteps} steps
            </span>
            <div className="ms-auto flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refreshSessions()}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!active || active.mode === "paused"}
                onClick={() => void setMode("paused")}
              >
                <PauseIcon data-icon="inline-start" />
                Pause
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!active || active.mode === "human"}
                onClick={() => void setMode("human")}
              >
                <HandIcon data-icon="inline-start" />
                Take over
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!active || active.mode === "agent"}
                onClick={() => void setMode("agent")}
              >
                <PlayIcon data-icon="inline-start" />
                Resume
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!active}
                onClick={() => void stopSession()}
              >
                <SquareIcon data-icon="inline-start" />
                Stop
              </Button>
            </div>
          </div>
          {sessions.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {sessions.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant={s.id === active?.id ? "default" : "ghost"}
                  onClick={() => setActiveId(s.id)}
                >
                  {s.url || s.id.slice(0, 8)}
                </Button>
              ))}
            </div>
          ) : null}
          <div
            className={cn(
              "relative min-h-[280px] flex-1 overflow-hidden rounded-lg border bg-muted/30",
              active?.mode === "human" && "ring-2 ring-primary"
            )}
          >
            {frameSrc ? (
              <img
                src={frameSrc}
                alt="Browser session live view"
                className="size-full object-contain object-top"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                Waiting for first frame…
              </div>
            )}
            {active?.mode === "human" ? (
              <div className="absolute inset-x-0 bottom-0 bg-primary/90 px-3 py-2 text-center text-xs text-primary-foreground">
                Human take-over. Agent actions are blocked until you Resume.
                Drive the Chromium window on your desktop if it is visible
                (headful), or Resume to let the Agent continue.
              </div>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {active?.url}
          </p>
        </>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <Page>
      <PageHeader
        title="Browser"
        description="Watch and take over Agent browser sessions (Local desktop)."
      />
      {body}
    </Page>
  );
}
