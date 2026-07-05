import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { iconByName } from "@/lib/icon-lookup";
import type { PageNodeData } from "../orgchart";
import { CollapseToggle } from "./CollapseToggle";

export function PageNode({ id, data, selected }: NodeProps) {
  const d = data as PageNodeData;
  const Icon = iconByName(d.iconName);
  return (
    <div
      className={cn(
        "relative min-w-[180px] max-w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-shadow",
        d.builtIn ? "border-violet-500/40" : "border-border/70",
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
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
        {d.builtIn && (
          <Badge variant="outline" className="ml-auto text-[9px]">
            built-in
          </Badge>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="truncate">
          {d.explicit ? "agent: " : "inherits: "}
          {d.ownerName}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!size-2" />
    </div>
  );
}
