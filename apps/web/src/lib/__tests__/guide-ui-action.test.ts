import { describe, expect, it, vi } from "vitest";
import {
  applyGuideUiAction,
  guideUiActionFromToolResult,
  playGraphTour,
} from "../guide-ui-action";

vi.mock("sonner", () => ({
  toast: { message: vi.fn() },
}));

describe("guideUiActionFromToolResult", () => {
  it("reads open_surface actions", () => {
    expect(
      guideUiActionFromToolResult({
        ok: true,
        uiAction: {
          type: "open_surface",
          tab: "platform-vault",
          vault: "inference",
          sub: "godmode",
          label: "GodMode Inference",
        },
      })
    ).toEqual({
      type: "open_surface",
      tab: "platform-vault",
      vault: "inference",
      sub: "godmode",
      label: "GodMode Inference",
    });
  });

  it("reads focus_node actions", () => {
    expect(
      guideUiActionFromToolResult({
        uiAction: { type: "focus_node", nodeId: "hub:you", label: "You" },
      })
    ).toEqual({ type: "focus_node", nodeId: "hub:you", label: "You" });
  });

  it("reads guide choice buttons", () => {
    expect(
      guideUiActionFromToolResult({
        uiAction: {
          type: "guide_choice",
          question: "How do you want to move forward?",
          why: "Local with Inference stays on your computer.",
          options: [{ id: "download", label: "Download for my computer" }],
        },
      })
    ).toEqual({
      type: "guide_choice",
      question: "How do you want to move forward?",
      why: "Local with Inference stays on your computer.",
      options: [{ id: "download", label: "Download for my computer" }],
    });
  });

  it("reads a graph tour", () => {
    expect(
      guideUiActionFromToolResult({
        uiAction: {
          type: "graph_tour",
          dwellMs: 10000,
          stops: [
            { nodeId: "hub:you", label: "You", say: "This is you." },
            { nodeId: "hub:wiki", label: "Wiki", say: "Pages live here." },
          ],
        },
      })
    ).toEqual({
      type: "graph_tour",
      dwellMs: 10000,
      stops: [
        { nodeId: "hub:you", label: "You", say: "This is you." },
        { nodeId: "hub:wiki", label: "Wiki", say: "Pages live here." },
      ],
    });
  });

  it("ignores malformed payloads", () => {
    expect(guideUiActionFromToolResult(null)).toBeNull();
    expect(guideUiActionFromToolResult({ ok: true })).toBeNull();
    expect(
      guideUiActionFromToolResult({ uiAction: { type: "open_surface" } })
    ).toBeNull();
  });
});

describe("applyGuideUiAction", () => {
  it("dispatches platform vault and focus events", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("queueMicrotask", (fn: () => void) => fn());
    applyGuideUiAction({
      type: "open_surface",
      tab: "platform-vault",
      vault: "inference",
      sub: "godmode",
      label: "GodMode Inference",
    });
    applyGuideUiAction({ type: "focus_node", nodeId: "hub:intelligence" });
    applyGuideUiAction({ type: "open_surface", tab: "chat" });

    const names = dispatchEvent.mock.calls.map(
      (c) => (c[0] as CustomEvent).type
    );
    expect(names).toEqual([
      "godmode:open-platform-vault",
      "godmode:open-intelligence-chat",
      "godmode:focus-graph-node",
      "godmode:open-intelligence-chat",
    ]);
    vi.unstubAllGlobals();
  });
});

describe("playGraphTour", () => {
  it("explains the first stop now and the next one after 10 seconds", () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
    playGraphTour(
      [
        { nodeId: "hub:you", label: "You", say: "This is you." },
        { nodeId: "hub:heart", label: "Hub", say: "This is Hub." },
      ],
      10_000
    );
    const typesNow = dispatchEvent.mock.calls.map((c) => (c[0] as CustomEvent).type);
    expect(typesNow).toContain("godmode:focus-graph-node");
    expect(typesNow).toContain("godmode:graph-tour-line");
    const firstFocus = dispatchEvent.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === "godmode:focus-graph-node"
    )?.[0] as CustomEvent<{ nodeId: string; tour: boolean }>;
    expect(firstFocus.detail).toEqual({ nodeId: "hub:you", tour: true });

    vi.advanceTimersByTime(10_000);
    const focuses = dispatchEvent.mock.calls
      .map((c) => c[0] as CustomEvent<{ nodeId?: string }>)
      .filter((event) => event.type === "godmode:focus-graph-node")
      .map((event) => event.detail.nodeId);
    expect(focuses).toEqual(["hub:you", "hub:heart"]);
    expect(
      dispatchEvent.mock.calls.some((c) => (c[0] as CustomEvent).type === "godmode:graph-tour-done")
    ).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(
      dispatchEvent.mock.calls.some((c) => (c[0] as CustomEvent).type === "godmode:graph-tour-done")
    ).toBe(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
