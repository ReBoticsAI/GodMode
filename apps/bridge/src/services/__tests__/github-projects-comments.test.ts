import { describe, expect, it } from "vitest";
import { resolveGithubIssueRef } from "../github-projects.js";

describe("resolveGithubIssueRef", () => {
  it("reads repo and issue number from github context", () => {
    const raw = JSON.stringify({
      github: {
        repo: "ReBoticsAI/GodMode",
        issueNumber: 293,
        url: "https://github.com/ReBoticsAI/GodMode/issues/293",
        projectItemId: "PVTI_1",
      },
    });
    expect(resolveGithubIssueRef(raw)).toEqual({
      repo: "ReBoticsAI/GodMode",
      owner: "ReBoticsAI",
      name: "GodMode",
      issueNumber: 293,
      url: "https://github.com/ReBoticsAI/GodMode/issues/293",
    });
  });

  it("returns null for draft items without an issue number", () => {
    const raw = JSON.stringify({
      github: { projectItemId: "PVTI_1", contentId: "DI_1" },
    });
    expect(resolveGithubIssueRef(raw)).toBeNull();
  });

  it("returns null for missing or invalid context", () => {
    expect(resolveGithubIssueRef(null)).toBeNull();
    expect(resolveGithubIssueRef("{")).toBeNull();
    expect(
      resolveGithubIssueRef(
        JSON.stringify({ github: { repo: "nope", issueNumber: 1 } })
      )
    ).toBeNull();
  });
});
