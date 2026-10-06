import { useEffect, useState } from "react";
import {
  GRAPH_TOUR_DONE_EVENT,
  GRAPH_TOUR_LINE_EVENT,
  GRAPH_TOUR_RESET_EVENT,
} from "@/lib/guide-ui-action";
import { isPhoneViewport } from "@/lib/graph-phone-shell";
import {
  getPhoneSurfaceCurrent,
  phoneGoBack,
} from "@/lib/phone-surface-stack";
import { useIsPhone } from "@/hooks/use-mobile";
import { GRAPH_WINDOW_Z } from "@/lib/graph-chrome-layout";
import { cn } from "@/lib/utils";

type TourLine = { label: string; say: string };

/**
 * Playfield caption for Graph tour narration on phone.
 * Social is dismissed so the Graph stays visible; this shows the stop text
 * that used to live only inside the chat window.
 */
export function GraphTourCaption() {
  const isPhone = useIsPhone();
  const [line, setLine] = useState<TourLine | null>(null);

  useEffect(() => {
    const onLine = (ev: Event) => {
      if (!isPhoneViewport()) return;
      const detail = (ev as CustomEvent<TourLine>).detail;
      if (!detail?.say?.trim()) return;
      setLine({
        label: detail.label?.trim() || "Graph",
        say: detail.say.trim(),
      });
    };
    const onReset = () => setLine(null);
    const onDone = () => {
      setLine(null);
      if (!isPhoneViewport()) return;
      // Pop the Social surface pushed when the tour started. Do not re-open
      // Explore Plans here; mid-chat tours return to the live thread as-is.
      phoneGoBack();
      queueMicrotask(() => {
        // If dismiss ran with an empty phone stack (viewport race), force Social
        // back open without wiping the in-memory agent thread.
        if (!getPhoneSurfaceCurrent()) {
          window.dispatchEvent(
            new CustomEvent("godmode:open-intelligence-chat", { detail: {} })
          );
        }
      });
    };
    window.addEventListener(GRAPH_TOUR_LINE_EVENT, onLine);
    window.addEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
    window.addEventListener(GRAPH_TOUR_DONE_EVENT, onDone);
    return () => {
      window.removeEventListener(GRAPH_TOUR_LINE_EVENT, onLine);
      window.removeEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
      window.removeEventListener(GRAPH_TOUR_DONE_EVENT, onDone);
    };
  }, []);

  if (!isPhone || !line) return null;

  return (
    <div
      data-graph-tour-caption
      className={cn(
        "pointer-events-none fixed inset-x-3",
        GRAPH_WINDOW_Z,
        "bottom-[calc(var(--graph-composer-band,7.25rem)+0.5rem)]"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto mx-auto max-w-md rounded-xl border border-border bg-popover/95 px-3 py-2.5 text-sm text-popover-foreground shadow-lg backdrop-blur-sm">
        <p className="font-medium">{line.label}</p>
        <p className="mt-1 text-muted-foreground">{line.say}</p>
      </div>
    </div>
  );
}
