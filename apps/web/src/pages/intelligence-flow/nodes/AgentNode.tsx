import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BotIcon, CrownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { AgentNodeData } from "../orgchart";
import { CollapseToggle } from "./CollapseToggle";

export function AgentNode({ id, data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const Icon = d.isRoot ? CrownIcon : BotIcon;
  return (
    <div
      className={cn(
        "relative min-w-[180px] max-w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-shadow",
        d.isRoot ? "border-amber-500/50" : "border-sky-500/40",
        selected && "ring-2 ring-primary"
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-2" />
      {d.hasChildren && (
        <CollapseToggle
          nodeId={id}
          collapsed={Boolean(d.collapsed)}
          childCount={d.childCount}
        />
      )}
      <div className="flex items-center gap-1.5">
        <Icon className={cn("size-4 shrink-0", d.isRoot ? "text-amber-500" : "text-muted-foreground")} />
        <span className="truncate text-xs font-semibold">{d.name}</span>
        {d.isRoot && (
          <Badge variant="secondary" className="ml-auto text-[9px]">
            root
          </Badge>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        {d.team ? (
          <Badge variant="outline" className="text-[9px]">
            {d.team}
          </Badge>
        ) : (
          <span className="capitalize">{d.backend}</span>
        )}
        <span className="ml-auto">
          {d.ownedCount} scope{d.ownedCount === 1 ? "" : "s"}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!size-2" />
    </div>
  );
}
