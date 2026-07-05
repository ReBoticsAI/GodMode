import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Right rail shell for flow-chart inspectors (node/page/agent settings).
 */
export function FlowInspector({
  title = "Inspector",
  subtitle,
  headerAction,
  emptyDescription = "Select a node to configure it.",
  children,
  width = "default",
  className,
}: {
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  emptyDescription?: string;
  children?: ReactNode;
  /** `default` = w-96 (Pipeline/Structure); `narrow` = w-72; `wide` = w-80 */
  width?: "default" | "narrow" | "wide";
  className?: string;
}) {
  const widthClass =
    width === "narrow" ? "w-72" : width === "wide" ? "w-80" : "w-96";

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col border-l bg-muted/20",
        widthClass,
        className
      )}
    >
      {!children ? (
        <div className="border-b px-3 py-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{emptyDescription}</p>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{title}</h3>
              {subtitle ? (
                <p className="text-[11px] capitalize text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            {headerAction}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-3">{children}</div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
