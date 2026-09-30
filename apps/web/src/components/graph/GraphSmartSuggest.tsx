import { useEffect, useMemo, useState } from "react";
import {
  BotIcon,
  MessageSquareIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GraphProjectionNode } from "@/api";
import type {
  GraphActionMenuItem,
  GraphActionModeId,
} from "@/components/graph/graph-action-menus";

export type SmartSuggestKind = "node" | "action" | "ask";

export type SmartSuggestItem = {
  id: string;
  kind: SmartSuggestKind;
  title: string;
  subtitle?: string;
  nodeId?: string;
  actionId?: string;
  actionMode?: GraphActionModeId;
};

function scoreMatch(haystack: string, query: string): number {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  const idx = h.indexOf(q);
  if (idx >= 0) return 60 - Math.min(idx, 40);
  return 0;
}

function nodeTitle(node: GraphProjectionNode): string {
  const kind =
    node.kind.charAt(0).toUpperCase() + node.kind.slice(1).toLowerCase();
  return `${kind} - ${node.label}`;
}

export function buildSmartSuggestions(opts: {
  query: string;
  nodes: GraphProjectionNode[];
  /** Flat catalog of actions across modes (Create, Edit, …). */
  actionCatalog?: Array<{
    mode: GraphActionModeId;
    modeLabel: string;
    items: readonly GraphActionMenuItem[];
  }>;
  limit?: number;
}): SmartSuggestItem[] {
  const q = opts.query.trim();
  if (q.length < 1) return [];
  const limit = opts.limit ?? 12;
  const scored: Array<SmartSuggestItem & { score: number }> = [];

  for (const node of opts.nodes) {
    const title = nodeTitle(node);
    const score = Math.max(
      scoreMatch(node.label, q),
      scoreMatch(node.kind, q),
      scoreMatch(node.id, q),
      scoreMatch(title, q),
      node.objectType ? scoreMatch(node.objectType, q) : 0
    );
    if (score <= 0) continue;
    scored.push({
      id: `node:${node.id}`,
      kind: "node",
      title,
      subtitle: node.objectType ?? node.kind,
      nodeId: node.id,
      score,
    });
  }

  for (const entry of opts.actionCatalog ?? []) {
    for (const item of entry.items) {
      const score = Math.max(
        scoreMatch(item.label, q),
        scoreMatch(item.id, q),
        scoreMatch(item.description ?? "", q),
        scoreMatch(item.group ?? "", q),
        scoreMatch(entry.modeLabel, q)
      );
      if (score <= 0) continue;
      scored.push({
        id: `action:${entry.mode}:${item.id}`,
        kind: "action",
        title: item.label,
        subtitle: `${entry.modeLabel} · ${item.group ?? "Action"}`,
        actionId: item.id,
        actionMode: entry.mode,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const top = scored.slice(0, limit).map(({ score: _s, ...rest }) => rest);

  top.push({
    id: `ask:${q}`,
    kind: "ask",
    title: `Ask Intelligence: “${q}”`,
    subtitle: "Send as a chat message",
  });

  return top;
}

const KIND_ICON: Record<SmartSuggestKind, LucideIcon> = {
  node: BotIcon,
  action: SparklesIcon,
  ask: MessageSquareIcon,
};

export function GraphSmartSuggest({
  items,
  activeIndex,
  onActiveIndexChange,
  onPick,
  open,
}: {
  items: SmartSuggestItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (item: SmartSuggestItem) => void;
  open: boolean;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setHoverId(null);
  }, [open]);

  const safeIndex = useMemo(() => {
    if (items.length === 0) return 0;
    return Math.max(0, Math.min(activeIndex, items.length - 1));
  }, [activeIndex, items.length]);

  if (!open || items.length === 0) return null;

  return (
    <div
      data-graph-smart-suggest=""
      data-graph-action-chrome=""
      className="mb-1.5 w-full overflow-hidden rounded-lg border border-border/60 bg-background/90 shadow-md backdrop-blur-md"
      role="listbox"
      aria-label="Smart search suggestions"
    >
      <ScrollArea className="max-h-56">
        <div className="flex flex-col p-1">
          {items.map((item, index) => {
            const Icon = KIND_ICON[item.kind];
            const active = index === safeIndex || hoverId === item.id;
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={index === safeIndex}
                className={cn(
                  "h-auto w-full justify-start gap-2 px-2 py-1.5 text-left",
                  active && "bg-accent"
                )}
                onMouseEnter={() => {
                  setHoverId(item.id);
                  onActiveIndexChange(index);
                }}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => onPick(item)}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.title}</span>
                  {item.subtitle ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.subtitle}
                    </span>
                  ) : null}
                </span>
              </Button>
            );
          })}
        </div>
      </ScrollArea>
      <p className="border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
        ↑↓ to move · Enter to pick · Ctrl+Enter to ask Intelligence
      </p>
    </div>
  );
}
