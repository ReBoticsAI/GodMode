import { useEffect, useMemo, useState } from "react";
import {
  EyeIcon,
  RadioIcon,
  UsersIcon,
  BotIcon,
} from "lucide-react";
import {
  fetchActiveAgents,
  fetchAiAgents,
  type AiAgent,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ObservationLine = {
  id: string;
  label: string;
  detail: string;
};

/**
 * Top-chrome observation strip: live glance at agents, people, and workspace
 * activity beside the system notice banner.
 */
export function GraphObservationBar({
  className,
}: {
  className?: string;
}) {
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      void Promise.all([
        fetchAiAgents().catch(() => ({ agents: [] as AiAgent[] })),
        fetchActiveAgents().catch(() => ({ activeAgentIds: [] as string[] })),
      ]).then(([listed, active]) => {
        if (cancelled) return;
        setAgents(listed.agents ?? []);
        setActiveIds(active.activeAgentIds ?? []);
      });
    };
    pull();
    const timer = window.setInterval(pull, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onActivity = () => setPulse((n) => n + 1);
    window.addEventListener("godmode:system-notice", onActivity);
    window.addEventListener("godmode:mission-awarded", onActivity);
    window.addEventListener("godmode:graph-unlock", onActivity);
    return () => {
      window.removeEventListener("godmode:system-notice", onActivity);
      window.removeEventListener("godmode:mission-awarded", onActivity);
      window.removeEventListener("godmode:graph-unlock", onActivity);
    };
  }, []);

  const lines = useMemo(() => {
    const out: ObservationLine[] = [];
    const activeSet = new Set(activeIds);
    const working = agents.filter((a) => activeSet.has(a.id));
    const idle = agents.filter((a) => !activeSet.has(a.id));

    if (working.length > 0) {
      out.push({
        id: "working",
        label: "Agents",
        detail:
          working.length === 1
            ? `${working[0].name || working[0].id} is working`
            : `${working.length} agents working: ${working
                .slice(0, 3)
                .map((a) => a.name || a.id)
                .join(", ")}`,
      });
    } else if (agents.length > 0) {
      out.push({
        id: "agents-idle",
        label: "Agents",
        detail: `${agents.length} agents ready · none running`,
      });
    } else {
      out.push({
        id: "agents-empty",
        label: "Agents",
        detail: "No agents listed in this workspace yet",
      });
    }

    out.push({
      id: "people",
      label: "People",
      detail:
        idle.length > 0
          ? `You · Hub · ${Math.min(idle.length, 3)} agents idle nearby`
          : "You · Hub presence on The Graph",
    });

    out.push({
      id: "workspace",
      label: "Workspace",
      detail:
        pulse > 0
          ? "Fresh activity landed on Graph / missions"
          : "Watching Structure, Vaults, and Automations",
    });

    return out;
  }, [agents, activeIds, pulse]);

  const primary = lines[0] ?? {
    id: "default",
    label: "Observe",
    detail: "Observation dashboard warming up",
  };
  const secondary = lines.slice(1);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Workspace observation dashboard"
      className={cn(
        "flex h-7 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-md border border-border/60 bg-background/80 px-2.5 shadow-sm backdrop-blur-sm",
        className
      )}
      title={lines.map((l) => `${l.label}: ${l.detail}`).join(" · ")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <EyeIcon className="size-3.5 shrink-0 text-sky-500" />
        <span className="truncate text-xs text-muted-foreground select-none">
          <span className="font-medium text-foreground/80">{primary.label}:</span>{" "}
          {primary.detail}
          {secondary.length > 0 ? (
            <span className="text-muted-foreground/70">
              {" · "}
              {secondary.map((l) => l.detail).join(" · ")}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {activeIds.length > 0 ? (
          <Badge
            variant="outline"
            className="h-4 gap-1 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
          >
            <RadioIcon className="size-2.5 animate-pulse" />
            {activeIds.length} live
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="h-4 gap-1 px-1.5 text-[10px] text-muted-foreground"
          >
            <BotIcon className="size-2.5" />
            Idle
          </Badge>
        )}
        <UsersIcon className="size-3 text-muted-foreground/60" />
      </div>
    </div>
  );
}
