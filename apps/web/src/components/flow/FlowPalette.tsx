import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Left rail shell for flow-chart palettes (agent tree, page tree, node types).
 */
export function FlowPalette({
  title,
  description,
  headerAction,
  footer,
  children,
  width = "tree",
  className,
}: {
  title: string;
  description?: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** `tree` = w-72 (agent/page trees); `nodes` = w-52 (drag node types). */
  width?: "tree" | "nodes" | "compact";
  className?: string;
}) {
  const widthClass =
    width === "tree" ? "w-72" : width === "compact" ? "w-36" : "w-52";

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-muted/20",
        widthClass,
        className
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {headerAction}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-2 py-2">{children}</div>
      </ScrollArea>
      {footer ? <div className="border-t px-2 py-2">{footer}</div> : null}
    </div>
  );
}
