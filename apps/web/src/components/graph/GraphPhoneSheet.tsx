import type { CSSProperties, ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** CSS length reserved for GraphEtherComposer + safe area on phone. */
export const GRAPH_COMPOSER_BAND =
  "calc(5.5rem + env(safe-area-inset-bottom, 0px))";

type GraphPhoneSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function GraphPhoneSheet({
  open,
  onOpenChange,
  title,
  icon,
  children,
  className,
}: GraphPhoneSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton
        className={cn(
          "gap-0 p-0",
          // Sit above the composer band; overlay stays under composer z-[210].
          "bottom-[var(--graph-composer-band)]! h-[calc(100dvh-var(--graph-composer-band))]! max-h-[calc(100dvh-var(--graph-composer-band))]!",
          "rounded-t-xl border-t",
          className
        )}
        style={
          {
            "--graph-composer-band": GRAPH_COMPOSER_BAND,
          } as CSSProperties
        }
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
