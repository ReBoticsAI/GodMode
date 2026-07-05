import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface DeltaPoint {
  value: number;
  ts?: number;
}

interface DeltaStripProps {
  points: DeltaPoint[];
  className?: string;
}

export function DeltaStrip({ points, className }: DeltaStripProps) {
  const { path, latest, trend } = useMemo(() => {
    if (points.length < 2) {
      const v = points[0]?.value ?? 0;
      return { path: "", latest: v, trend: 0 };
    }
    const vals = points.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const w = 100;
    const h = 8;
    const coords = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    });
    const latest = vals[vals.length - 1]!;
    const prev = vals[vals.length - 2] ?? latest;
    return {
      path: `M ${coords.join(" L ")}`,
      latest,
      trend: latest - prev,
    };
  }, [points]);

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b bg-muted/20 px-3 py-1",
        className
      )}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Cum Δ
      </span>
      <svg
        viewBox="0 0 100 8"
        className="h-2 flex-1 min-w-0 text-emerald-500"
        preserveAspectRatio="none"
        aria-hidden
      >
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <span
        className={cn(
          "font-mono text-[11px] tabular-nums",
          trend >= 0 ? "text-emerald-500" : "text-red-500"
        )}
      >
        {latest >= 0 ? "+" : ""}
        {Math.round(latest).toLocaleString()}
        {trend !== 0 && (
          <span className="ml-0.5 opacity-70">{trend > 0 ? "▲" : "▼"}</span>
        )}
      </span>
    </div>
  );
}
