import { describe, expect, it } from "vitest";
import { defaultStatusMap } from "../github-projects.js";

describe("defaultStatusMap", () => {
  it("maps common Status option names to GodMode columns", () => {
    const map = defaultStatusMap([
      { id: "opt-todo", name: "Todo" },
      { id: "opt-wip", name: "In Progress" },
      { id: "opt-review", name: "In Review" },
      { id: "opt-done", name: "Done" },
    ]);
    expect(map.backlog).toBe("opt-todo");
    expect(map.in_progress).toBe("opt-wip");
    expect(map.review).toBe("opt-review");
    expect(map.done).toBe("opt-done");
  });

  it("fills gaps when only some options exist", () => {
    const map = defaultStatusMap([
      { id: "a", name: "Backlog" },
      { id: "b", name: "Done" },
    ]);
    expect(map.backlog).toBe("a");
    expect(map.done).toBe("b");
    expect(map.in_progress).toBeUndefined();
    expect(map.review).toBeUndefined();
  });
});
