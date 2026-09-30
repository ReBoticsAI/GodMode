import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPOSER_WIDTH,
  DEFAULT_PANEL_HEIGHT,
  MAX_COMPOSER_WIDTH,
  defaultComposerWidthForViewport,
  defaultPanelHeightForViewport,
} from "@/lib/intelligence-context";

describe("defaultComposerWidthForViewport", () => {
  it("floors at DEFAULT on modest viewports", () => {
    expect(defaultComposerWidthForViewport(1280)).toBe(DEFAULT_COMPOSER_WIDTH);
  });

  it("scales up on wide viewports", () => {
    expect(defaultComposerWidthForViewport(1920)).toBe(
      Math.round(1920 * 0.42)
    );
  });

  it("caps at MAX on ultrawide viewports", () => {
    expect(defaultComposerWidthForViewport(3200)).toBe(MAX_COMPOSER_WIDTH);
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
