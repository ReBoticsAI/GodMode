import { useCallback, useEffect, useState } from "react";
import { TrophyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  completeGraphMission,
  fetchGraphLeaderboard,
  fetchGraphMissions,
  syncGraphMissions,
  type GraphLeaderboardEntry,
  type GraphMissionView,
  type GraphMissionsStatus,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { toast } from "sonner";

const NODE_LABELS: Record<string, string> = {
  "hub:you": "You",
  "hub:intelligence": "Intelligence",
  "hub:heart": "Hub",
  "hub:vault-you": "User Vault",
  "hub:vault-platform": "Platform Vault",
  "hub:admin": "Admin",
  "hub:wiki": "Wiki",
  "hub:coding": "Coding",
  "hub:releases": "Releases",
  "hub:settings": "Settings",
  "hub:agents": "Agents",
  "hub:users": "Profile",
  "hub:vault-intelligence": "Intelligence Vault",
  "hub:workspace": "Workspaces",
  "hub:structure-you": "Your Structure",
  "hub:knowledge-you": "Your Knowledge",
  "hub:automations-you": "Your Automations",
  "hub:calendar-you": "Your Calendar",
  "hub:chat-you": "Your Chat",
  "hub:structure-intelligence": "Intelligence Structure",
  "hub:knowledge-intelligence": "Intelligence Knowledge",
  "hub:automations-intelligence": "Intelligence Automations",
  "hub:calendar-intelligence": "Intelligence Calendar",
  "hub:chat-intelligence": "Intelligence Chat",
  "vault:llm": "LLM keys",
};

function nodeLabel(nodeId: string): string {
  return NODE_LABELS[nodeId] ?? nodeId.replace(/^hub:/, "");
}

export function GraphNodeMissionsSection({
  nodeId,
  onChanged,
}: {
  nodeId: string;
  onChanged?: () => void;
}) {
  const { authenticated } = useTenant();
  const [status, setStatus] = useState<GraphMissionsStatus | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchGraphMissions();
      setStatus(next);
      if (next.autoAwarded?.length) {
        for (const a of next.autoAwarded) {
          toast.success(`+${a.points} points`);
        }
        onChanged?.();
      }
    } catch {
      setStatus(null);
    }
  }, [onChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh, nodeId]);

  useEffect(() => {
    const onSync = () => {
      void refresh();
    };
    window.addEventListener("godmode:graph-missions-changed", onSync);
    window.addEventListener("godmode:user-chat-sent", onSync);
    return () => {
      window.removeEventListener("godmode:graph-missions-changed", onSync);
      window.removeEventListener("godmode:user-chat-sent", onSync);
    };
  }, [refresh]);

  const forNode = (status?.missions ?? []).filter((m) => m.nodeId === nodeId);
  if (forNode.length === 0 && nodeId !== "hub:you") return null;

  const nodeScore = status?.scoreByNode?.[nodeId];

  const claim = async (mission: GraphMissionView) => {
    if (!authenticated) {
      window.dispatchEvent(new CustomEvent("godmode:open-auth"));
      toast.message("Sign in to claim mission points");
      return;
    }
    setBusyId(mission.id);
    try {
      const result = await completeGraphMission(mission.id);
      if (result.alreadyDone) {
        toast.message("Mission already complete");
      } else {
        toast.success(`+${result.pointsAwarded} points`);
      }
      await refresh();
      onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not complete mission"
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Missions
      </p>
      {status ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            Total score:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {status.totalPoints} pts
            </span>{" "}
            · {status.missionsCompleted} completed
          </p>
          {nodeScore ? (
            <p>
              This node:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {nodeScore.earned} / {nodeScore.available} pts
              </span>
              {nodeScore.open > 0
                ? ` · ${nodeScore.open} open`
                : " · all clear"}
            </p>
          ) : null}
        </div>
      ) : null}
      {forNode.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {forNode.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-border/60 bg-muted/30 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{m.title}</span>
                    <Badge variant={m.done ? "secondary" : "destructive"}>
                      {m.done ? `+${m.points} done` : `${m.points} pts`}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {m.description}
                  </p>
                </div>
                {!m.done ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === m.id}
                    onClick={() => void claim(m)}
                  >
                    Complete
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Full scorecard: every node mission row. Shown on You. */
export function GraphScoreboardSection() {
  const [status, setStatus] = useState<GraphMissionsStatus | null>(null);

  useEffect(() => {
    void fetchGraphMissions()
      .then(setStatus)
      .catch(() => setStatus(null));
    const onSync = () => {
      void fetchGraphMissions()
        .then(setStatus)
        .catch(() => setStatus(null));
    };
    window.addEventListener("godmode:graph-missions-changed", onSync);
    window.addEventListener("godmode:user-chat-sent", onSync);
    return () => {
      window.removeEventListener("godmode:graph-missions-changed", onSync);
      window.removeEventListener("godmode:user-chat-sent", onSync);
    };
  }, []);

  if (!status) return null;

  const nodeIds = Object.keys(status.scoreByNode ?? {}).sort((a, b) => {
    const ea = status.scoreByNode?.[a]?.earned ?? 0;
    const eb = status.scoreByNode?.[b]?.earned ?? 0;
    return eb - ea || a.localeCompare(b);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TrophyIcon className="size-4 text-muted-foreground" />
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Your scorecard
        </p>
      </div>
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{status.totalPoints}</span>{" "}
        total points · {status.missionsCompleted} / {status.missions.length}{" "}
        missions
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Node</TableHead>
            <TableHead className="text-right">Earned</TableHead>
            <TableHead className="text-right">Available</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodeIds.map((id) => {
            const row = status.scoreByNode![id]!;
            return (
              <TableRow key={id}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {nodeLabel(id)}
                    {row.open > 0 ? (
                      <Badge variant="destructive" className="text-[10px]">
                        {row.open}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.earned}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.available}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ul className="flex flex-col gap-1.5">
        {status.missions.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="min-w-0 truncate text-muted-foreground">
              {nodeLabel(m.nodeId)} · {m.title}
            </span>
            <Badge variant={m.done ? "secondary" : "outline"}>
              {m.done ? `+${m.points}` : `${m.points} open`}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GraphLeaderboardSection() {
  const [entries, setEntries] = useState<GraphLeaderboardEntry[]>([]);

  useEffect(() => {
    void fetchGraphLeaderboard(25)
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TrophyIcon className="size-4 text-muted-foreground" />
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Global leaderboard
        </p>
      </div>
      {entries.length === 0 ? (
        <Empty className="border-0 p-4">
          <EmptyHeader>
            <EmptyTitle>No scores published yet</EmptyTitle>
            <EmptyDescription>
              Complete missions while signed in to Cloud.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Human</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.userId}>
                <TableCell>{e.rank}</TableCell>
                <TableCell>{e.displayName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.totalPoints}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** After a chat turn, sync auto-missions (Meet Intelligence, etc.). */
export async function syncMissionsAfterChat(): Promise<void> {
  try {
    const result = await syncGraphMissions();
    for (const a of result.awarded) {
      toast.success(`+${a.points} points`);
    }
    window.dispatchEvent(new CustomEvent("godmode:graph-missions-changed"));
  } catch {
    window.dispatchEvent(new CustomEvent("godmode:user-chat-sent"));
  }
}
