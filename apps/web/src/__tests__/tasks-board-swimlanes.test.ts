import { describe, expect, it } from "vitest";
import type { FilterableCard } from "../lib/tasks-board-filters";
import {
  buildSwimlanes,
  cardsInSwimlane,
  primaryAssigneeLogin,
  swimlaneIdForCard,
} from "../lib/tasks-board-swimlanes";

function card(partial: Partial<FilterableCard> & { id: string }): FilterableCard {
  return {
    column_id: "ready",
    title: "Task",
    description: null,
    tags_json: null,
    due_at: null,
    priority: 2,
    sort_order: 0,
    parent_card_id: null,
    context_json: null,
    ...partial,
  };
}

describe("tasks-board-swimlanes", () => {
  it("builds a single lane when group-by is none", () => {
    const lanes = buildSwimlanes([card({ id: "a" })], "none");
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.id).toBe("none");
  });

  it("groups by priority into P0–P3 lanes", () => {
    const cards = [
      card({ id: "a", priority: 0 }),
      card({ id: "b", priority: 2 }),
    ];
    const lanes = buildSwimlanes(cards, "priority");
    expect(lanes.map((l) => l.id)).toEqual([
      "priority:0",
      "priority:1",
      "priority:2",
      "priority:3",
    ]);
    expect(cardsInSwimlane(cards, lanes[0]!, "priority").map((c) => c.id)).toEqual([
      "a",
    ]);
    expect(swimlaneIdForCard(cards[1]!, "priority")).toBe("priority:2");
  });

  it("groups by primary assignee with Unassigned lane", () => {
    const cards = [
      card({
        id: "a",
        context_json: JSON.stringify({
          github: { assignees: [{ login: "alice" }] },
        }),
      }),
      card({ id: "b", context_json: null }),
    ];
    expect(primaryAssigneeLogin(cards[0]!)).toBe("alice");
    const lanes = buildSwimlanes(cards, "assignee");
    expect(lanes.map((l) => l.label)).toEqual(["alice", "Unassigned"]);
    expect(
      cardsInSwimlane(cards, lanes[1]!, "assignee").map((c) => c.id)
    ).toEqual(["b"]);
  });
});
