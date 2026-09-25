import { describe, expect, it } from "vitest";
import {
  GRID_CELL_PX,
  cellLabel,
  mirrorRectAcrossFocusX,
  snapRectToGrid,
  windowCornerBlocks,
} from "@/lib/floating-window-grid";

const bounds = { x: 0, y: 0, width: 800, height: 600 };

describe("floating-window-grid", () => {
  it("labels cells with column letters and 1-based rows", () => {
    expect(cellLabel(0, 0)).toBe("A1");
    expect(cellLabel(1, 2)).toBe("B3");
  });

  it("maps window corners to b1–b4 blocks", () => {
    const rect = {
      x: 40,
      y: 80,
      width: 200,
      height: 120,
    };
    const corners = windowCornerBlocks(rect, bounds);
    expect(corners.b1.label).toMatch(/^b1·/);
    expect(corners.b2.label).toMatch(/^b2·/);
    expect(corners.b3.label).toMatch(/^b3·/);
    expect(corners.b4.label).toMatch(/^b4·/);
    expect(corners.b1.col).toBe(1);
    expect(corners.b1.row).toBe(2);
  });

  it("snaps rects to the grid", () => {
    const snapped = snapRectToGrid(
      { x: 47, y: 53, width: 195, height: 110 },
      bounds
    );
    expect(snapped.x % GRID_CELL_PX).toBe(0);
    expect(snapped.y % GRID_CELL_PX).toBe(0);
    expect(snapped.width % GRID_CELL_PX).toBe(0);
    expect(snapped.height % GRID_CELL_PX).toBe(0);
  });

  it("mirrors a window across the focus axis", () => {
    const source = { x: 40, y: 100, width: 200, height: 300 };
    const focusX = 400;
    const mirrored = mirrorRectAcrossFocusX(source, focusX, bounds);
    expect(mirrored.width).toBe(200);
    expect(mirrored.height).toBe(300);
    expect(mirrored.y).toBe(100);
    // Centers equidistant from focusX
    const srcCenter = source.x + source.width / 2;
    const mirCenter = mirrored.x + mirrored.width / 2;
    expect(mirCenter).toBe(2 * focusX - srcCenter);
  });
});
