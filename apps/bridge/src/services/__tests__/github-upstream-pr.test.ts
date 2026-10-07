import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_TOOL_REGISTRY } from "../ai-tools-registry.js";
import {
  CORE_GITHUB_OWNER,
  CORE_GITHUB_REPO,
} from "../github-app-issues.js";
import { rejectPiiHints } from "../support-report.js";

describe("community Core fix PR wiring", () => {
  it("registers ask_user_choice and github_fork_repo", () => {
    const names = AI_TOOL_REGISTRY.map((t) => t.name);
    expect(names).toContain("ask_user_choice");
    expect(names).toContain("github_fork_repo");
    const pr = AI_TOOL_REGISTRY.find((t) => t.name === "github_pr_create");
    expect(pr?.parameters?.properties).toHaveProperty("upstreamOwner");
    expect(pr?.parameters?.properties).toHaveProperty("upstreamRepo");
  });

  it("exports Core GitHub constants for fork defaults", () => {
    expect(CORE_GITHUB_OWNER).toBe("ReBoticsAI");
    expect(CORE_GITHUB_REPO).toBe("GodMode");
  });

  it("formats cross-fork head like Marketplace catalog PRs", () => {
    const forkOwner = "dane-contrib";
    const branch = "fix/support-e2e";
    const head = `${forkOwner}:${branch}`;
    expect(head).toBe("dane-contrib:fix/support-e2e");
  });

  it("rejectPiiHints blocks emails and secrets for public PR bodies", () => {
    expect(() =>
      rejectPiiHints("Fix NPE in bridge\n\nContact me at person@example.com")
    ).toThrow(/email/i);
    expect(() =>
      rejectPiiHints("api_key=sk-test-1234567890abcdefghijklmnop")
    ).toThrow(/secret/i);
    expect(() =>
      rejectPiiHints(
        "Fixes #1234\n\nRepro: open Support, file report_platform_issue."
      )
    ).not.toThrow();
  });

  it("Support skill documents gather → choose contribute PR flow", () => {
    const skillPath = path.join(
      process.cwd(),
      "apps/bridge/data/ai/skills-bootstrap/support/SKILL.md"
    );
    const raw = fs.readFileSync(skillPath, "utf8");
    expect(raw).toContain("ask_user_choice");
    expect(raw).toContain("delegate_to_subagent");
    expect(raw).toContain("github_fork_repo");
    expect(raw).toContain("upstreamOwner=ReBoticsAI");
    expect(raw).toContain("upstreamRepo=GodMode");
    expect(raw).toMatch(/Gather/i);
    expect(raw).toMatch(/Log bug for developers/i);
    expect(raw).toMatch(/Hand off to a coding subagent/i);
    expect(raw).toMatch(/Never merge/i);
    expect(raw).toContain("report_platform_issue");
    expect(raw).toMatch(/Jobs 2 and 3:/i);
  });

  it("registers github_pr_merge for maintainer Agents", () => {
    const names = AI_TOOL_REGISTRY.map((t) => t.name);
    expect(names).toContain("github_pr_merge");
  });
});
