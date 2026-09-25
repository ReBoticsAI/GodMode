import { describe, expect, it } from "vitest";
import { insetBoundsInsideRails } from "@/lib/floating-window-bounds";
import {
  CASCADE_OFFSET_PX,
  FOCUS_CENTER_GAP_PX,
  focusWindowAnchors,
  layoutCascadeStack,
  layoutCenteredFocusCluster,
  layoutMaximizedFocusCluster,
  tileFocusCompanionRects,
} from "@/lib/floating-window-anchors";

const bounds = { x: 0, y: 0, width: 1200, height: 700 };

describe("layoutCenteredFocusCluster", () => {
  it("centers chat + one companion around the playfield midX", () => {
    const seedW = 400;
    const seedH = 480;
    const { chat, companions, focusX } = layoutCenteredFocusCluster(
      bounds,
      seedW,
      seedH,
      1
    );
    expect(focusX).toBe(600);
    expect(companions).toHaveLength(1);
    expect(chat.width).toBe(seedW);
    expect(companions[0].width).toBe(seedW);
    // Focus axis sits in the middle of the gap between panels.
    const chatRight = chat.x + chat.width;
    const infoLeft = companions[0].x;
    expect(infoLeft - chatRight).toBe(FOCUS_CENTER_GAP_PX);
    expect(chatRight + FOCUS_CENTER_GAP_PX / 2).toBe(focusX);
    // Vertically centered
    expect(chat.y).toBeGreaterThan(bounds.y);
    expect(chat.y + chat.height).toBeLessThan(bounds.y + bounds.height);
  });

  it("keeps multi companions inside a chat-width column (not full half-screen)", () => {
    const { chat, companions, focusX } = layoutCenteredFocusCluster(
      bounds,
      400,
      480,
      4
    );
    expect(companions).toHaveLength(4);
    const maxRight = Math.max(...companions.map((t) => t.x + t.width));
    expect(maxRight - (focusX + FOCUS_CENTER_GAP_PX / 2)).toBeLessThanOrEqual(
      chat.width + 1
    );
  });
});

describe("tileFocusCompanionRects", () => {
  it("places one companion chat-sized on the focus-right side", () => {
    const seedW = 400;
    const seedH = 480;
    const [tile] = tileFocusCompanionRects(bounds, seedW, seedH, 1, "right");
    const focus = focusWindowAnchors(bounds, seedW, seedH);
    expect(tile.width).toBe(seedW);
    expect(tile.height).toBe(seedH);
    expect(tile.x).toBe(focus.right.x);
  });

  it("tiles two companions stacked within the chat-width column", () => {
    const tiles = tileFocusCompanionRects(bounds, 400, 480, 2, "right");
    expect(tiles).toHaveLength(2);
    const midX = bounds.x + bounds.width / 2;
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(midX + FOCUS_CENTER_GAP_PX / 2 - 1);
      expect(t.width).toBeLessThanOrEqual(400);
    }
    expect(tiles[1].y).toBeGreaterThan(tiles[0].y);
  });

  it("returns an empty list for count 0", () => {
    expect(tileFocusCompanionRects(bounds, 560, 480, 0)).toEqual([]);
  });
});

describe("layoutMaximizedFocusCluster", () => {
  const maxBounds = { x: 40, y: 80, width: 1400, height: 900 };

  it("fills the rect with one window", () => {
    const { chat, companions } = layoutMaximizedFocusCluster(maxBounds, 0);
    expect(companions).toEqual([]);
    expect(chat).toEqual({
      x: maxBounds.x,
      y: maxBounds.y,
      width: maxBounds.width,
      height: maxBounds.height,
    });
  });

  it("splits two windows across the rect, full height", () => {
    const { chat, companions } = layoutMaximizedFocusCluster(maxBounds, 1);
    expect(companions).toHaveLength(1);
    expect(chat.x).toBe(maxBounds.x);
    expect(chat.y).toBe(maxBounds.y);
    expect(chat.height).toBe(maxBounds.height);
    expect(companions[0].y).toBe(maxBounds.y);
    expect(companions[0].height).toBe(maxBounds.height);
    expect(companions[0].x).toBeGreaterThan(chat.x + chat.width);
    expect(companions[0].x + companions[0].width).toBe(
      maxBounds.x + maxBounds.width
    );
  });

  it("stacks the right column when two companions share the max rect", () => {
    const { chat, companions } = layoutMaximizedFocusCluster(maxBounds, 2);
    expect(companions).toHaveLength(2);
    expect(chat.height).toBe(maxBounds.height);
    expect(companions[1].y).toBeGreaterThan(companions[0].y);
    expect(companions[0].x).toBe(companions[1].x);
    const bottom = companions[1].y + companions[1].height;
    expect(bottom).toBeLessThanOrEqual(maxBounds.y + maxBounds.height);
    expect(bottom).toBeGreaterThan(maxBounds.y + maxBounds.height - 12);
  });
});

describe("layoutCascadeStack", () => {
  it("offsets each window diagonally from the focus-right anchor", () => {
    const seedW = 400;
    const seedH = 480;
    const rects = layoutCascadeStack(bounds, seedW, seedH, 3);
    expect(rects).toHaveLength(3);
    const base = focusWindowAnchors(bounds, seedW, seedH).right;
    expect(rects[0].x).toBe(base.x);
    expect(rects[0].y).toBe(base.y);
    expect(rects[1].x).toBe(base.x + CASCADE_OFFSET_PX);
    expect(rects[1].y).toBe(base.y + CASCADE_OFFSET_PX);
    expect(rects[2].x).toBe(base.x + CASCADE_OFFSET_PX * 2);
    expect(rects[2].y).toBe(base.y + CASCADE_OFFSET_PX * 2);
    for (const r of rects) {
      expect(r.width).toBe(seedW);
      expect(r.height).toBe(seedH);
      expect(r.x).toBeGreaterThanOrEqual(bounds.x);
      expect(r.y).toBeGreaterThanOrEqual(bounds.y);
      expect(r.x + r.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(r.y + r.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    // Stack stays on the right half (not behind chat / focus-left).
    const midX = bounds.x + bounds.width / 2;
    expect(rects[0].x).toBeGreaterThanOrEqual(midX);
  });

  it("returns empty for count 0", () => {
    expect(layoutCascadeStack(bounds, 560, 480, 0)).toEqual([]);
  });
});

describe("insetBoundsInsideRails", () => {
  it("pulls the sides in to the inner edge of each button column", () => {
    const next = insetBoundsInsideRails(
      { x: 0, y: 90, width: 1600, height: 800 },
      { leftInner: 52, rightInner: 1548 }
    );
    expect(next.y).toBe(90);
    expect(next.height).toBe(800);
    expect(next.x).toBe(60);
    expect(next.x + next.width).toBe(1540);
  });
});
