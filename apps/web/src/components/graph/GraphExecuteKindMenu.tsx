import { Fragment } from "react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_EXECUTE_ITEMS,
  GRAPH_EXECUTE_KINDS,
  labelForExecuteKind,
  type GraphExecuteKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_EXECUTE_ITEMS,
  GRAPH_EXECUTE_KINDS,
  labelForExecuteKind,
  type GraphExecuteKind,
};

const EXECUTE_GROUP_ORDER = [
  "Chat",
  "Automations",
  "Agents",
  "Tools",
  "Jobs",
  "Coding",
  "Marketplace",
  "Graph",
  "Social",
] as const;

/**
 * Shared list body for Graph Execute menus (wide DropdownMenu + compact Sub).
 * Item defs live in graph-action-menus.ts.
 */
export function GraphExecuteKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphExecuteKind) => void;
}) {
  return (
    <>
      {EXECUTE_GROUP_ORDER.map((group, groupIndex) => {
        const items = GRAPH_ACTION_EXECUTE_ITEMS.filter(
          (k) => k.group === group
        );
        if (items.length === 0) return null;
        return (
          <Fragment key={group}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {items.map((kind) => (
              <DropdownMenuItem
                key={kind.id}
                onClick={() => onSelect(kind.id)}
              >
                {kind.label}
              </DropdownMenuItem>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}
