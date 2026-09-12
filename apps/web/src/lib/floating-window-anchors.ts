/**
 * Shared focus-layout anchors for Chat + Information floating windows.
 * Two side-by-side slots with a center gap so a Graph node can sit between them.
 */

export type AnchorBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowAnchor = {
  id: "focus-left" | "focus-right";
  x: number;
  y: number;
};

/** Visible strip (px) between the two panels for the focused Graph node. */
export const FOCUS_CENTER_GAP_PX = 88;

/** Edge inset inside the content area. */
export const FOCUS_EDGE_INSET_PX = 12;

/** How close (px) the window top-left must be to snap. */
export const FOCUS_SNAP_THRESHOLD_PX = 64;

function clampPos(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: AnchorBounds
): { x: number; y: number } {
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - width);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - height);
  return {
    x: Math.round(Math.max(bounds.x, Math.min(maxX, x))),
    y: Math.round(Math.max(bounds.y, Math.min(maxY, y))),
  };
}

/**
 * Side-by-side anchors centered vertically in the content area, leaving a
 * middle gap for the focused Graph node (matches the manual layout users land on).
 */
export function focusWindowAnchors(
  bounds: AnchorBounds,
  width: number,
  height: number
): { left: WindowAnchor; right: WindowAnchor } {
  const midX = bounds.x + bounds.width / 2;
  const y = bounds.y + Math.max(FOCUS_EDGE_INSET_PX, (bounds.height - height) / 2);
  const leftRaw = midX - FOCUS_CENTER_GAP_PX / 2 - width;
  const rightRaw = midX + FOCUS_CENTER_GAP_PX / 2;
  const left = clampPos(leftRaw, y, width, height, bounds);
  const right = clampPos(rightRaw, y, width, height, bounds);
  return {
    left: { id: "focus-left", ...left },
    right: { id: "focus-right", ...right },
  };
}

/** Nearest focus anchor within snap threshold, or null. */
export function snapToFocusAnchor(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: AnchorBounds,
  thresholdPx: number = FOCUS_SNAP_THRESHOLD_PX
): WindowAnchor | null {
  const { left, right } = focusWindowAnchors(bounds, width, height);
  let best: WindowAnchor | null = null;
  let bestDist = thresholdPx;
  for (const a of [left, right]) {
    const d = Math.hypot(x - a.x, y - a.y);
    if (d <= bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}
