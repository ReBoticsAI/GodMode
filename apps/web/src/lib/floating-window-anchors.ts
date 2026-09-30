/**
 * Shared focus-layout anchors for Chat + Information floating windows.
 * Cluster is centered on the playfield (highlighted Graph node sits in the gap).
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

/**
 * Visible strip (px) between chat (left) and Information (right) so the
 * highlighted Graph node is not crowded by either panel.
 */
export const FOCUS_CENTER_GAP_PX = 200;

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

/** Horizontal center of the playfield (Graph focus / highlighted node axis). */
export function focusAxisX(bounds: AnchorBounds, focusX?: number): number {
  if (typeof focusX === "number" && Number.isFinite(focusX)) return focusX;
  return bounds.x + bounds.width / 2;
}

/**
 * Side-by-side anchors centered on the focus axis, leaving a middle gap for
 * the highlighted Graph node.
 */
export function focusWindowAnchors(
  bounds: AnchorBounds,
  width: number,
  height: number,
  focusX?: number
): { left: WindowAnchor; right: WindowAnchor } {
  const midX = focusAxisX(bounds, focusX);
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
  thresholdPx: number = FOCUS_SNAP_THRESHOLD_PX,
  focusX?: number
): WindowAnchor | null {
  const { left, right } = focusWindowAnchors(bounds, width, height, focusX);
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

export type FocusTileRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const TILE_GAP_PX = 8;

/**
 * Tile N companion windows on the right of the focus gap.
 * The companion block matches `seedWidth` so chat + gap + block stay symmetric
 * around the focus axis (screen / highlighted node center).
 */
export function tileFocusCompanionRects(
  bounds: AnchorBounds,
  seedWidth: number,
  seedHeight: number,
  count: number,
  side: "right" | "left" = "right",
  focusX?: number
): FocusTileRect[] {
  const n = Math.max(0, Math.min(5, Math.floor(count)));
  if (n <= 0) return [];

  const midX = focusAxisX(bounds, focusX);
  // Keep the companion column the same width as chat so the cluster is centered.
  const maxSide =
    side === "right"
      ? bounds.x + bounds.width - (midX + FOCUS_CENTER_GAP_PX / 2) - FOCUS_EDGE_INSET_PX
      : midX - FOCUS_CENTER_GAP_PX / 2 - bounds.x - FOCUS_EDGE_INSET_PX;
  const sideWidth = Math.max(160, Math.min(seedWidth, maxSide));
  const sideX0 =
    side === "right"
      ? midX + FOCUS_CENTER_GAP_PX / 2
      : midX - FOCUS_CENTER_GAP_PX / 2 - sideWidth;

  const sideHeight = Math.max(
    160,
    Math.min(seedHeight, bounds.height - FOCUS_EDGE_INSET_PX * 2)
  );
  const sideY0 =
    bounds.y + Math.max(FOCUS_EDGE_INSET_PX, (bounds.height - sideHeight) / 2);

  if (n === 1) {
    const w = sideWidth;
    const h = sideHeight;
    const pos = clampPos(sideX0, sideY0, w, h, bounds);
    return [
      {
        x: pos.x,
        y: pos.y,
        width: Math.round(w),
        height: Math.round(h),
      },
    ];
  }

  // Multi: fill the chat-sized block (not the whole half of the screen).
  const cols = n <= 2 ? 1 : n === 3 ? 2 : n === 4 ? 2 : 3;
  const rows = n <= 2 ? n : 2;
  const cellW = Math.floor((sideWidth - TILE_GAP_PX * (cols - 1)) / cols);
  const cellH = Math.floor((sideHeight - TILE_GAP_PX * (rows - 1)) / rows);

  const slots: FocusTileRect[] = [];
  for (let i = 0; i < n; i++) {
    let col: number;
    let row: number;
    if (n === 2) {
      col = 0;
      row = i;
    } else if (n === 3) {
      if (i === 0) {
        col = 0;
        row = 0;
      } else {
        col = i - 1;
        row = 1;
      }
    } else if (n === 5 && i >= 2) {
      col = i - 2;
      row = 1;
    } else {
      col = i % cols;
      row = Math.floor(i / cols);
    }
    const width =
      n === 3 && i === 0
        ? sideWidth
        : n === 5 && i < 2
          ? Math.floor((sideWidth - TILE_GAP_PX) / 2)
          : cellW;
    const x =
      n === 3 && i === 0
        ? sideX0
        : n === 5 && i < 2
          ? sideX0 + i * (width + TILE_GAP_PX)
          : sideX0 + col * (cellW + TILE_GAP_PX);
    const y = sideY0 + row * (cellH + TILE_GAP_PX);
    const pos = clampPos(x, y, width, cellH, bounds);
    slots.push({
      x: pos.x,
      y: pos.y,
      width: Math.round(width),
      height: Math.round(cellH),
    });
  }
  return slots;
}

/**
 * Full centered cluster: chat left of focus, companions right, same column
 * width, vertically centered. Returns chat rect + companion rects.
 */
export function layoutCenteredFocusCluster(
  bounds: AnchorBounds,
  seedWidth: number,
  seedHeight: number,
  companionCount: number,
  focusX?: number
): { chat: FocusTileRect; companions: FocusTileRect[]; focusX: number } {
  const midX = focusAxisX(bounds, focusX);
  const maxLeft =
    midX - FOCUS_CENTER_GAP_PX / 2 - bounds.x - FOCUS_EDGE_INSET_PX;
  const chatW = Math.max(160, Math.min(seedWidth, maxLeft));
  const chatH = Math.max(
    160,
    Math.min(seedHeight, bounds.height - FOCUS_EDGE_INSET_PX * 2)
  );
  const chatY =
    bounds.y + Math.max(FOCUS_EDGE_INSET_PX, (bounds.height - chatH) / 2);
  const chatX = midX - FOCUS_CENTER_GAP_PX / 2 - chatW;
  const chatPos = clampPos(chatX, chatY, chatW, chatH, bounds);
  const chat: FocusTileRect = {
    x: chatPos.x,
    y: chatPos.y,
    width: Math.round(chatW),
    height: Math.round(chatH),
  };
  const companions = tileFocusCompanionRects(
    bounds,
    chatW,
    chatH,
    companionCount,
    "right",
    midX
  );
  return { chat, companions, focusX: midX };
}

/** Pack companion tiles into a rectangle, same pattern as the focus column. */
function tileRectsInBox(
  x0: number,
  y0: number,
  boxWidth: number,
  boxHeight: number,
  count: number
): FocusTileRect[] {
  const n = Math.max(0, Math.min(5, Math.floor(count)));
  if (n <= 0) return [];
  if (n === 1) {
    return [
      {
        x: x0,
        y: y0,
        width: Math.round(boxWidth),
        height: Math.round(boxHeight),
      },
    ];
  }

  const cols = n <= 2 ? 1 : n === 3 ? 2 : n === 4 ? 2 : 3;
  const rows = n <= 2 ? n : 2;
  const cellW = Math.floor((boxWidth - TILE_GAP_PX * (cols - 1)) / cols);
  const cellH = Math.floor((boxHeight - TILE_GAP_PX * (rows - 1)) / rows);
  const slots: FocusTileRect[] = [];
  for (let i = 0; i < n; i++) {
    let col: number;
    let row: number;
    if (n === 2) {
      col = 0;
      row = i;
    } else if (n === 3) {
      if (i === 0) {
        col = 0;
        row = 0;
      } else {
        col = i - 1;
        row = 1;
      }
    } else if (n === 5 && i >= 2) {
      col = i - 2;
      row = 1;
    } else {
      col = i % cols;
      row = Math.floor(i / cols);
    }
    const width =
      n === 3 && i === 0
        ? boxWidth
        : n === 5 && i < 2
          ? Math.floor((boxWidth - TILE_GAP_PX) / 2)
          : cellW;
    const x =
      n === 3 && i === 0
        ? x0
        : n === 5 && i < 2
          ? x0 + i * (width + TILE_GAP_PX)
          : x0 + col * (cellW + TILE_GAP_PX);
    const y = y0 + row * (cellH + TILE_GAP_PX);
    slots.push({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(cellH),
    });
  }
  return slots;
}

/**
 * Stretch the focus cluster to fill `bounds`.
 * Slot 0 is the left column. Companions fill the right column.
 * One window fills the whole rect.
 */
export function layoutMaximizedFocusCluster(
  bounds: AnchorBounds,
  companionCount: number
): { chat: FocusTileRect; companions: FocusTileRect[] } {
  const width = Math.max(160, Math.round(bounds.width));
  const height = Math.max(160, Math.round(bounds.height));
  const n = Math.max(0, Math.min(5, Math.floor(companionCount)));
  if (n === 0) {
    return {
      chat: { x: bounds.x, y: bounds.y, width, height },
      companions: [],
    };
  }
  const colW = Math.floor((width - TILE_GAP_PX) / 2);
  const rightW = width - TILE_GAP_PX - colW;
  return {
    chat: {
      x: bounds.x,
      y: bounds.y,
      width: colW,
      height,
    },
    companions: tileRectsInBox(
      bounds.x + colW + TILE_GAP_PX,
      bounds.y,
      rightW,
      height,
      n
    ),
  };
}

/** Diagonal cascade offset between stacked focus windows. */
export const CASCADE_OFFSET_PX = 28;

/**
 * Offset-stack layout: each window is seed-sized and nudged +CASCADE_OFFSET_PX
 * diagonally from the previous. Defaults to the focus-right anchor so stacks
 * sit beside chat (right of the highlighted Graph node), not behind it.
 */
export function layoutCascadeStack(
  bounds: AnchorBounds,
  seedWidth: number,
  seedHeight: number,
  count: number,
  focusX?: number,
  side: "left" | "right" = "right"
): FocusTileRect[] {
  if (count <= 0) return [];
  const w = Math.max(
    160,
    Math.min(seedWidth, bounds.width - FOCUS_EDGE_INSET_PX * 2)
  );
  const h = Math.max(
    160,
    Math.min(seedHeight, bounds.height - FOCUS_EDGE_INSET_PX * 2)
  );
  const anchors = focusWindowAnchors(bounds, w, h, focusX);
  const base = side === "left" ? anchors.left : anchors.right;
  const out: FocusTileRect[] = [];
  for (let i = 0; i < count; i++) {
    const pos = clampPos(
      base.x + i * CASCADE_OFFSET_PX,
      base.y + i * CASCADE_OFFSET_PX,
      w,
      h,
      bounds
    );
    out.push({
      x: pos.x,
      y: pos.y,
      width: Math.round(w),
      height: Math.round(h),
    });
  }
  return out;
}

