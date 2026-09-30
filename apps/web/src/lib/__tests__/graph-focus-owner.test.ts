import { describe, expect, it } from "vitest";

import type { GraphProjectionNode } from "@/api";
import {
  agentIdFromFocusOwner,
  focusOwnerFromAgentId,
  focusOwnerFromGraphNode,
  focusOwnerLabel,
  productivityScopeFromFocusOwner,
  resolveFloatingNodeId,
  sideSuffixFromFocusOwner,
} from "../graph-focus-owner";

function node(
  partial: Pick<GraphProjectionNode, "id" | "kind"> &
    Partial<GraphProjectionNode>
): GraphProjectionNode {
  return {
    label: partial.label ?? partial.id,
    ...partial,
  };
}

describe("focusOwnerFromGraphNode", () => {
  it("returns none for null", () => {
    expect(focusOwnerFromGraphNode(null)).toEqual({ kind: "none" });
  });

  it("maps calendar hubs to You / Intelligence / Research / Ops", () => {
    expect(
      focusOwnerFromGraphNode(
        node({ id: "hub:calendar-you", kind: "schedule", refId: "calendar-you" })
      )
    ).toEqual({ kind: "user" });
    expect(
      focusOwnerFromGraphNode(
        node({
          id: "hub:calendar-intelligence",
          kind: "schedule",
          refId: "calendar-intelligence",
        })
      )
    ).toEqual({ kind: "agent", agentId: "intelligence" });
    expect(
      focusOwnerFromGraphNode(
        node({
          id: "hub:calendar-research",
          kind: "schedule",
          refId: "calendar-research",
        })
      )
    ).toEqual({ kind: "agent", agentId: "research" });
    expect(
      focusOwnerFromGraphNode(
        node({ id: "hub:calendar-ops", kind: "schedule", refId: "calendar-ops" })
      )
    ).toEqual({ kind: "agent", agentId: "ops" });
  });

  it("maps owner hubs and agent surface suffixes", () => {
    expect(
      focusOwnerFromGraphNode(node({ id: "hub:you", kind: "user", refId: "local" }))
    ).toEqual({ kind: "user" });
    expect(
      focusOwnerFromGraphNode(
        node({ id: "hub:intelligence", kind: "agent", refId: "intelligence" })
      )
    ).toEqual({ kind: "agent", agentId: "intelligence" });
    expect(
      focusOwnerFromGraphNode(
        node({ id: "hub:agent-research", kind: "agent", refId: "research" })
      )
    ).toEqual({ kind: "agent", agentId: "research" });
    expect(
      focusOwnerFromGraphNode(
        node({ id: "hub:structure-ops", kind: "system" })
      )
    ).toEqual({ kind: "agent", agentId: "ops" });
  });

  it("maps agent/chat refId when id has no side suffix", () => {
    expect(
      focusOwnerFromGraphNode(
        node({ id: "agent:custom-1", kind: "agent", refId: "custom-1" })
      )
    ).toEqual({ kind: "agent", agentId: "custom-1" });
    expect(
      focusOwnerFromGraphNode(
        node({ id: "chat:digital-you", kind: "chat", refId: "digital-you" })
      )
    ).toEqual({ kind: "user" });
  });

  it("returns none for platform chrome nodes", () => {
    expect(
      focusOwnerFromGraphNode(node({ id: "hub:wiki", kind: "system" }))
    ).toEqual({ kind: "none" });
    expect(
      focusOwnerFromGraphNode(node({ id: "hub:marketplace", kind: "system" }))
    ).toEqual({ kind: "none" });
    expect(
      focusOwnerFromGraphNode(node({ id: "hub:admin", kind: "system" }))
    ).toEqual({ kind: "none" });
    expect(
      focusOwnerFromGraphNode(node({ id: "hub:heart", kind: "system" }))
    ).toEqual({ kind: "none" });
  });
});

describe("focusOwnerFromAgentId / productivityScope / labels", () => {
  it("normalizes you aliases to user", () => {
    expect(focusOwnerFromAgentId("digital-you")).toEqual({ kind: "user" });
    expect(focusOwnerFromAgentId("you")).toEqual({ kind: "user" });
    expect(focusOwnerFromAgentId("local")).toEqual({ kind: "user" });
  });

  it("maps FocusOwner to ProductivityScope", () => {
    expect(productivityScopeFromFocusOwner({ kind: "user" })).toEqual({
      kind: "user",
    });
    expect(
      productivityScopeFromFocusOwner({
        kind: "agent",
        agentId: "intelligence",
      })
    ).toEqual({ kind: "agent", agentId: "intelligence" });
    expect(productivityScopeFromFocusOwner({ kind: "none" })).toBeNull();
  });

  it("labels and agentId extraction", () => {
    expect(focusOwnerLabel({ kind: "user" })).toBe("You");
    expect(focusOwnerLabel({ kind: "agent", agentId: "intelligence" })).toBe(
      "Intelligence"
    );
    expect(focusOwnerLabel({ kind: "none" })).toBeNull();
    expect(agentIdFromFocusOwner({ kind: "agent", agentId: "ops" })).toBe("ops");
    expect(agentIdFromFocusOwner({ kind: "user" })).toBeNull();
  });
});

describe("sideSuffixFromFocusOwner / resolveFloatingNodeId", () => {
  it("maps FocusOwner to catalog side suffixes", () => {
    expect(sideSuffixFromFocusOwner({ kind: "user" })).toBe("you");
    expect(
      sideSuffixFromFocusOwner({ kind: "agent", agentId: "intelligence" })
    ).toBe("intelligence");
    expect(sideSuffixFromFocusOwner({ kind: "agent", agentId: "research" })).toBe(
      "research"
    );
    expect(sideSuffixFromFocusOwner({ kind: "agent", agentId: "ops" })).toBe(
      "ops"
    );
    expect(sideSuffixFromFocusOwner({ kind: "none" })).toBeNull();
    expect(
      sideSuffixFromFocusOwner({ kind: "agent", agentId: "custom-1" })
    ).toBeNull();
  });

  it("rewrites owner-sided hub ids from focusOwner", () => {
    expect(
      resolveFloatingNodeId("hub:calendar-you", {
        kind: "agent",
        agentId: "intelligence",
      })
    ).toBe("hub:calendar-intelligence");
    expect(
      resolveFloatingNodeId("hub:bank-you", { kind: "agent", agentId: "ops" })
    ).toBe("hub:bank-ops");
    expect(
      resolveFloatingNodeId("hub:structure-you", { kind: "user" })
    ).toBe("hub:structure-you");
    expect(resolveFloatingNodeId("hub:wiki", { kind: "user" })).toBe("hub:wiki");
    expect(
      resolveFloatingNodeId("hub:calendar-you", { kind: "none" })
    ).toBe("hub:calendar-you");
    expect(resolveFloatingNodeId(null, { kind: "user" })).toBeNull();
  });
});
