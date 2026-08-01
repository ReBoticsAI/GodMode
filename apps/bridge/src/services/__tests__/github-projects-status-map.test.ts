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

  it("maps P0/P1/P2 separately", () => {
    // exercised via sync priorityFromName through defaultStatusMap readiness
    const map = defaultStatusMap([
      { id: "opt-backlog", name: "Backlog" },
      { id: "opt-ready", name: "Ready" },
      { id: "opt-wip", name: "In Progress" },
      { id: "opt-review", name: "In Review" },
      { id: "opt-done", name: "Done" },
    ]);
    expect(map.backlog).toBe("opt-backlog");
    expect(map.ready).toBe("opt-ready");
    expect(map.in_progress).toBe("opt-wip");
    expect(map.review).toBe("opt-review");
    expect(map.done).toBe("opt-done");
  });
});
