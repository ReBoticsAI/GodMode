import { useEffect, useMemo, useRef } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type {
  GraphActionMenuItem,
  GraphActionModeId,
} from "@/components/graph/graph-action-menus";

function matchesQuery(item: GraphActionMenuItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.label, item.description ?? "", item.group ?? "", item.id]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function GraphActionBrowsePanel({
  mode,
  modeLabel,
  items,
  query,
  onSelect,
  open,
  onClose,
}: {
  mode: GraphActionModeId;
  modeLabel: string;
  items: readonly GraphActionMenuItem[];
  query: string;
  onSelect: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(
    () => items.filter((item) => matchesQuery(item, query)),
    [items, query]
  );

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, GraphActionMenuItem[]>();
    for (const item of filtered) {
      const group = item.group?.trim() || "Other";
      if (!map.has(group)) {
        map.set(group, []);
        order.push(group);
      }
      map.get(group)!.push(item);
    }
    return order.map((group) => ({ group, items: map.get(group)! }));
  }, [filtered]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      // Keep open when interacting with the action mode row or chat composer.
      const keepOpen = (target as Element).closest?.(
        "[data-graph-action-chrome]"
      );
      if (keepOpen) return;
      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-slot="graph-action-browse"
      data-graph-action-browse=""
      data-mode={mode}
      role="listbox"
      aria-label={`${modeLabel} actions`}
      className="w-full max-w-2xl overflow-hidden rounded-lg border border-border/60 bg-background/95 shadow-md backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-sm font-medium">{modeLabel}</p>
          <p className="truncate text-xs text-muted-foreground">
            {query.trim()
              ? `${filtered.length} of ${items.length} match`
              : `${items.length} actions. Type in chat to filter.`}
          </p>
        </div>
        <SearchIcon className="shrink-0 text-muted-foreground" />
      </div>

      <ScrollArea className="h-72">
        <div className="flex flex-col gap-1 p-2">
          {groups.length === 0 ? (
            <Empty className="border-0 p-6">
              <EmptyHeader>
                <EmptyTitle>No matches</EmptyTitle>
                <EmptyDescription>
                  Try a different search for {modeLabel.toLowerCase()} actions.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            groups.map(({ group, items: groupItems }, index) => (
              <div key={group} className="flex flex-col gap-1">
                {index > 0 ? <Separator className="my-1" /> : null}
                <p className="px-2 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {group}
                </p>
                {groupItems.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    role="option"
                    className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left whitespace-normal"
                    onClick={() => onSelect(item.id)}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">{item.label}</span>
                      {item.description ? (
                        <span className="text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
