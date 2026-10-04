import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ALLOWANCE_OUT_TOUR_STOPS,
  EXPLORE_BUY_TOUR_STOPS,
  isInferenceAllowanceExhaustedError,
  playAllowanceOutTour,
  playExploreBuyTour,
} from "../explore-buy-tour";

describe("explore buy tour", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("frames Hub then Platform Vault", () => {
    expect(EXPLORE_BUY_TOUR_STOPS.map((s) => s.nodeId)).toEqual([
      "hub:heart",
      "hub:vault-platform",
    ]);
    expect(ALLOWANCE_OUT_TOUR_STOPS.map((s) => s.nodeId)).toEqual([
      "hub:vault-platform",
    ]);
    for (const stop of [...EXPLORE_BUY_TOUR_STOPS, ...ALLOWANCE_OUT_TOUR_STOPS]) {
      expect(stop.say).not.toContain("\u2014");
      expect(stop.say).not.toContain(" -- ");
    }
  });

  it("dispatches soft focus events for explore buy tour", () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    playExploreBuyTour(1000);
    const first = dispatchEvent.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === "godmode:focus-graph-node"
    )?.[0] as CustomEvent<{ nodeId: string; soft?: boolean; tour?: boolean }>;
    expect(first?.detail).toEqual({ nodeId: "hub:heart", soft: true });
  });

  it("dispatches soft Platform Vault focus for allowance-out tour", () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    playAllowanceOutTour(1000);
    const first = dispatchEvent.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === "godmode:focus-graph-node"
    )?.[0] as CustomEvent<{ nodeId: string; soft?: boolean }>;
    expect(first?.detail).toEqual({
      nodeId: "hub:vault-platform",
      soft: true,
    });
  });

  it("detects allowance exhausted stream errors", () => {
    expect(
      isInferenceAllowanceExhaustedError(
        "GodMode Inference allowance exhausted. Buy Inference in Vault."
      )
    ).toBe(true);
    expect(
      isInferenceAllowanceExhaustedError(null, "INFERENCE_ALLOWANCE_EXHAUSTED")
    ).toBe(true);
    expect(isInferenceAllowanceExhaustedError("CURSOR_SESSION_STALE")).toBe(
      false
    );
  });
});
