import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronLeftIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { WindowDensityControls } from "@/components/floating/WindowDensityControls";
import {
  getWindowDensity,
  WINDOW_DENSITY_EVENT,
} from "@/lib/floating-window-density";
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
  /** Density prefs key (defaults to information). */
  windowId?: string;
  /** Title-bar back (same as hardware Back / phoneGoBack). */
  showBack?: boolean;
  onBack?: () => void;
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
  windowId = "information",
  showBack = false,
  onBack,
}: GraphPhoneSheetProps) {
  const [contentDensity, setContentDensity] = useState(() =>
    getWindowDensity(windowId)
  );

  useEffect(() => {
    setContentDensity(getWindowDensity(windowId));
    const onDensity = (ev: Event) => {
      const detail = (ev as CustomEvent<{ windowId?: string; density?: number }>)
        .detail;
      if (detail?.windowId !== windowId) return;
      if (typeof detail.density === "number") setContentDensity(detail.density);
    };
    window.addEventListener(WINDOW_DENSITY_EVENT, onDensity);
    return () => window.removeEventListener(WINDOW_DENSITY_EVENT, onDensity);
  }, [windowId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="bottom"
        showCloseButton
        showOverlay={false}
        className={cn(
          "flex min-h-0 flex-col gap-0 overflow-hidden p-0 shadow-xl",
          GRAPH_WINDOW_Z,
          // Playfield: under top chrome, above composer / focus pill.
          // Explicit height beats Sheet's default bottom h-auto so the body
          // gets a real scroll budget on mobile WebKit.
          "inset-x-0! top-[var(--graph-top-chrome-band,5.625rem)]! bottom-[var(--graph-composer-band,7.25rem)]!",
          "h-[calc(100dvh-var(--graph-top-chrome-band,5.625rem)-var(--graph-composer-band,7.25rem))]! max-h-none!",
          "rounded-t-xl border-t",
          className
        )}
      >
        <SheetHeader className="flex shrink-0 flex-row items-center gap-1.5 border-b px-2 py-2 pr-12 text-left">
          {showBack && onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Back"
              title="Back"
              onClick={onBack}
            >
              <ChevronLeftIcon />
            </Button>
          ) : null}
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <SheetTitle className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </SheetTitle>
          <WindowDensityControls windowId={windowId} size="icon-xs" />
        </SheetHeader>
        {/*
          Sole scroll owner on phone. Do not use flex-col here: nested children
          with flex-1 + overflow-y-auto (plus density zoom) clip with no scroll.
          Natural-height children scroll inside this node.
        */}
        <div
          data-graph-phone-sheet-scroll=""
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y"
          style={
            {
              zoom: contentDensity,
              ["--gm-window-density"]: String(contentDensity),
              WebkitOverflowScrolling: "touch",
            } as CSSProperties
          }
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
