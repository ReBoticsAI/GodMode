import { describe, expect, it } from "vitest";
import {
  boardFilterActive,
  boardFilterNarrowing,
  cardsForColumn,
  compareCards,
  DEFAULT_BOARD_FILTER,
  filterAndSortBoardCards,
  type BoardFilterState,
  type FilterableCard,
} from "../lib/tasks-board-filters";

function card(partial: Partial<FilterableCard> & { id: string }): FilterableCard {
  return {
    column_id: "ready",
    title: "Card",
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

describe("tasks-board-filters", () => {
  it("matches title and description search", () => {
    const cards = [
      card({ id: "1", title: "Alpha deploy", description: "ship it" }),
      card({ id: "2", title: "Beta", description: "deploy notes" }),
      card({ id: "3", title: "Gamma", description: "other" }),
    ];
    const state: BoardFilterState = { ...DEFAULT_BOARD_FILTER, query: "deploy" };
    expect(filterAndSortBoardCards(cards, state).map((c) => c.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("filters by priority, labels, assignees, milestone, column", () => {
    const cards = [
      card({
        id: "a",
        column_id: "ready",
        priority: 0,
        tags_json: JSON.stringify(["auto", "p0"]),
        context_json: JSON.stringify({
          github: {
            assignees: [{ login: "alice" }],
            milestone: { title: "M1" },
          },
        }),
      }),
      card({
        id: "b",
        column_id: "done",
        priority: 2,
        tags_json: JSON.stringify(["docs"]),
        context_json: JSON.stringify({
          github: {
            assignees: [{ login: "bob" }],
            milestone: { title: "M2" },
          },
        }),
      }),
    ];
    const state: BoardFilterState = {
      ...DEFAULT_BOARD_FILTER,
      priorities: [0],
      labels: ["auto"],
      assignees: ["alice"],
      milestones: ["M1"],
      columns: ["ready"],
    };
    expect(filterAndSortBoardCards(cards, state).map((c) => c.id)).toEqual(["a"]);
  });

  it("sorts by due then priority", () => {
    const a = card({ id: "a", due_at: "2026-08-10", priority: 2, sort_order: 1 });
    const b = card({ id: "b", due_at: "2026-08-01", priority: 1, sort_order: 0 });
    const c = card({ id: "c", due_at: null, priority: 0, sort_order: 2 });
    expect([a, b, c].sort((x, y) => compareCards(x, y, "due")).map((x) => x.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("keeps column grouping after filter and reports empty columns", () => {
    const cards = [
      card({ id: "1", column_id: "ready", title: "match me" }),
      card({ id: "2", column_id: "done", title: "other" }),
    ];
    const state: BoardFilterState = { ...DEFAULT_BOARD_FILTER, query: "match" };
    expect(cardsForColumn(cards, "ready", state).map((c) => c.id)).toEqual(["1"]);
    expect(cardsForColumn(cards, "done", state)).toEqual([]);
  });

  it("treats sort-only changes as active but not narrowing", () => {
    const sorted: BoardFilterState = { ...DEFAULT_BOARD_FILTER, sort: "due" };
    expect(boardFilterActive(sorted)).toBe(true);
    expect(boardFilterNarrowing(sorted)).toBe(false);
    const queried: BoardFilterState = { ...DEFAULT_BOARD_FILTER, query: "x" };
    expect(boardFilterNarrowing(queried)).toBe(true);
  });

  it("excludes subtasks from the board filter list", () => {
    const cards = [
      card({ id: "parent", title: "Parent" }),
      card({ id: "child", title: "Parent child", parent_card_id: "parent" }),
    ];
    expect(
      filterAndSortBoardCards(cards, { ...DEFAULT_BOARD_FILTER, query: "Parent" }).map(
        (c) => c.id
      )
    ).toEqual(["parent"]);
  });
});
