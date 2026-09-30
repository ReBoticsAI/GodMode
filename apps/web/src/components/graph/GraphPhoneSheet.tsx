import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { GRAPH_WINDOW_Z } from "@/lib/graph-chrome-layout";
import { cn } from "@/lib/utils";

export {
  GRAPH_COMPOSER_BAND,
  GRAPH_TOP_CHROME_BAND,
} from "@/lib/graph-chrome-layout";

type GraphPhoneSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Phone primary surface: Sheet in the window playfield (under ticker/notice,
 * above composer / reply pill). No modal blur; primary chrome stays interactive.
 * Bands come from live `--graph-*-chrome-band` CSS vars on :root.
 */
export function GraphPhoneSheet({
  open,
  onOpenChange,
  title,
  icon,
  children,
  className,
}: GraphPhoneSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="bottom"
        showCloseButton
        showOverlay={false}
        className={cn(
          "gap-0 p-0 shadow-xl",
          GRAPH_WINDOW_Z,
          // Playfield: under top chrome, above composer / focus pill.
          "inset-x-0! top-[var(--graph-top-chrome-band,5.625rem)]! bottom-[var(--graph-composer-band,7.25rem)]! h-auto! max-h-none!",
          "rounded-t-xl border-t",
          className
        )}
      >
        <SheetHeader className="flex shrink-0 flex-row items-center gap-2 border-b px-3 py-2.5 pr-12 text-left">
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <SheetTitle className="min-w-0 truncate text-sm font-medium">
            {title}
          </SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
