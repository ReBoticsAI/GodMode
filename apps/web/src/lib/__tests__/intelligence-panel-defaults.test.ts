import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPOSER_WIDTH,
  DEFAULT_COMPOSER_WIDTH_FRAC,
  DEFAULT_PANEL_HEIGHT,
  HUB_COLUMN_GAP_PX,
  HUB_COLUMN_VIEWPORT_FRAC,
  MAX_COMPOSER_WIDTH,
  MIN_COMPOSER_WIDTH,
  SOCIAL_LEFT_INSET_PX,
  defaultComposerWidthForViewport,
  defaultPanelHeightForViewport,
  resolveComposerWidthForViewport,
} from "@/lib/intelligence-context";

function expectedDefault(viewportWidth: number): number {
  const half =
    viewportWidth * DEFAULT_COMPOSER_WIDTH_FRAC - SOCIAL_LEFT_INSET_PX;
  const hubCutoff =
    viewportWidth * HUB_COLUMN_VIEWPORT_FRAC -
    SOCIAL_LEFT_INSET_PX -
    HUB_COLUMN_GAP_PX;
  return Math.max(
    MIN_COMPOSER_WIDTH,
    Math.min(
      MAX_COMPOSER_WIDTH,
      Math.round(Math.max(DEFAULT_COMPOSER_WIDTH, Math.min(half, hubCutoff)))
    )
  );
}

describe("defaultComposerWidthForViewport", () => {
  it("floors at DEFAULT on modest viewports", () => {
    expect(defaultComposerWidthForViewport(1280)).toBe(DEFAULT_COMPOSER_WIDTH);
  });

  it("uses half the screen cut off at the You/Intelligence column", () => {
    expect(defaultComposerWidthForViewport(1920)).toBe(expectedDefault(1920));
    expect(defaultComposerWidthForViewport(2532)).toBe(expectedDefault(2532));
    expect(defaultComposerWidthForViewport(2532)).toBeLessThan(
      Math.round(2532 * 0.5 - SOCIAL_LEFT_INSET_PX)
    );
  });

  it("never exceeds MAX", () => {
    expect(defaultComposerWidthForViewport(4000)).toBeLessThanOrEqual(
      MAX_COMPOSER_WIDTH
    );
  });
});

describe("resolveComposerWidthForViewport", () => {
  it("heals phone-min widths on desktop", () => {
    expect(resolveComposerWidthForViewport(MIN_COMPOSER_WIDTH, 1440)).toBe(
      defaultComposerWidthForViewport(1440)
    );
    expect(resolveComposerWidthForViewport(360, 1920)).toBe(
      defaultComposerWidthForViewport(1920)
    );
  });

  it("keeps a deliberate desktop width", () => {
    expect(resolveComposerWidthForViewport(800, 1440)).toBe(800);
  });
});

describe("defaultPanelHeightForViewport", () => {
  it("uses most of the usable height on tall screens", () => {
    const h = defaultPanelHeightForViewport(1440);
    expect(h).toBeGreaterThan(DEFAULT_PANEL_HEIGHT);
    expect(h).toBeLessThanOrEqual(1440 - 96);
  });

  it("stays within usable height on short screens", () => {
    const h = defaultPanelHeightForViewport(720);
    expect(h).toBeLessThanOrEqual(720 - 96);
    expect(h).toBeGreaterThanOrEqual(240);
  });
});
