import { useMemo, useState, type ReactNode } from "react";
import { BotIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AiAgent } from "@/api";

export interface AgentTreePaletteProps {
  agents: AiAgent[];
  rootId: string;
  selectedAgentId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  title?: string;
  addTitle?: string;
  /** Ids that may not be deleted (root, personas). No trash icon is shown. */
  protectedIds?: ReadonlySet<string>;
  /** Extra content below the agent tree (e.g. pipeline section list). */
  footer?: ReactNode;
}

function buildChildrenByParent(agents: AiAgent[], rootId: string): Map<string, AiAgent[]> {
  const m = new Map<string, AiAgent[]>();
  const known = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    if (a.id === rootId) continue;
    const parent = a.parentId && known.has(a.parentId) ? a.parentId : rootId;
    const bucket = m.get(parent);
    if (bucket) bucket.push(a);
    else m.set(parent, [a]);
  }
  for (const bucket of m.values()) {
    bucket.sort((x, y) => x.name.localeCompare(y.name));
  }
  return m;
}

function AgentTreeRows({
  parentId,
  visited,
  childrenByParent,
  rootId,
  selectedAgentId,
  onSelect,
  onDelete,
  protectedIds,
}: {
  parentId: string;
  visited: Set<string>;
  childrenByParent: Map<string, AiAgent[]>;
  rootId: string;
  selectedAgentId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  protectedIds: ReadonlySet<string>;
}) {
  const kids = childrenByParent.get(parentId);
  if (!kids || kids.length === 0) return null;
  return (
    <div className="ml-[11px] mt-0.5 flex flex-col border-l border-border/70">
      {kids.map((a) => {
        if (visited.has(a.id)) return null;
        const nextVisited = new Set(visited);
        nextVisited.add(a.id);
        return (
          <div key={a.id} className="flex flex-col">
            <div className="group flex items-center">
              <span className="h-px w-2 shrink-0 bg-border/70" />
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs",
                  selectedAgentId === a.id
                    ? "border-primary/60 bg-primary/5"
                    : "border-transparent hover:bg-muted/60"
                )}
              >
                <span className="truncate">{a.name}</span>
                {a.team && (
                  <Badge variant="outline" className="ml-auto text-[8px]">
                    {a.team}
                  </Badge>
                )}
              </button>
              {a.id !== rootId && !protectedIds.has(a.id) && (
                <button
                  type="button"
                  title="Delete subagent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(a.id);
                  }}
                  className="ml-0.5 hidden size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive group-hover:flex"
                >
                  <Trash2Icon className="size-3" />
                </button>
              )}
            </div>
            <AgentTreeRows
              parentId={a.id}
              visited={nextVisited}
              childrenByParent={childrenByParent}
              rootId={rootId}
              selectedAgentId={selectedAgentId}
              onSelect={onSelect}
              onDelete={onDelete}
              protectedIds={protectedIds}
            />
          </div>
        );
      })}
    </div>
  );
}

export function AgentTreePalette({
  agents,
  rootId,
  selectedAgentId,
  onSelect,
  onDelete,
  onAdd,
  title = "Agents",
  addTitle = "New subagent from Intelligence",
  protectedIds,
  footer,
}: AgentTreePaletteProps) {
  const [open, setOpen] = useState(false);
  const protectedSet = useMemo(
    () => protectedIds ?? new Set<string>([rootId]),
    [protectedIds, rootId]
  );
  const rootAgent = useMemo(
    () =>
      agents.find((a) => a.id === rootId) ??
      agents.find((a) => a.isTemplate) ??
      null,
    [agents, rootId]
  );
  const childrenByParent = useMemo(
    () => buildChildrenByParent(agents, rootId),
    [agents, rootId]
  );

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r bg-muted/20">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-2 py-2">
          <Collapsible open={open} onOpenChange={setOpen}>
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger
                aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-muted/60"
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                    open && "rotate-90"
                  )}
                />
                <h3 className="truncate text-sm font-semibold">{title}</h3>
              </CollapsibleTrigger>
              <button
                type="button"
                title={addTitle}
                onClick={onAdd}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
            <CollapsibleContent className="pt-1.5">
              <div className="flex flex-col">
                {rootAgent && (
                  <button
                    type="button"
                    onClick={() => onSelect(rootAgent.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs",
                      selectedAgentId === rootAgent.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-transparent hover:bg-muted/60"
                    )}
                  >
                    <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{rootAgent.name}</span>
                    <Badge variant="secondary" className="ml-auto text-[9px]">
                      root
                    </Badge>
                  </button>
                )}
                <AgentTreeRows
                  parentId={rootId}
                  visited={new Set<string>([rootId])}
                  childrenByParent={childrenByParent}
                  rootId={rootId}
                  selectedAgentId={selectedAgentId}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  protectedIds={protectedSet}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
          {footer}
        </div>
      </ScrollArea>
    </div>
  );
}
