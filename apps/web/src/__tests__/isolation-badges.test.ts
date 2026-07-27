import { describe, expect, it } from "vitest";
import { collectIsolationBadgeLabels } from "../components/intelligence/isolation-badges";

describe("collectIsolationBadgeLabels", () => {
  it("badges sandboxed terminal results", () => {
    expect(
      collectIsolationBadgeLabels({
        name: "run_terminal",
        args: { command: "ls" },
        result: { sandboxed: true, netMode: "none", exitCode: 0 },
      })
    ).toEqual(["sandboxed", "net: none"]);
  });

  it("badges promote live-tree isolation", () => {
    const labels = collectIsolationBadgeLabels({
      name: "coding_worktree_promote",
      args: { slug: "feat-x" },
      result: {
        workspace: ".worktrees/feat-x",
        isolation: { kind: "promote", target: "live_tenant_tree" },
      },
    });
    expect(labels).toContain("wt: .worktrees/feat-x");
    expect(labels).toContain("→ live tree");
  });

  it("badges ephemeral builds", () => {
    expect(
      collectIsolationBadgeLabels({
        name: "run_ephemeral_build",
        args: { command: "npm ci" },
        result: { mode: "ephemeral", exitCode: 0 },
      })
    ).toContain("ephemeral build");
  });
});
