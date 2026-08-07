/**
 * Layer 2 tenant worktrees (#112): create / list / discard under .worktrees/.
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTenantWorktree,
  discardTenantWorktree,
  ensureTenantGitRepo,
  listTenantWorktrees,
  promoteTenantWorktree,
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

  it("promote merges worktree plugins into the live tenant tree", () => {
    const workspaces = tempDir("gm-wt-promo-");
    const opts = hubOpts("tenant-a", workspaces);
    const wt = createTenantWorktree({ slug: "promo", ...opts });
    scaffoldPlugin({
      id: "promo-plug",
      name: "Promo",
      tenantId: "tenant-a",
      root: wt.workspace,
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });
    writeFile({
      path: "plugins/promo-plug/NOTE.txt",
      content: "promoted-ok\n",
      tenantId: "tenant-a",
      root: wt.workspace,
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });

    const result = promoteTenantWorktree({
      slugOrWorkspace: wt.workspace,
      ...opts,
    });
    expect(result.merged).toBe(true);
    expect(result.pluginIds).toContain("promo-plug");

    const live = resolveCodingRoot({
      tenantId: "tenant-a",
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });
    expect(existsSync(join(live, "plugins/promo-plug/NOTE.txt"))).toBe(true);
    expect(
      readFileSync(join(live, "plugins/promo-plug/NOTE.txt"), "utf8")
    ).toContain("promoted-ok");
  });

  it("promote fails closed on merge conflicts", () => {
    const workspaces = tempDir("gm-wt-conflict-");
    const opts = hubOpts("tenant-a", workspaces);
    const live = ensureTenantGitRepo(opts);
    mkdirPluginsAndCommit(live, "clash-plug", "main-version\n");

    const wt = createTenantWorktree({ slug: "clash", ...opts });
    writeFileSync(
      join(wt.absolutePath, "plugins/clash-plug/NOTE.txt"),
      "worktree-version\n",
      "utf8"
    );
    spawnSync("git", ["add", "-A"], {
      cwd: wt.absolutePath,
      encoding: "utf8",
      windowsHide: true,
    });
    spawnSync("git", ["commit", "-m", "wt change"], {
      cwd: wt.absolutePath,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "GodMode",
        GIT_AUTHOR_EMAIL: "godmode@localhost",
        GIT_COMMITTER_NAME: "GodMode",
        GIT_COMMITTER_EMAIL: "godmode@localhost",
      },
    });

    // Diverging change on main
    writeFileSync(
      join(live, "plugins/clash-plug/NOTE.txt"),
      "main-changed\n",
      "utf8"
    );
    spawnSync("git", ["add", "-A"], {
      cwd: live,
      encoding: "utf8",
      windowsHide: true,
    });
    spawnSync("git", ["commit", "-m", "main change"], {
      cwd: live,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "GodMode",
        GIT_AUTHOR_EMAIL: "godmode@localhost",
        GIT_COMMITTER_NAME: "GodMode",
        GIT_COMMITTER_EMAIL: "godmode@localhost",
      },
    });

    expect(() =>
      promoteTenantWorktree({ slugOrWorkspace: "clash", ...opts })
    ).toThrow(/Promote merge failed/i);
  });
});

function mkdirPluginsAndCommit(live: string, pluginId: string, note: string) {
  const dir = join(live, "plugins", pluginId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "godmode.plugin.json"),
    JSON.stringify({ id: pluginId, version: "0.1.0", name: pluginId }) + "\n",
    "utf8"
  );
  writeFileSync(join(dir, "NOTE.txt"), note, "utf8");
  spawnSync("git", ["add", "-A"], {
    cwd: live,
    encoding: "utf8",
    windowsHide: true,
  });
  spawnSync("git", ["commit", "-m", `add ${pluginId}`], {
    cwd: live,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "GodMode",
      GIT_AUTHOR_EMAIL: "godmode@localhost",
      GIT_COMMITTER_NAME: "GodMode",
      GIT_COMMITTER_EMAIL: "godmode@localhost",
    },
  });
}