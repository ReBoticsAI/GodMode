import { describe, expect, it } from "vitest";
import {
  enrichRestTimelineWithProjectGraphql,
  normalizeTimelineInstant,
  summarizeGithubTimelineEvent,
} from "../github-projects.js";

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

  it("formats project status from → to when present", () => {
    expect(
      summarizeGithubTimelineEvent({
        event: "project_v2_item_status_changed",
        actor: { login: "alice" },
        previous_status: "Ready",
        project_status: "In progress",
        project: { title: "GodMode Roadmap" },
      })
    ).toBe(
      "alice moved this from Ready to In progress on GodMode Roadmap"
    );
    expect(
      summarizeGithubTimelineEvent({
        event: "project_v2_item_status_changed",
        actor: { login: "bot" },
        previous_status: "",
        project_status: "Backlog",
        project_title: "GodMode Roadmap",
      })
    ).toBe("bot moved this to Backlog on GodMode Roadmap");
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

describe("enrichRestTimelineWithProjectGraphql", () => {
  it("normalizes instants to second precision", () => {
    expect(normalizeTimelineInstant("2026-08-04T02:45:45.123Z")).toBe(
      "2026-08-04T02:45:45Z"
    );
  });

  it("merges GraphQL from/to and project title onto REST rows", () => {
    const enriched = enrichRestTimelineWithProjectGraphql(
      [
        {
          id: 1,
          event: "project_v2_item_status_changed",
          created_at: "2026-08-04T02:45:45Z",
          actor: { login: "alice" },
        },
        {
          id: 2,
          event: "added_to_project_v2",
          created_at: "2026-08-02T04:55:58Z",
          actor: { login: "bot" },
        },
      ],
      [
        {
          kind: "status_changed",
          createdAt: "2026-08-04T02:45:45Z",
          previousStatus: "Ready",
          status: "In progress",
          projectTitle: "GodMode Roadmap",
        },
        {
          kind: "added",
          createdAt: "2026-08-02T04:55:58Z",
          projectTitle: "GodMode Roadmap",
        },
      ]
    );
    expect(summarizeGithubTimelineEvent(enriched[0]!)).toBe(
      "alice moved this from Ready to In progress on GodMode Roadmap"
    );
    expect(summarizeGithubTimelineEvent(enriched[1]!)).toBe(
      "bot added this to GodMode Roadmap"
    );
  });
});
