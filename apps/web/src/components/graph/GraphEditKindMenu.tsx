import { Fragment } from "react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_EDIT_ITEMS,
  GRAPH_EDIT_KINDS,
  labelForEditKind,
  type GraphEditKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_EDIT_ITEMS,
  GRAPH_EDIT_KINDS,
  labelForEditKind,
  type GraphEditKind,
};

const EDIT_GROUP_ORDER: string[] = [];
for (const item of GRAPH_ACTION_EDIT_ITEMS) {
  if (item.group && !EDIT_GROUP_ORDER.includes(item.group)) {
    EDIT_GROUP_ORDER.push(item.group);
  }
}

/**
 * Shared list body for Graph Edit menus (wide DropdownMenu + compact Sub).
 * Item defs live in graph-action-menus.ts (broader than Create, including systemOnly).
 */
export function GraphEditKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphEditKind) => void;
}) {
  return (
    <>
      {EDIT_GROUP_ORDER.map((group, index) => {
        const items = GRAPH_ACTION_EDIT_ITEMS.filter(
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
