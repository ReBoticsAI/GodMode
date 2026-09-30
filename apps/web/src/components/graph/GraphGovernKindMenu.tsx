import { Fragment } from "react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_GOVERN_ITEMS,
  labelForGovernKind,
  type GraphGovernKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_GOVERN_ITEMS,
  labelForGovernKind,
  type GraphGovernKind,
};

const GOVERN_GROUP_ORDER: string[] = [];
for (const item of GRAPH_ACTION_GOVERN_ITEMS) {
  if (item.group && !GOVERN_GROUP_ORDER.includes(item.group)) {
    GOVERN_GROUP_ORDER.push(item.group);
  }
}

/**
 * Shared list body for Graph Govern menus (wide DropdownMenu + compact Sub).
 * Item defs live in graph-action-menus.ts (policy / admin inventory).
 */
export function GraphGovernKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphGovernKind) => void;
}) {
  return (
    <>
      {GOVERN_GROUP_ORDER.map((group, index) => {
        const items = GRAPH_ACTION_GOVERN_ITEMS.filter(
          (item) => item.group === group
        );
        if (items.length === 0) return null;
        return (
          <Fragment key={group}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => onSelect(item.id)}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}
