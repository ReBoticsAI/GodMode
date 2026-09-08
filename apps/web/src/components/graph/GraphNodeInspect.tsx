import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { GraphCtaAction, GraphProjectionNode } from "@/api";
import { GraphNodeMissionsSection } from "@/components/graph/GraphMissionsPanel";

const KIND_COLOR: Record<string, string> = {
  chat: "#38bdf8",
  agent: "#a78bfa",
  user: "#34d399",
  memory: "#fbbf24",
  skill: "#fb7185",
  tool: "#94a3b8",
  workflow: "#f472b6",
  schedule: "#2dd4bf",
  page: "#60a5fa",
  unlock: "#eab308",
  system: "#a8a29e",
};

export function GraphNodeInspect({
  node,
  open,
  onOpenChange,
  onCta,
}: {
  node: GraphProjectionNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCta: (action: GraphCtaAction, node: GraphProjectionNode) => void;
}) {
  if (!node) return null;
  const color = KIND_COLOR[node.kind] ?? "#94a3b8";
  const statusBits = node.status
    ? Object.entries(node.status).map(([k, v]) =>
        typeof v === "boolean" ? `${k}: ${v ? "yes" : "no"}` : `${k}: ${v}`
      )
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="border-border/80 bg-card/95 backdrop-blur-md sm:max-w-md"
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <SheetHeader className="gap-2 pt-2">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="capitalize"
              style={{
                backgroundColor: `${color}22`,
                color,
                borderColor: `${color}44`,
              }}
            >
              {node.kind}
            </Badge>
            {node.objectType ? (
              <span className="text-[11px] text-muted-foreground">
                {node.objectType}
              </span>
            ) : null}
          </div>
          <SheetTitle>{node.label}</SheetTitle>
          <SheetDescription className="text-left text-sm text-foreground/90">
            {node.description ??
              "A piece of the GodMode architecture on The Graph."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          {node.securityNote ? (
            <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Security
              </p>
              <p className="mt-1 text-sm text-foreground/90">{node.securityNote}</p>
            </div>
          ) : null}

          {node.connectionLabels && node.connectionLabels.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Connected to
              </p>
              <div className="flex flex-wrap gap-1.5">
                {node.connectionLabels.map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {statusBits.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {statusBits.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <GraphNodeMissionsSection nodeId={node.id} />
        </div>

        <SheetFooter>
          {node.cta && node.cta.type !== "none" ? (
            <Button
              type="button"
              onClick={() => {
                onCta(node.cta!, node);
                onOpenChange(false);
              }}
            >
              {node.ctaLabel ?? "Open"}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
