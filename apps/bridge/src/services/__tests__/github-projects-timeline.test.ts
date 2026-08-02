import { describe, expect, it } from "vitest";
import { summarizeGithubTimelineEvent } from "../github-projects.js";

describe("summarizeGithubTimelineEvent", () => {
  it("formats label and assignee events", () => {
    expect(
      summarizeGithubTimelineEvent({
        event: "labeled",
        actor: { login: "alice" },
        label: { name: "core" },
      })
    ).toBe("alice added label core");
    expect(
      summarizeGithubTimelineEvent({
        event: "assigned",
        actor: { login: "alice" },
        assignee: { login: "bob" },
      })
    ).toBe("alice assigned bob");
  });

  it("formats project v2 activity without status detail", () => {
    expect(
      summarizeGithubTimelineEvent({
        event: "added_to_project_v2",
        actor: { login: "github-project-automation[bot]" },
      })
    ).toBe("github-project-automation[bot] added this to a Project");
    expect(
      summarizeGithubTimelineEvent({
        event: "project_v2_item_status_changed",
        actor: { login: "alice" },
      })
    ).toBe("alice changed the Project status");
  });

  it("skips comment events and formats close/rename", () => {
    expect(
      summarizeGithubTimelineEvent({
        event: "commented",
        actor: { login: "alice" },
      })
    ).toBeNull();
    expect(
      summarizeGithubTimelineEvent({
        event: "closed",
        actor: { login: "alice" },
      })
    ).toBe("alice closed this");
    expect(
      summarizeGithubTimelineEvent({
        event: "renamed",
        actor: { login: "alice" },
        rename: { from: "Old", to: "New" },
      })
    ).toBe('alice renamed from "Old" to "New"');
  });
});
