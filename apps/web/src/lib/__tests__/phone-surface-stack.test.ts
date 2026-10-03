import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissPhoneSurface,
  getPhoneSurfaceCurrent,
  getPhoneSurfaceStackDepth,
  phoneCanGoBack,
  phoneGoBack,
  pushPhoneSurface,
  replacePhoneSurface,
  resetPhoneSurfaceStackForTests,
  setPhoneSurfaceRestoreHandler,
} from "../phone-surface-stack";

const phoneMatchMedia = (query: string) => ({
  matches: query.includes("639"),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

function fakePopState(state: unknown): PopStateEvent {
  return { state, type: "popstate" } as PopStateEvent;
}

describe("phone-surface-stack", () => {
  let popstateHandler: ((ev: PopStateEvent) => void) | null = null;
  let historyStack: Array<unknown> = [null];
  let restored: Array<string | null>;

  beforeEach(() => {
    resetPhoneSurfaceStackForTests();
    popstateHandler = null;
    historyStack = [null];
    restored = [];
    vi.stubGlobal("window", {
      matchMedia: phoneMatchMedia,
      dispatchEvent: vi.fn(),
      addEventListener: (type: string, fn: EventListener) => {
        if (type === "popstate") {
          popstateHandler = fn as (ev: PopStateEvent) => void;
        }
      },
      removeEventListener: vi.fn(),
      history: {
        get state() {
          return historyStack[historyStack.length - 1] ?? null;
        },
        pushState: (data: unknown) => {
          historyStack.push(data);
        },
        back: () => {
          if (historyStack.length <= 1) return;
          historyStack.pop();
          const state = historyStack[historyStack.length - 1] ?? null;
          popstateHandler?.(fakePopState(state));
        },
      },
    });
    setPhoneSurfaceRestoreHandler((entry) => {
      restored.push(entry?.kind ?? null);
    });
  });

  it("Chat → Calendar → Back restores Social", () => {
    replacePhoneSurface({ kind: "social", tab: "chat", label: "Social" });
    pushPhoneSurface({
      kind: "information",
      tab: "calendar",
      label: "Calendar",
    });
    expect(getPhoneSurfaceStackDepth()).toBe(1);
    phoneGoBack();
    expect(getPhoneSurfaceCurrent()?.kind).toBe("social");
    expect(restored).toEqual(["social"]);
  });

  it("Back with empty stack opens Social Chat, not Graph", () => {
    replacePhoneSurface({
      kind: "information",
      tab: "calendar",
      label: "Calendar",
    });
    expect(phoneCanGoBack()).toBe(true);
    phoneGoBack();
    expect(getPhoneSurfaceCurrent()).toMatchObject({
      kind: "social",
      tab: "chat",
    });
    expect(restored).toEqual(["social"]);
  });

  it("hides Back while already on Social Chat with empty stack", () => {
    replacePhoneSurface({ kind: "social", tab: "chat", label: "Social" });
    expect(phoneCanGoBack()).toBe(false);
    phoneGoBack();
    expect(getPhoneSurfaceCurrent()?.kind).toBe("social");
    expect(restored).toEqual([]);
  });

  it("X dismiss keeps surface; later Back restores it", () => {
    replacePhoneSurface({ kind: "social", tab: "chat", label: "Social" });
    pushPhoneSurface({
      kind: "information",
      tab: "calendar",
      label: "Calendar",
    });
    dismissPhoneSurface();
    expect(getPhoneSurfaceCurrent()).toBeNull();
    expect(getPhoneSurfaceStackDepth()).toBe(2);
    expect(restored).toEqual([null]);

    // Open another node from Graph (no current to push).
    replacePhoneSurface({
      kind: "information",
      tab: "wiki",
      label: "Wiki",
    });
    phoneGoBack();
    expect(getPhoneSurfaceCurrent()?.tab).toBe("calendar");
    phoneGoBack();
    expect(getPhoneSurfaceCurrent()?.kind).toBe("social");
  });

  it("hardware Back with null history state still restores prior surface", () => {
    replacePhoneSurface({ kind: "social", tab: "chat", label: "Social" });
    pushPhoneSurface({
      kind: "information",
      tab: "calendar",
      label: "Calendar",
    });
    historyStack.pop();
    popstateHandler?.(fakePopState(null));
    expect(getPhoneSurfaceCurrent()?.kind).toBe("social");
  });
});
