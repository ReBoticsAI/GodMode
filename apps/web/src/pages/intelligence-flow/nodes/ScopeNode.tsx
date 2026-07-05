import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { iconByName } from "@/lib/icon-lookup";
import type { ScopeNodeData } from "../orgchart";
import { scopeTypeLabel } from "../agent-org";
import { CollapseToggle } from "./CollapseToggle";

const SCOPE_ACCENT: Record<ScopeNodeData["scopeType"], string> = {
  department: "border-violet-500/40",
  division: "border-primary/40",
  page: "border-border/70",
};

const ROLE_TONE: Record<string, string> = {
  owner: "text-emerald-500",
  editor: "text-sky-500",
  viewer: "text-muted-foreground",
};

export function ScopeNode({ id, data, selected }: NodeProps) {
  const d = data as ScopeNodeData;
  const Icon = iconByName(d.iconName);
  return (
    <div
      className={cn(
        "relative min-w-[180px] max-w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-shadow",
        SCOPE_ACCENT[d.scopeType],
        selected && "ring-2 ring-primary",
        !d.explicit && "opacity-80"
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
        <Badge variant="outline" className="ml-auto text-[9px]">
          {scopeTypeLabel(d.scopeType)}
        </Badge>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="truncate">
          {d.explicit ? "owner: " : "inherits: "}
          {d.ownerName}
        </span>
        {d.role && (
          <span className={cn("ml-auto font-medium", ROLE_TONE[d.role] ?? "text-muted-foreground")}>
            {d.role}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!size-2" />
    </div>
  );
}
