import type { AnchorBounds } from "@/lib/floating-window-anchors";

export type FloatingWindowBounds = AnchorBounds;

/**
 * Bounds for floating windows: the center column content area (same space as
 * the Intelligence chat window), relative to the column's offset parent.
 */
export function getFloatingWindowBounds(): FloatingWindowBounds {
  const main = document.querySelector("main");
  const parent = main?.parentElement;
  if (main && parent) {
    const m = main.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    if (m.width > 0 && m.height > 0) {
      return {
        x: Math.round(m.left - p.left),
        y: Math.round(m.top - p.top),
        width: Math.round(m.width),
        height: Math.round(m.height),
      };
    }
  }
  return {
    x: 0,
    y: 36,
    width: window.innerWidth,
    height: Math.max(240, window.innerHeight - 72),
  };
}
