import { describe, expect, it } from "vitest";
import {
  filterSchemasForSignupGuide,
  GRAPH_TOUR_DWELL_MS,
  resolveGraphTour,
  resolveGuideChoice,
  resolveGuideGraphNode,
  resolveGuideSurface,
  SIGNUP_GUIDE_TOOL_ALLOW,
} from "../guide-ui-tools.js";

describe("guide-ui-tools", () => {
  it("resolves godmode_inference and buy-more aliases", () => {
    expect(resolveGuideSurface("godmode_inference").ok).toBe(true);
    const buy = resolveGuideSurface("buy more");
    expect(buy.ok).toBe(true);
    if (buy.ok) {
      expect(buy.uiAction).toMatchObject({
        type: "open_surface",
        tab: "platform-vault",
        vault: "inference",
        sub: "godmode",
      });
    }
  });

  it("rejects unknown surfaces", () => {
    expect(resolveGuideSurface("not-a-real-surface").ok).toBe(false);
  });

  it("resolves intelligence and hub:heart nodes", () => {
    const intel = resolveGuideGraphNode("intelligence");
    expect(intel.ok).toBe(true);
    if (intel.ok) {
      expect(intel.uiAction).toMatchObject({
        type: "focus_node",
        nodeId: "hub:intelligence",
      });
    }
    expect(resolveGuideGraphNode("hub:heart").ok).toBe(true);
  });

  it("builds a timed tour and drops unknown nodes", () => {
    const tour = resolveGraphTour([
      { node: "you", say: "This is you." },
      { node: "not-a-node", say: "Skip me." },
      { node: "wiki", say: "Wiki holds pages." },
      { node: "marketplace", say: "Sell from here." },
    ]);
    expect(tour.ok).toBe(true);
    if (!tour.ok) return;
    expect(tour.uiAction).toMatchObject({
      type: "graph_tour",
      dwellMs: GRAPH_TOUR_DWELL_MS,
    });
    if (tour.uiAction.type !== "graph_tour") return;
    expect(tour.uiAction.stops.map((s) => s.label)).toEqual([
      "You",
      "Wiki",
      "Marketplace",
    ]);
    expect(resolveGraphTour([{ node: "you", say: "Only one." }]).ok).toBe(false);
  });

  it("returns the fixed next-step choices", () => {
    const choice = resolveGuideChoice();
    expect(choice.ok).toBe(true);
    if (choice.uiAction.type !== "guide_choice") return;
    expect(choice.uiAction.options.map((option) => option.id)).toEqual([
      "download",
      "inference",
      "cloud",
      "cloud_inference",
      "seller",
    ]);
    expect(choice.uiAction.why).toContain("Local with Inference");
    expect(choice.uiAction.why).toContain("Cloud with Inference");
  });

  it("filters schemas to signup-guide allowlist", () => {
    const schemas = [
      { function: { name: "open_guide_surface" } },
      { function: { name: "focus_graph_node" } },
      { function: { name: "play_graph_tour" } },
      { function: { name: "ask_guide_choice" } },
      { function: { name: "read_wiki_page" } },
      { function: { name: "run_terminal" } },
      { function: { name: "create_page" } },
    ];
    const filtered = filterSchemasForSignupGuide(schemas);
    expect(filtered.map((s) => s.function.name).sort()).toEqual(
      [...SIGNUP_GUIDE_TOOL_ALLOW].sort()
    );
  });
});
