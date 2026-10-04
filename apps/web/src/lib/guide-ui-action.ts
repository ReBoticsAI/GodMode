/**
 * Apply Intelligence guide-tool uiAction payloads on the client.
 * Reuses Graph floating-surface events and focus selection.
 */

import { toast } from "sonner";
import { GUIDE_CHOICE_EVENT } from "@/lib/guide-next-choice";
import { isPhoneViewport } from "@/lib/graph-phone-shell";
import {
  PHONE_OPEN_SURFACE_REQUEST_EVENT,
  type PhoneOpenSurfaceRequestDetail,
} from "@/lib/phone-surface-stack";
import { readVisualChatEnabled } from "@/lib/storage-keys";

export type GraphTourStop = {
  nodeId: string;
  label: string;
  say: string;
};

export const GRAPH_TOUR_DWELL_MS = 10_000;
export const GRAPH_TOUR_LINE_EVENT = "godmode:graph-tour-line";
export const GRAPH_TOUR_RESET_EVENT = "godmode:graph-tour-reset";
export const GRAPH_TOUR_DONE_EVENT = "godmode:graph-tour-done";

export type GuideUiAction =
  | {
      type: "open_surface";
      tab: string;
      vault?: string;
      sub?: string;
      label?: string;
    }
  | { type: "focus_node"; nodeId: string; label?: string }
  | { type: "graph_tour"; dwellMs?: number; stops: GraphTourStop[] }
  | {
      type: "guide_choice";
      question: string;
      why: string;
      options: Array<{ id: string; label: string }>;
    };

let cancelActiveTour: (() => void) | null = null;

export function cancelGraphTour(): void {
  cancelActiveTour?.();
  cancelActiveTour = null;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GRAPH_TOUR_RESET_EVENT));
}

export type PlayGraphTourOptions = {
  /**
   * Soft framing: highlight the node without dismissing Social (phone) or
   * opening Information. Used for Explore buy onboarding so chat cards stay up.
   */
  soft?: boolean;
};

/** Show one Graph stop, explain it, then move on. Each stop replaces the last page. */
export function playGraphTour(
  stops: GraphTourStop[],
  dwellMs = GRAPH_TOUR_DWELL_MS,
  opts?: PlayGraphTourOptions
): void {
  cancelGraphTour();
  if (typeof window === "undefined" || stops.length === 0) return;
  const wait = Math.min(20_000, Math.max(1_000, dwellMs));
  const soft = opts?.soft === true;
  let cancelled = false;
  const timers: number[] = [];
  cancelActiveTour = () => {
    cancelled = true;
    for (const id of timers) window.clearTimeout(id);
  };
  const show = (stop: GraphTourStop) => {
    if (cancelled) return;
    window.dispatchEvent(
      new CustomEvent("godmode:focus-graph-node", {
        detail: soft
          ? { nodeId: stop.nodeId, soft: true }
          : { nodeId: stop.nodeId, tour: true },
      })
    );
    window.dispatchEvent(
      new CustomEvent(GRAPH_TOUR_LINE_EVENT, {
        detail: { label: stop.label, say: stop.say },
      })
    );
  };
  show(stops[0]);
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i];
    timers.push(window.setTimeout(() => show(stop), i * wait));
  }
  timers.push(
    window.setTimeout(() => {
      if (cancelled) return;
      window.dispatchEvent(new CustomEvent(GRAPH_TOUR_DONE_EVENT));
    }, stops.length * wait)
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Extract a guide uiAction from a tool result payload (if present). */
export function guideUiActionFromToolResult(
  result: unknown
): GuideUiAction | null {
  if (!isRecord(result)) return null;
  const raw = result.uiAction;
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (type === "open_surface" && typeof raw.tab === "string" && raw.tab.trim()) {
    return {
      type: "open_surface",
      tab: raw.tab.trim(),
      vault: typeof raw.vault === "string" ? raw.vault : undefined,
      sub: typeof raw.sub === "string" ? raw.sub : undefined,
      label: typeof raw.label === "string" ? raw.label : undefined,
    };
  }
  if (
    type === "focus_node" &&
    typeof raw.nodeId === "string" &&
    raw.nodeId.trim()
  ) {
    return {
      type: "focus_node",
      nodeId: raw.nodeId.trim(),
      label: typeof raw.label === "string" ? raw.label : undefined,
    };
  }
  if (type === "graph_tour" && Array.isArray(raw.stops)) {
    const stops: GraphTourStop[] = [];
    for (const item of raw.stops) {
      if (!isRecord(item)) continue;
      const nodeId = typeof item.nodeId === "string" ? item.nodeId.trim() : "";
      const say = typeof item.say === "string" ? item.say.trim() : "";
      if (!nodeId || !say) continue;
      stops.push({
        nodeId,
        say,
        label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : nodeId,
      });
    }
    if (stops.length === 0) return null;
    const dwellMs = typeof raw.dwellMs === "number" ? raw.dwellMs : undefined;
    return { type: "graph_tour", dwellMs, stops };
  }
  if (type === "guide_choice" && Array.isArray(raw.options)) {
    const options: Array<{ id: string; label: string }> = [];
    for (const item of raw.options) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      if (!id || !label) continue;
      options.push({ id, label });
    }
    if (options.length === 0) return null;
    return {
      type: "guide_choice",
      question:
        typeof raw.question === "string" && raw.question.trim()
          ? raw.question.trim()
          : "How do you want to move forward?",
      why: typeof raw.why === "string" ? raw.why.trim() : "",
      options,
    };
  }
  return null;
}

/** Phone: toast a tappable Open affordance instead of auto-swapping surfaces. */
export function promptPhoneOpenSurface(action: {
  tab: string;
  vault?: string;
  sub?: string;
  label?: string;
}): void {
  if (typeof window === "undefined") return;
  const label = action.label?.trim() || action.tab;
  const detail: PhoneOpenSurfaceRequestDetail = {
    tab: action.tab,
    vault: action.vault ?? null,
    sub: action.sub ?? null,
    label,
  };
  toast.message(`Open ${label}?`, {
    action: {
      label: "Open",
      onClick: () => {
        window.dispatchEvent(
          new CustomEvent(PHONE_OPEN_SURFACE_REQUEST_EVENT, { detail })
        );
      },
    },
  });
}

/**
 * Dispatch Graph chrome events for a guide uiAction.
 * On phone, open_surface becomes a tappable toast (no auto window swap).
 */
export function applyGuideUiAction(action: GuideUiAction): void {
  if (typeof window === "undefined") return;
  if (action.type === "graph_tour") {
    playGraphTour(action.stops, action.dwellMs);
    return;
  }

  if (action.type === "guide_choice") {
    window.dispatchEvent(
      new CustomEvent(GUIDE_CHOICE_EVENT, { detail: action })
    );
    return;
  }

  if (action.type === "focus_node") {
    window.dispatchEvent(
      new CustomEvent("godmode:focus-graph-node", {
        detail: { nodeId: action.nodeId },
      })
    );
    if (action.label) toast.message(`Focused ${action.label}`);
    return;
  }

  if (action.tab === "chat") {
    if (isPhoneViewport()) {
      promptPhoneOpenSurface({ tab: "chat", label: action.label ?? "Chat" });
      return;
    }
    window.dispatchEvent(
      new CustomEvent("godmode:open-intelligence-chat", { detail: {} })
    );
    return;
  }

  // Floating windows only when Visual chat is on (Settings → General).
  if (!readVisualChatEnabled()) {
    if (action.label) {
      toast.message(`Visual chat is off. ${action.label} was not opened.`);
    }
    return;
  }

  if (isPhoneViewport()) {
    promptPhoneOpenSurface(action);
    return;
  }

  const eventName = `godmode:open-${action.tab}` as const;
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: {
        vault: action.vault ?? null,
        sub: action.sub ?? null,
        tab: action.tab,
      },
    })
  );
  if (action.label) {
    toast.message(`Opened ${action.label}`);
  }
  // Desktop: keep Intelligence chat readable after opening Vault.
  if (action.tab === "platform-vault" || action.tab === "personal-vault") {
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent("godmode:open-intelligence-chat", { detail: {} })
      );
    });
  }
}
