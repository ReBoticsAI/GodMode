import { Fragment } from "react";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_CONNECT_ITEMS,
  GRAPH_CONNECT_KINDS,
  labelForConnectKind,
  type GraphConnectKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_CONNECT_ITEMS,
  GRAPH_CONNECT_KINDS,
  labelForConnectKind,
  type GraphConnectKind,
};

const CONNECT_GROUP_ORDER: string[] = [];
for (const item of GRAPH_ACTION_CONNECT_ITEMS) {
  if (item.group && !CONNECT_GROUP_ORDER.includes(item.group)) {
    CONNECT_GROUP_ORDER.push(item.group);
  }
}

/**
 * Shared list body for Graph Connect menus (wide DropdownMenu + compact Sub).
 * Item defs live in graph-action-menus.ts.
 */
export function GraphConnectKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphConnectKind) => void;
}) {
  return (
    <>
      {CONNECT_GROUP_ORDER.map((group, index) => {
        const items = GRAPH_ACTION_CONNECT_ITEMS.filter(
          (item) => item.group === group
        );
        if (items.length === 0) return null;
        return (
          <Fragment key={group}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground">
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
            </DropdownMenuGroup>
          </Fragment>
        );
      })}
    </>
  );
}
