/**
 * XY block grid for floating windows.
 * Each window maps to four corner blocks (b1–b4) so size and position are
 * expressed in grid coordinates. Anchor snaps one window, then mirrors its
 * pair across the focused-node X axis.
 */

import type { AnchorBounds } from "@/lib/floating-window-anchors";

/** Pixel size of one grid block. */
export const GRID_CELL_PX = 40;

export type GridCell = { col: number; row: number };

export type CornerBlock = GridCell & {
  /** Human label, e.g. "b1·C4". */
  label: string;
  /** Absolute pixel of the corner. */
  x: number;
  y: number;
};

export type WindowCornerBlocks = {
  /** Top-left */
  b1: CornerBlock;
  /** Top-right */
  b2: CornerBlock;
  /** Bottom-left */
  b3: CornerBlock;
  /** Bottom-right */
  b4: CornerBlock;
};

export type GridRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function colLetter(col: number): string {
  if (col < 0) return `-${colLetter(-col)}`;
  let n = col;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function cellLabel(col: number, row: number): string {
  return `${colLetter(col)}${row + 1}`;
}

export function pointToCell(
  x: number,
  y: number,
  bounds: AnchorBounds,
  cellPx: number = GRID_CELL_PX
): GridCell {
  return {
    col: Math.floor((x - bounds.x) / cellPx),
    row: Math.floor((y - bounds.y) / cellPx),
  };
}

export function cellOrigin(
  cell: GridCell,
  bounds: AnchorBounds,
  cellPx: number = GRID_CELL_PX
): { x: number; y: number } {
  return {
    x: bounds.x + cell.col * cellPx,
    y: bounds.y + cell.row * cellPx,
  };
}

export function gridExtents(
  bounds: AnchorBounds,
  cellPx: number = GRID_CELL_PX
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.ceil(bounds.width / cellPx)),
    rows: Math.max(1, Math.ceil(bounds.height / cellPx)),
  };
}

/** Four corner blocks for a window rect (b1 TL, b2 TR, b3 BL, b4 BR). */
export function windowCornerBlocks(
  rect: GridRect,
  bounds: AnchorBounds,
  cellPx: number = GRID_CELL_PX
): WindowCornerBlocks {
  const tl = pointToCell(rect.x, rect.y, bounds, cellPx);
  const tr = pointToCell(rect.x + rect.width, rect.y, bounds, cellPx);
  const bl = pointToCell(rect.x, rect.y + rect.height, bounds, cellPx);
  const br = pointToCell(
    rect.x + rect.width,
    rect.y + rect.height,
    bounds,
    cellPx
  );
  const mk = (key: "b1" | "b2" | "b3" | "b4", cell: GridCell, x: number, y: number): CornerBlock => ({
    ...cell,
    x,
    y,
    label: `${key}·${cellLabel(cell.col, cell.row)}`,
  });
  return {
    b1: mk("b1", tl, rect.x, rect.y),
    b2: mk("b2", tr, rect.x + rect.width, rect.y),
    b3: mk("b3", bl, rect.x, rect.y + rect.height),
    b4: mk("b4", br, rect.x + rect.width, rect.y + rect.height),
  };
}

function clampRect(rect: GridRect, bounds: AnchorBounds): GridRect {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  const x = Math.max(
    bounds.x,
    Math.min(bounds.x + bounds.width - width, rect.x)
  );
  const y = Math.max(
    bounds.y,
    Math.min(bounds.y + bounds.height - height, rect.y)
  );
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Snap position and size to the nearest grid blocks. */
export function snapRectToGrid(
  rect: GridRect,
  bounds: AnchorBounds,
  cellPx: number = GRID_CELL_PX
): GridRect & { corners: WindowCornerBlocks } {
  const col = Math.round((rect.x - bounds.x) / cellPx);
  const row = Math.round((rect.y - bounds.y) / cellPx);
  const cols = Math.max(1, Math.round(rect.width / cellPx));
  const rows = Math.max(1, Math.round(rect.height / cellPx));
  const snapped = clampRect(
    {
      x: bounds.x + col * cellPx,
      y: bounds.y + row * cellPx,
      width: cols * cellPx,
      height: rows * cellPx,
    },
    bounds
  );
  return {
    ...snapped,
    corners: windowCornerBlocks(snapped, bounds, cellPx),
  };
}

/**
 * Mirror a rect across a vertical focus axis (focused Graph node X).
 * Same size and Y; horizontal reflection so the pair sits on the other side.
 */
export function mirrorRectAcrossFocusX(
  rect: GridRect,
  focusX: number,
  bounds: AnchorBounds
): GridRect {
  const centerX = rect.x + rect.width / 2;
  const mirroredCenter = 2 * focusX - centerX;
  return clampRect(
    {
      x: mirroredCenter - rect.width / 2,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    bounds
  );
}

/** Default focus axis: horizontal center of the content bounds (node is framed there). */
export function defaultFocusAxisX(bounds: AnchorBounds): number {
  return bounds.x + bounds.width / 2;
}
