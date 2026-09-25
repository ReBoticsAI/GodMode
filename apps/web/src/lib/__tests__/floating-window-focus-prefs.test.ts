import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_TILING_ENABLED_KEY,
  FOCUS_WINDOW_SCALE_KEY,
} from "@/lib/storage-keys";
import {
  FOCUS_WINDOW_SCALE_DEFAULT,
  FOCUS_WINDOW_SCALE_MAX,
  FOCUS_WINDOW_SCALE_MIN,
  bumpFocusWindowScale,
  getFocusWindowScale,
  isFocusTilingEnabled,
  setFocusTilingEnabled,
  setFocusWindowScale,
} from "@/lib/floating-window-focus-prefs";

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const api = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", api);
  return api;
}

describe("floating-window-focus-prefs", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults scale to 1 and tiling to on", () => {
    expect(getFocusWindowScale()).toBe(FOCUS_WINDOW_SCALE_DEFAULT);
    expect(isFocusTilingEnabled()).toBe(true);
  });

  it("clamps scale to min/max", () => {
    expect(setFocusWindowScale(0.1)).toBe(FOCUS_WINDOW_SCALE_MIN);
    expect(getFocusWindowScale()).toBe(FOCUS_WINDOW_SCALE_MIN);
    expect(setFocusWindowScale(9)).toBe(FOCUS_WINDOW_SCALE_MAX);
    expect(getFocusWindowScale()).toBe(FOCUS_WINDOW_SCALE_MAX);
  });

  it("bumps scale in steps without exceeding bounds", () => {
    setFocusWindowScale(1);
    expect(bumpFocusWindowScale(0.1)).toBe(1.1);
    expect(bumpFocusWindowScale(0.1)).toBe(1.2);
    setFocusWindowScale(FOCUS_WINDOW_SCALE_MAX);
    expect(bumpFocusWindowScale(0.1)).toBe(FOCUS_WINDOW_SCALE_MAX);
    setFocusWindowScale(FOCUS_WINDOW_SCALE_MIN);
    expect(bumpFocusWindowScale(-0.1)).toBe(FOCUS_WINDOW_SCALE_MIN);
  });

  it("persists tiling toggle", () => {
    setFocusTilingEnabled(false);
    expect(isFocusTilingEnabled()).toBe(false);
    expect(localStorage.getItem(FOCUS_TILING_ENABLED_KEY)).toBe("0");
    setFocusTilingEnabled(true);
    expect(isFocusTilingEnabled()).toBe(true);
    expect(localStorage.getItem(FOCUS_TILING_ENABLED_KEY)).toBe("1");
  });

  it("round-trips scale through storage", () => {
    setFocusWindowScale(1.3);
    expect(localStorage.getItem(FOCUS_WINDOW_SCALE_KEY)).toBe("1.3");
    expect(getFocusWindowScale()).toBe(1.3);
  });
});
