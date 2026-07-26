/**
 * Layer 2 tenant worktrees (#112): create / list / discard under .worktrees/.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTenantWorktree,
  discardTenantWorktree,
  ensureTenantGitRepo,
  listTenantWorktrees,
} from "../coding/tenant-worktree.js";
import { resolveCodingRoot, writeFile } from "../coding/fs-tools.js";
import { scaffoldPlugin } from "../plugin-scaffold.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function hubOpts(tenantId: string, workspacesDir: string) {
  return {
    tenantId,
    tenantWorkspacesDir: workspacesDir,
    isolatedDeployment: true as const,
  };
}

describe("tenant worktrees", () => {
  it("inits git, creates and lists a worktree under the tenant root", () => {
    const workspaces = tempDir("gm-wt-ws-");
    const opts = hubOpts("tenant-a", workspaces);
    const root = ensureTenantGitRepo(opts);
    expect(existsSync(join(root, ".git"))).toBe(true);

    const created = createTenantWorktree({ slug: "feat-one", ...opts });
    expect(created.workspace).toBe(".worktrees/feat-one");
    expect(created.absolutePath.startsWith(root)).toBe(true);
    expect(existsSync(created.absolutePath)).toBe(true);

    const listed = listTenantWorktrees(opts);
    expect(listed.map((w) => w.workspace)).toContain(".worktrees/feat-one");
  });

  it("discards a worktree", () => {
    const workspaces = tempDir("gm-wt-disc-");
    const opts = hubOpts("tenant-a", workspaces);
    createTenantWorktree({ slug: "tmp", ...opts });
    const discarded = discardTenantWorktree({
      slugOrWorkspace: "tmp",
      ...opts,
    });
    expect(discarded.discarded).toBe(".worktrees/tmp");
    expect(existsSync(discarded.absolutePath)).toBe(false);
    expect(listTenantWorktrees(opts)).toHaveLength(0);
  });

  it("rejects escape outside tenant root via absolute sibling path", () => {
    const workspaces = tempDir("gm-wt-esc-");
    const opts = hubOpts("tenant-a", workspaces);
    ensureTenantGitRepo(opts);
    expect(() =>
      discardTenantWorktree({
        slugOrWorkspace: "../tenant-b/secret",
        ...opts,
      })
    ).toThrow(/Not a managed worktree|escapes/i);
  });

  it("scaffold_plugin under worktree when root is set", () => {
    const workspaces = tempDir("gm-wt-scaf-");
    const opts = hubOpts("tenant-a", workspaces);
    const wt = createTenantWorktree({ slug: "plugin-wip", ...opts });
    const sc = scaffoldPlugin({
      id: "demo-plug",
      name: "Demo",
      tenantId: "tenant-a",
      root: wt.workspace,
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });
    expect(sc.created).toBe(true);
    expect(sc.pluginRoot.replace(/\\/g, "/")).toContain(
      ".worktrees/plugin-wip/plugins/demo-plug"
    );
    const codingRoot = resolveCodingRoot({
      tenantId: "tenant-a",
      root: wt.workspace,
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });
    writeFile({
      path: "plugins/demo-plug/NOTE.txt",
      content: "in-worktree\n",
      tenantId: "tenant-a",
      root: wt.workspace,
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });
    expect(existsSync(join(codingRoot, "plugins/demo-plug/NOTE.txt"))).toBe(
      true
    );
    // Live tenant plugins/ should not have the note
    const live = resolveCodingRoot({
      tenantId: "tenant-a",
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });
    expect(existsSync(join(live, "plugins/demo-plug/NOTE.txt"))).toBe(false);
  });
});
