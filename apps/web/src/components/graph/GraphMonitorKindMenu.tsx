import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_MONITOR_ITEMS,
  GRAPH_MONITOR_KINDS,
  labelForMonitorKind,
  type GraphMonitorKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_MONITOR_ITEMS,
  GRAPH_MONITOR_KINDS,
  labelForMonitorKind,
  type GraphMonitorKind,
};

const MONITOR_GROUPS = [
  "Alerts",
  "Runtime",
  "Graph",
  "Activity",
  "Jobs",
] as const;

/**
 * Shared list body for Graph Monitor menus (wide DropdownMenu + compact Sub).
 * Item defs live in graph-action-menus.ts.
 */
export function GraphMonitorKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphMonitorKind) => void;
}) {
  return (
    <>
      {MONITOR_GROUPS.map((group, groupIndex) => {
        const items = GRAPH_ACTION_MONITOR_ITEMS.filter(
          (k) => k.group === group
        );
        if (items.length === 0) return null;
        return (
          <div key={group}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {group}
            </DropdownMenuLabel>
            {items.map((kind) => (
              <DropdownMenuItem
                key={kind.id}
                onClick={() => onSelect(kind.id)}
              >
                {kind.label}
              </DropdownMenuItem>
            ))}
          </div>
        );
      })}
    </>
  );
}
