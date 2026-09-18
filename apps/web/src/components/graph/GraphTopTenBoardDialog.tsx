import { useEffect, useState, useCallback } from "react";
import {
  TrophyIcon,
  MedalIcon,
  SparklesIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchGraphLeaderboard,
  type GraphLeaderboardEntry,
  type GraphLeaderboardTimeframe,
} from "@/api";

const TIMEFRAMES: Array<{ id: GraphLeaderboardTimeframe; label: string }> = [
  { id: "hour", label: "Hour" },
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "decade", label: "Decade" },
  { id: "all", label: "All Time" },
];

function getRankBadge(rank: number) {
  if (rank === 1) {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/15 font-bold text-amber-500 dark:text-amber-400"
      >
        <MedalIcon className="size-3 text-amber-500" />
        #1
      </Badge>
    );
  }
  if (rank === 2) {
    return (
      <Badge
        variant="outline"
        className="border-slate-400/40 bg-slate-400/15 font-semibold text-slate-600 dark:text-slate-300"
      >
        <MedalIcon className="size-3 text-slate-400" />
        #2
      </Badge>
    );
  }
  if (rank === 3) {
    return (
      <Badge
        variant="outline"
        className="border-amber-700/40 bg-amber-700/15 font-semibold text-amber-700 dark:text-amber-500"
      >
        <MedalIcon className="size-3 text-amber-700" />
        #3
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground font-mono">
      #{rank}
    </Badge>
  );
}

export function GraphTopTenBoardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [timeframe, setTimeframe] = useState<GraphLeaderboardTimeframe>("all");
  const [entries, setEntries] = useState<GraphLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadScores = useCallback((tf: GraphLeaderboardTimeframe) => {
    setLoading(true);
    fetchGraphLeaderboard(10, tf)
      .then((res) => {
        setEntries(res.entries);
      })
      .catch(() => {
        setEntries([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    loadScores(timeframe);
  }, [open, timeframe, loadScores]);

  useEffect(() => {
    if (!open) return;
    const onSync = () => loadScores(timeframe);
    window.addEventListener("godmode:graph-missions-changed", onSync);
    return () =>
      window.removeEventListener("godmode:graph-missions-changed", onSync);
  }, [open, timeframe, loadScores]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TrophyIcon className="size-4" />
            </div>
            <div>
              <DialogTitle>Top 10 Board</DialogTitle>
              <DialogDescription>
                Top users and agents across missions and graph orchestration.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Timeframe selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1">
            {TIMEFRAMES.map((tf) => (
              <Button
                key={tf.id}
                type="button"
                size="sm"
                variant={timeframe === tf.id ? "secondary" : "ghost"}
                className={`h-7 px-2.5 text-xs font-medium ${
                  timeframe === tf.id ? "shadow-xs" : ""
                }`}
                onClick={() => setTimeframe(tf.id)}
              >
                {tf.label}
              </Button>
            ))}
          </div>

          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => loadScores(timeframe)}
            disabled={loading}
            aria-label="Refresh leaderboard"
          >
            <RefreshCwIcon
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {/* Board content */}
        <div className="min-h-64">
          {loading && entries.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Loading rankings...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <SparklesIcon className="size-8 text-muted-foreground/50" />
              <p>No scores recorded for this timeframe yet.</p>
              <p className="text-xs text-muted-foreground/80">
                Complete missions on The Graph to earn your place on the board.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>User / Agent</TableHead>
                  <TableHead className="text-center">Missions</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.slice(0, 10).map((entry) => (
                  <TableRow key={entry.userId}>
                    <TableCell>{getRankBadge(entry.rank)}</TableCell>
                    <TableCell className="font-medium">
                      {entry.displayName || "Human"}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {entry.missionsCompleted}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground">
                      {entry.totalPoints.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
