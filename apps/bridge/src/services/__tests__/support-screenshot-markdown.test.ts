import { describe, expect, it } from "vitest";
import {
  CORE_GITHUB_OWNER,
  CORE_GITHUB_REPO,
  SUPPORT_MEDIA_BRANCH,
  supportScreenshotMarkdown,
} from "../github-app-issues.js";

describe("support screenshot markdown", () => {
  it("formats public raw URLs for issue bodies", () => {
    const url = `https://raw.githubusercontent.com/${CORE_GITHUB_OWNER}/${CORE_GITHUB_REPO}/${SUPPORT_MEDIA_BRANCH}/.github/godmode-support-screenshots/abc.png`;
    const md = supportScreenshotMarkdown([url]);
    expect(md).toContain("### Screenshot");
    expect(md).toContain(`![Support screenshot 1](${url})`);
  });

  it("returns empty string when no urls", () => {
    expect(supportScreenshotMarkdown([])).toBe("");
    expect(supportScreenshotMarkdown(["", "  "])).toBe("");
  });
});
