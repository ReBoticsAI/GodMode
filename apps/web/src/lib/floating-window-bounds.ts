import type { AnchorBounds } from "@/lib/floating-window-anchors";
import { GRAPH_WINDOW_BOUNDS_SELECTOR } from "@/lib/graph-chrome-layout";

export type FloatingWindowBounds = AnchorBounds;

/**
 * Bounds for floating windows: the Graph playfield between top chrome
 * (ticker / notice) and the footer composer / reply pill.
 * Prefer `[data-graph-window-bounds]` when mounted; else main with fallback insets.
 */
export function getFloatingWindowBounds(): FloatingWindowBounds {
  const playfield = document.querySelector(GRAPH_WINDOW_BOUNDS_SELECTOR);
  if (playfield instanceof HTMLElement) {
    const parent =
      (playfield.offsetParent instanceof HTMLElement
        ? playfield.offsetParent
        : null) ??
      document.querySelector("main")?.parentElement ??
      null;
    if (parent) {
      const r = playfield.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return {
          x: Math.round(r.left - p.left),
          y: Math.round(r.top - p.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      }
    }
  }

  const main = document.querySelector("main");
  const parent = main?.parentElement;
  if (main && parent) {
    const m = main.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    if (m.width > 0 && m.height > 0) {
      // Fallback insets when playfield marker is not mounted (~top/footer bands).
      const topInset = 104;
      const bottomInset = 116;
      return {
        x: Math.round(m.left - p.left),
        y: Math.round(m.top - p.top + topInset),
        width: Math.round(m.width),
        height: Math.max(240, Math.round(m.height - topInset - bottomInset)),
      };
    }
  }
  return {
    x: 0,
    y: 104,
    width: window.innerWidth,
    height: Math.max(240, window.innerHeight - 104 - 116),
  };
}

const MAX_RAIL_GAP_PX = 8;

/** Shrink bounds so the cluster sits inside the side button columns. */
export function insetBoundsInsideRails(
  bounds: FloatingWindowBounds,
  rails: { leftInner: number | null; rightInner: number | null },
  gap = MAX_RAIL_GAP_PX
): FloatingWindowBounds {
  let x = bounds.x;
  let right = bounds.x + bounds.width;
  if (rails.leftInner != null) x = Math.max(x, Math.round(rails.leftInner + gap));
  if (rails.rightInner != null) {
    right = Math.min(right, Math.round(rails.rightInner - gap));
  }
  return {
    x,
    y: bounds.y,
    width: Math.max(320, right - x),
    height: bounds.height,
  };
}

function boundsParentOrigin(): { left: number; top: number } | null {
  const playfield = document.querySelector(GRAPH_WINDOW_BOUNDS_SELECTOR);
  if (!(playfield instanceof HTMLElement)) return null;
  const parent =
    (playfield.offsetParent instanceof HTMLElement
      ? playfield.offsetParent
      : null) ??
    document.querySelector("main")?.parentElement ??
    null;
  if (!parent) return null;
  const p = parent.getBoundingClientRect();
  return { left: p.left, top: p.top };
}

/**
 * Playfield already stops under the top notices and above the reply pill.
 * Maximize also pulls the sides in to the inner edge of each button column.
 */
export function getMaximizedFocusBounds(): FloatingWindowBounds {
  const base = getFloatingWindowBounds();
  if (typeof document === "undefined") return base;
  const origin = boundsParentOrigin();
  if (!origin) return base;
  const leftRail = document.getElementById("graph-left-tabs-rail");
  const rightRail = document.getElementById("graph-tools-rail");
  return insetBoundsInsideRails(base, {
    leftInner: leftRail
      ? leftRail.getBoundingClientRect().right - origin.left
      : null,
    rightInner: rightRail
      ? rightRail.getBoundingClientRect().left - origin.left
      : null,
  });
}
