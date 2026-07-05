import type { MouseEvent } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgCollapse } from "./collapse-context";

interface CollapseToggleProps {
  nodeId: string;
  collapsed: boolean;
  childCount?: number;
}

/**
 * Chevron / "+N" affordance pinned to the bottom edge of a node. Toggles the
 * node's collapse state without triggering node selection or drag.
 */
export function CollapseToggle({ nodeId, collapsed, childCount }: CollapseToggleProps) {
  const { toggle } = useOrgCollapse();

  const onToggle = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggle(nodeId);
  };

  return (
    <button
      type="button"
      title={collapsed ? "Expand" : "Collapse"}
      onClick={onToggle}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "nodrag nopan absolute -bottom-2.5 left-1/2 z-10 flex h-5 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card px-1.5 text-[10px] font-medium text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground",
        collapsed && "border-primary/50 text-foreground"
      )}
    >
      {collapsed ? (
        <>
          <ChevronRightIcon className="size-3" />
          {childCount ? <span>{childCount}</span> : null}
        </>
      ) : (
        <ChevronDownIcon className="size-3" />
      )}
    </button>
  );
}
