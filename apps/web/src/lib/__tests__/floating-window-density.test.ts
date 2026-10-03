import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WINDOW_DENSITY_DEFAULT,
  WINDOW_DENSITY_KEY,
  WINDOW_DENSITY_MAX,
  WINDOW_DENSITY_MIN,
  WINDOW_DENSITY_PHONE_DEFAULT,
  bumpWindowDensity,
  getWindowDensity,
  setWindowDensity,
} from "../floating-window-density";

vi.mock("../graph-phone-shell", () => ({
  isPhoneViewport: vi.fn(() => false),
}));

import { isPhoneViewport } from "../graph-phone-shell";

describe("floating-window-density", () => {
  beforeEach(() => {
    vi.mocked(isPhoneViewport).mockReturnValue(false);
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it("defaults per window and keeps windows independent", () => {
    expect(getWindowDensity("chat")).toBe(WINDOW_DENSITY_DEFAULT);
    setWindowDensity("chat", 1.2);
    setWindowDensity("marketplace", 0.8);
    expect(getWindowDensity("chat")).toBe(1.2);
    expect(getWindowDensity("marketplace")).toBe(0.8);
  });

  it("clamps and steps", () => {
    expect(setWindowDensity("chat", 0.1)).toBe(WINDOW_DENSITY_MIN);
    expect(setWindowDensity("chat", 9)).toBe(WINDOW_DENSITY_MAX);
    setWindowDensity("chat", 1);
    expect(bumpWindowDensity("chat", 0.1)).toBe(1.1);
    expect(bumpWindowDensity("chat", -0.2)).toBe(0.9);
  });

  it("drops default entries from storage", () => {
    setWindowDensity("chat", 1.3);
    expect(localStorage.getItem(WINDOW_DENSITY_KEY)).toContain("1.3");
    setWindowDensity("chat", WINDOW_DENSITY_DEFAULT);
    expect(localStorage.getItem(WINDOW_DENSITY_KEY)).toBe("{}");
  });

  it("defaults to phone density when unset on phone", () => {
    vi.mocked(isPhoneViewport).mockReturnValue(true);
    expect(getWindowDensity("chat")).toBe(WINDOW_DENSITY_PHONE_DEFAULT);
    setWindowDensity("chat", 1.2);
    expect(getWindowDensity("chat")).toBe(1.2);
  });
});
