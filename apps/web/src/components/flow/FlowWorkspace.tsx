import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Canonical full-area layout for every GodMode flow chart: optional left
 * palette, central canvas (with optional toolbar above it), optional right
 * inspector. Matches Agents > Pipeline sizing and chrome.
 */
export function FlowWorkspace({
  palette,
  toolbar,
  canvas,
  inspector,
  aside,
  extra,
  bordered = true,
  className,
}: {
  palette?: ReactNode;
  toolbar?: ReactNode;
  canvas: ReactNode;
  inspector?: ReactNode;
  /** Optional fourth column (e.g. domain preview panel). */
  aside?: ReactNode;
  /** Dialogs/modals rendered outside the bordered shell. */
  extra?: ReactNode;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <>
      <div
        className={cn(
          "flex h-full min-h-0 w-full overflow-hidden",
          bordered && "rounded-lg border",
          className
        )}
      >
        {palette}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {toolbar}
          {canvas}
        </div>
        {inspector}
        {aside}
      </div>
      {extra}
    </>
  );
}
