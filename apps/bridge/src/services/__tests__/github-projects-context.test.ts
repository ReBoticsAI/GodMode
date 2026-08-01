import { describe, expect, it } from "vitest";
import { normalizeCardContextObject } from "../github-projects.js";

describe("normalizeCardContextObject", () => {
  it("upgrades legacy attachment arrays", () => {
    const raw = JSON.stringify([{ id: "page", label: "Home" }]);
    expect(normalizeCardContextObject(raw)).toEqual({
      attachments: [{ id: "page", label: "Home" }],
    });
  });

  it("preserves object context with github metadata", () => {
    const raw = JSON.stringify({
      attachments: [{ id: "a", label: "A" }],
      github: { projectItemId: "PVTI_1", assignees: [{ login: "octocat" }] },
    });
    const out = normalizeCardContextObject(raw);
    expect(out.attachments).toEqual([{ id: "a", label: "A" }]);
    expect(out.github).toEqual({
      projectItemId: "PVTI_1",
      assignees: [{ login: "octocat" }],
    });
  });

  it("returns empty object for null or invalid json", () => {
    expect(normalizeCardContextObject(null)).toEqual({});
    expect(normalizeCardContextObject("{")).toEqual({});
  });
});
