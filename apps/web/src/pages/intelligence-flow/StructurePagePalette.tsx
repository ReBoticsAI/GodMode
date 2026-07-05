import { useMemo, useState } from "react";
import { ChevronRightIcon, FileIcon, PlusIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FlowPalette } from "@/components/flow";
import { iconByName } from "@/lib/icon-lookup";
import type { StructureNode } from "@/lib/navigation";
import { cn } from "@/lib/utils";

function PageTreeRows({
  nodes,
  selectedId,
  onSelect,
  depth = 0,
}: {
  nodes: StructureNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const Icon = iconByName(node.icon);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.id} style={{ paddingLeft: depth * 12 }}>
            {hasChildren ? (
              <Collapsible defaultOpen={depth < 2}>
                <div className="flex items-center gap-0.5">
                  <CollapsibleTrigger
                    aria-label={`Toggle ${node.label}`}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 [&[data-state=open]>svg]:rotate-90"
                  >
                    <ChevronRightIcon className="size-3 transition-transform duration-200" />
                  </CollapsibleTrigger>
                  <button
                    type="button"
                    onClick={() => onSelect(node.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs",
                      selectedId === node.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-transparent hover:bg-muted/60"
                    )}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{node.label}</span>
                  </button>
                </div>
                <CollapsibleContent className="ml-2 border-l border-border/70 pl-1">
                  <PageTreeRows
                    nodes={node.children}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    depth={depth + 1}
                  />
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs",
                  selectedId === node.id
                    ? "border-primary/60 bg-primary/5"
                    : "border-transparent hover:bg-muted/60"
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{node.label}</span>
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

export function StructurePagePalette({
  nodes,
  selectedId,
  onSelect,
  onAddPage,
}: {
  nodes: StructureNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddPage: () => void;
}) {
  const [open, setOpen] = useState(true);
  const pageCount = useMemo(() => {
    let n = 0;
    const walk = (list: StructureNode[]) => {
      for (const node of list) {
        n++;
        walk(node.children);
      }
    };
    walk(nodes);
    return n;
  }, [nodes]);

  return (
    <FlowPalette
      title="Pages"
      description={`${pageCount} page${pageCount === 1 ? "" : "s"}`}
      width="tree"
      headerAction={
        <button
          type="button"
          title="Add page"
          onClick={onAddPage}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
        </button>
      }
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          aria-label={open ? "Collapse page tree" : "Expand page tree"}
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-medium hover:bg-muted/60"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-90"
            )}
          />
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span>Navigation tree</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1.5">
          {nodes.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">No pages yet.</p>
          ) : (
            <PageTreeRows nodes={nodes} selectedId={selectedId} onSelect={onSelect} />
          )}
        </CollapsibleContent>
      </Collapsible>
    </FlowPalette>
  );
}
