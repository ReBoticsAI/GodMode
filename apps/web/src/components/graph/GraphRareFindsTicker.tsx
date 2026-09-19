import { useState, useEffect, useId } from "react";
import { Badge } from "@/components/ui/badge";

export type RareFindRarity =
  | "common"
  | "rare"
  | "epic"
  | "mythic"
  | "legendary";

export interface RareFindItem {
  id: string;
  title: string;
  rarity: RareFindRarity;
  points?: number;
  timestamp?: string;
}

const INITIAL_RARE_FINDS: RareFindItem[] = [
  {
    id: "rf-1",
    title: "Cosmic Router: Zero-latency neural sync across universe",
    rarity: "legendary",
    points: 500,
  },
  {
    id: "rf-2",
    title: "Agent Vault Citadel: Hardware isolation barrier verified",
    rarity: "mythic",
    points: 350,
  },
  {
    id: "rf-3",
    title: "Digital You Synthesis: Multi-agent persona clone synchronized",
    rarity: "epic",
    points: 200,
  },
  {
    id: "rf-4",
    title: "Intelligence Hub: Local inference engine running",
    rarity: "rare",
    points: 100,
  },
  {
    id: "rf-5",
    title: "Quantum Memory Shard: Autonomous vector recall initialized",
    rarity: "mythic",
    points: 300,
  },
  {
    id: "rf-6",
    title: "Workflow Automations Engine: Cross-agent state machine deployed",
    rarity: "epic",
    points: 220,
  },
  {
    id: "rf-7",
    title: "Knowledge Graph Index: 10k semantic entities clustered",
    rarity: "rare",
    points: 120,
  },
  {
    id: "rf-8",
    title: "Heartbeat Ping: WebSocket IPC channel connected",
    rarity: "common",
    points: 25,
  },
  {
    id: "rf-9",
    title: "Graph Workspace Root: 3D canvas topology active",
    rarity: "common",
    points: 30,
  },
  {
    id: "rf-10",
    title: "Sovereign Kernel: Personal OS fully decentralized",
    rarity: "legendary",
    points: 1000,
  },
];

function getRarityStyle(rarity: RareFindRarity) {
  switch (rarity) {
    case "legendary":
      return {
        badgeClass:
          "border-rose-500/40 bg-rose-500/15 text-rose-500 dark:text-rose-400 font-bold tracking-wide",
        textClass: "text-foreground font-medium",
        label: "LEGENDARY",
      };
    case "mythic":
      return {
        badgeClass:
          "border-amber-500/40 bg-amber-500/15 text-amber-500 dark:text-amber-400 font-semibold tracking-wide",
        textClass: "text-foreground/90 font-medium",
        label: "MYTHIC",
      };
    case "epic":
      return {
        badgeClass:
          "border-purple-500/40 bg-purple-500/15 text-purple-500 dark:text-purple-400 font-medium",
        textClass: "text-foreground/90",
        label: "EPIC",
      };
    case "rare":
      return {
        badgeClass:
          "border-sky-500/40 bg-sky-500/15 text-sky-500 dark:text-sky-400 font-medium",
        textClass: "text-foreground/80",
        label: "RARE",
      };
    case "common":
    default:
      return {
        badgeClass:
          "border-slate-400/40 bg-slate-400/15 text-slate-600 dark:text-slate-300 font-medium",
        textClass: "text-muted-foreground",
        label: "COMMON",
      };
  }
}

export function GraphRareFindsTicker({
  onOpenLeaderboard,
}: {
  onOpenLeaderboard?: () => void;
}) {
  const [items, setItems] = useState<RareFindItem[]>(INITIAL_RARE_FINDS);
  const [isPaused, setIsPaused] = useState(false);
  const animationName = useId().replace(/[:]/g, "_");

  useEffect(() => {
    const onUnlock = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        title?: string;
        rarity?: RareFindRarity;
        points?: number;
      }>).detail;
      if (!detail?.title) return;

      let rarity = detail.rarity;
      if (!rarity) {
        const pts = detail.points ?? 0;
        if (pts >= 400) rarity = "legendary";
        else if (pts >= 250) rarity = "mythic";
        else if (pts >= 150) rarity = "epic";
        else if (pts >= 50) rarity = "rare";
        else rarity = "common";
      }

      const newItem: RareFindItem = {
        id: `rf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: detail.title,
        rarity,
        points: detail.points,
      };

      setItems((prev) => [newItem, ...prev.slice(0, 19)]);
    };

    window.addEventListener("godmode:graph-unlock", onUnlock);
    window.addEventListener("godmode:mission-awarded", onUnlock);
    return () => {
      window.removeEventListener("godmode:graph-unlock", onUnlock);
      window.removeEventListener("godmode:mission-awarded", onUnlock);
    };
  }, []);

  const displayItems = [...items, ...items];

  return (
    <div className="relative flex h-8 w-full items-center overflow-hidden rounded-md border border-border/60 bg-background/80 px-2 shadow-sm backdrop-blur-sm">
      <style>{`
        @keyframes ticker_${animationName} {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
      `}</style>

      <div
        className="flex h-full w-full cursor-pointer items-center overflow-hidden"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onClick={() => onOpenLeaderboard?.()}
        title="Click to view Top 10 Board"
      >
        <div
          className="flex shrink-0 items-center gap-6 whitespace-nowrap will-change-transform"
          style={{
            animation: `ticker_${animationName} 45s linear infinite`,
            animationPlayState: isPaused ? "paused" : "running",
          }}
        >
          {displayItems.map((item, idx) => {
            const style = getRarityStyle(item.rarity);
            return (
              <div
                key={`${item.id}-${idx}`}
                className="inline-flex items-center gap-1.5 text-xs select-none"
              >
                <Badge
                  variant="outline"
                  className={`h-4.5 px-1.5 py-0 text-[10px] ${style.badgeClass}`}
                >
                  {style.label}
                </Badge>
                <span className={style.textClass}>{item.title}</span>
                {item.points ? (
                  <span className="font-mono text-[10px] font-semibold text-emerald-500 dark:text-emerald-400">
                    +{item.points}
                  </span>
                ) : null}
                <span className="text-muted-foreground/40">•</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
