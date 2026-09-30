import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_ORGANIZE_ITEMS,
  GRAPH_ORGANIZE_KINDS,
  labelForOrganizeKind,
  type GraphOrganizeKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_ORGANIZE_ITEMS,
  GRAPH_ORGANIZE_KINDS,
  labelForOrganizeKind,
  type GraphOrganizeKind,
};

const ORGANIZE_GROUP_ORDER = [
  "Hierarchy",
  "Collapse",
  "Sorting",
  "Pinning",
  "Tags",
  "Archives",
  "Layout",
] as const;

/**
 * Shared list body for Graph Organize menus (wide DropdownMenu + compact Sub).
 * Item defs live in graph-action-menus.ts.
 */
export function GraphOrganizeKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphOrganizeKind) => void;
}) {
  return (
    <>
      {ORGANIZE_GROUP_ORDER.map((group, groupIndex) => {
        const items = GRAPH_ACTION_ORGANIZE_ITEMS.filter(
          (k) => k.group === group
        );
        if (items.length === 0) return null;
        return (
          <DropdownMenuGroup key={group}>
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
          </DropdownMenuGroup>
        );
      })}
    </>
  );
}
