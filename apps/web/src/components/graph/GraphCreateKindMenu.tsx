import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  GRAPH_ACTION_CREATE_ITEMS,
  GRAPH_CREATE_KINDS,
  labelForCreateKind,
  type GraphCreateKind,
} from "@/components/graph/graph-action-menus";

export {
  GRAPH_ACTION_CREATE_ITEMS,
  GRAPH_CREATE_KINDS,
  labelForCreateKind,
  type GraphCreateKind,
};

/**
 * Shared list body for Graph Create menus (wide DropdownMenu + compact Sub).
 * Item defs live in graph-action-menus.ts so Edit/Organize/… menus can mirror this pattern.
 */
export function GraphCreateKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: GraphCreateKind) => void;
}) {
  return (
    <>
      {GRAPH_ACTION_CREATE_ITEMS.map((kind) => (
        <DropdownMenuItem key={kind.id} onClick={() => onSelect(kind.id)}>
          {kind.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}
