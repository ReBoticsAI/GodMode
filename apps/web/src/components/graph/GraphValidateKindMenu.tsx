import { Fragment } from "react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_VALIDATE_ITEMS,
  GRAPH_VALIDATE_KINDS,
  labelForValidateKind,
  type GraphValidateKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_VALIDATE_ITEMS,
  GRAPH_VALIDATE_KINDS,
  labelForValidateKind,
  type GraphValidateKind,
};

const VALIDATE_GROUP_ORDER: string[] = [];
for (const item of GRAPH_ACTION_VALIDATE_ITEMS) {
  if (item.group && !VALIDATE_GROUP_ORDER.includes(item.group)) {
    VALIDATE_GROUP_ORDER.push(item.group);
  }
}

/** Shared list body for Graph Validate menus (wide DropdownMenu + compact Sub). */
export function GraphValidateKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphValidateKind) => void;
}) {
  return (
    <>
      {VALIDATE_GROUP_ORDER.map((group, index) => {
        const items = GRAPH_ACTION_VALIDATE_ITEMS.filter(
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
