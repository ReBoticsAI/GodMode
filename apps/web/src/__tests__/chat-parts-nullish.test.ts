import { describe, expect, it } from "vitest";
import {
  displayTodoItems,
  flattenTodosForDisplay,
  mergeTodoItemsWithKanban,
  partsToPlainText,
  todosFromArgs,
  type MsgPart,
  type TodoItem,
} from "../components/intelligence/chat-parts";

describe("chat-parts nullish hardening (#471)", () => {
  it("flattenTodosForDisplay skips undefined/null holes without throwing", () => {
    const items = [
      undefined,
      null,
      { content: "Parent", status: "in_progress", subtasks: [undefined, null, { content: "Child", status: "pending" }] },
      { content: "   ", status: "pending" },
    ] as unknown as TodoItem[];

    expect(() => flattenTodosForDisplay(items)).not.toThrow();
    expect(flattenTodosForDisplay(items)).toEqual([
      { id: undefined, content: "Parent", status: "in_progress" },
      { id: undefined, content: "Child", status: "pending" },
    ]);
    expect(flattenTodosForDisplay(undefined)).toEqual([]);
    expect(flattenTodosForDisplay(null)).toEqual([]);
  });

  it("displayTodoItems survives sparse todos + kanban merge on re-render", () => {
    const items = [
      undefined,
      {
        id: "p1",
        content: "Ship fix",
        status: "in_progress",
        subtasks: [null, { id: "s1", content: "Write test", status: "pending" }],
      },
    ] as unknown as TodoItem[];

    expect(() =>
      displayTodoItems(items, [
        { title: "Ship fix", column_id: "in_progress", status: "working" },
        { title: "Write test", column_id: "done", status: "done" },
      ])
    ).not.toThrow();

    const shown = displayTodoItems(items, [
      { title: "Ship fix", column_id: "in_progress", status: "working" },
      { title: "Write test", column_id: "done", status: "done" },
    ]);
    expect(shown.map((t) => t.content)).toEqual(["Ship fix", "Write test"]);
    expect(shown[1]?.status).toBe("completed");
  });

  it("mergeTodoItemsWithKanban ignores nullish cards and todos", () => {
    expect(
      mergeTodoItemsWithKanban(
        [undefined as unknown as TodoItem, { content: "A", status: "pending" }],
        [undefined as unknown as { title: string; column_id: string; status: string | null }, { title: "A", column_id: "done", status: null }]
      )
    ).toEqual([{ content: "A", status: "completed" }]);
  });

  it("todosFromArgs parses nested subtasks and drops holes", () => {
    const items = todosFromArgs({
      todos: [
        null,
        {
          id: "parent",
          content: "Parent task",
          status: "in_progress",
          subtasks: [
            undefined,
            { id: "child", content: "Child step", status: "pending" },
          ],
        },
      ],
    });
    expect(items).toEqual([
      {
        id: "parent",
        content: "Parent task",
        status: "in_progress",
        subtasks: [{ id: "child", content: "Child step", status: "pending" }],
      },
    ]);
  });

  it("partsToPlainText skips nullish parts/todo rows", () => {
    const parts = [
      undefined,
      { kind: "todos", items: [undefined, { content: "X", status: "pending" }] },
      { kind: "tool", id: "t1", name: "read_file", args: undefined, status: "done", startedAt: 0 },
      { kind: "text", text: "hi" },
    ] as unknown as MsgPart[];
    expect(() => partsToPlainText(parts)).not.toThrow();
    expect(partsToPlainText(parts)).toContain("- [pending] X");
    expect(partsToPlainText(parts)).toContain("read_file");
    expect(partsToPlainText(parts)).toContain("hi");
  });
});
