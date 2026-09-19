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
