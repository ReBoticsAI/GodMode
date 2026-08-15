import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitAdd,
  gitCheckout,
  gitClone,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitPush,
  gitRemoteHttpsUrl,
  gitStatus,
  previewGitToolDiff,
  resolveRelativeCodingWorkspace,
  setGithubHttpsRemote,
  stripCursorCommitAttribution,
} from "../coding/git-tools.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-git-tools-"));
  temps.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
}

function initRepo(): string {
  const cwd = tempDir();
  git(cwd, ["init"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  writeFileSync(join(cwd, "a.txt"), "one\n");
  git(cwd, ["add", "a.txt"]);
  git(cwd, ["commit", "-m", "init"]);
  return cwd;
}

describe("git-tools (#443)", () => {
  it("reports dirty status and diff after an edit", () => {
    const root = initRepo();
    writeFileSync(join(root, "a.txt"), "two\n");
    const status = gitStatus({ root });
    expect(status.dirtyCount).toBeGreaterThanOrEqual(1);
    expect(status.summary).toMatch(/dirty/);
    const diff = gitDiff({ root });
    expect(diff.diff).toContain("two");
  });

  it("creates a branch, stages, commits, and pushes to a local bare remote", async () => {
    const root = initRepo();
    const bare = join(tempDir(), "remote.git");
    mkdirSync(bare, { recursive: true });
    git(bare, ["init", "--bare"]);
    git(root, ["remote", "add", "origin", bare]);

    const home = gitStatus({ root }).branch;
    gitCreateBranch({ root, name: "feat-loop" });
    writeFileSync(join(root, "b.txt"), "new\n");
    gitAdd({ root, paths: ["b.txt"] });
    const commit = gitCommit({ root, message: "add b" });
    expect(commit.commit).toMatch(/^[0-9a-f]+$/i);

    const pushed = await gitPush({ root, remote: "origin", branch: "feat-loop" });
    expect(pushed.ok).toBe(true);

    const checkout = gitCheckout({ root, ref: home }).branch;
    expect(checkout).toBe(home);
  });

  it("refuses force-push and dashed refs", async () => {
    const root = initRepo();
    await expect(
      gitPush({ root, remote: "origin", force: true })
    ).rejects.toThrow(/force-push/i);
    expect(() => gitCreateBranch({ root, name: "-evil" })).toThrow(/invalid/);
  });

  it("git_clone rejects non-github URLs and nested directories", async () => {
    const root = initRepo();
    await expect(
      gitClone({
        root,
        url: "https://gitlab.com/acme/widget.git",
        githubAccessToken: "tok",
      })
    ).rejects.toThrow(/github\.com/i);
    await expect(
      gitClone({
        root,
        url: "https://github.com/acme/widget.git",
        directory: "nested/path",
        githubAccessToken: "tok",
      })
    ).rejects.toThrow(/single path segment/i);
    await expect(
      gitClone({
        root,
        url: "https://github.com/acme/widget.git",
      })
    ).rejects.toThrow(/Connect GitHub/i);
  });

  it("refuses paths that escape the coding root", () => {
    const root = initRepo();
    expect(() => gitAdd({ root, paths: ["../secret"] })).toThrow();
  });

  it("previewGitToolDiff returns staged diff for commit", () => {
    const root = initRepo();
    writeFileSync(join(root, "a.txt"), "preview\n");
    gitAdd({ root, paths: ["a.txt"] });
    const preview = previewGitToolDiff("git_commit", { message: "x" }, { root });
    expect(preview.previewDiff).toMatch(/preview|a\.txt/i);
  });

  it("setGithubHttpsRemote adds or updates origin", () => {
    const root = initRepo();
    const added = setGithubHttpsRemote({
      root,
      url: "https://github.com/alice/community-ping",
    });
    expect(added.action).toBe("added");
    expect(gitRemoteHttpsUrl({ root })).toMatch(/github\.com\/alice\/community-ping/i);
    const updated = setGithubHttpsRemote({
      root,
      url: "https://github.com/alice/other.git",
    });
    expect(updated.action).toBe("updated");
    expect(gitRemoteHttpsUrl({ root })).toMatch(/github\.com\/alice\/other/i);
  });

  it("previewGitToolDiff describes github_repo_create", () => {
    const preview = previewGitToolDiff("github_repo_create", {
      name: "community-ping",
      description: "ping",
    });
    expect(preview.previewDiff).toMatch(/community-ping/);
    expect(preview.previewDiff).toMatch(/Does not delete/i);
  });

  it("strips Cursor Cloud co-author trailers from commit messages", () => {
    expect(
      stripCursorCommitAttribution(
        "Fix foo.\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n"
      )
    ).toBe("Fix foo.");
    expect(
      stripCursorCommitAttribution("Ship it.\n\nMade-with: Cursor\n")
    ).toBe("Ship it.");

    const root = initRepo();
    writeFileSync(join(root, "c.txt"), "c\n");
    gitAdd({ root, paths: ["c.txt"] });
    const commit = gitCommit({
      root,
      message:
        "add c\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n",
    });
    expect(commit.message).toBe("add c");
    const body = execFileSync("git", ["log", "-1", "--format=%B"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(body).not.toMatch(/cursoragent/i);
  });

  it("resolves nested coding workspace remotes (#539)", () => {
    const base = tempDir();
    const nested = join(base, "gm-442-smoke-test");
    mkdirSync(nested, { recursive: true });
    git(nested, ["init"]);
    git(nested, ["config", "user.email", "test@example.com"]);
    git(nested, ["config", "user.name", "Test"]);
    writeFileSync(join(nested, "README.md"), "hi\n");
    git(nested, ["add", "README.md"]);
    git(nested, ["commit", "-m", "init"]);
    git(nested, [
      "remote",
      "add",
      "origin",
      "https://github.com/Acme/gm-442-smoke-test.git",
    ]);

    expect(() =>
      gitRemoteHttpsUrl({ localRepoRoot: base, remote: "origin" })
    ).toThrow(/not configured|not a git/i);

    const resolved = resolveRelativeCodingWorkspace({
      localRepoRoot: base,
      workspace: "gm-442-smoke-test",
    });
    expect(resolved.relative).toBe("gm-442-smoke-test");

    const url = gitRemoteHttpsUrl({
      localRepoRoot: base,
      root: resolved.relative,
      remote: "origin",
    });
    expect(url).toMatch(/github\.com\/Acme\/gm-442-smoke-test/i);

    expect(() =>
      resolveRelativeCodingWorkspace({
        localRepoRoot: base,
        workspace: "../escape",
      })
    ).toThrow(/escapes|relative/i);
    expect(() =>
      resolveRelativeCodingWorkspace({
        localRepoRoot: base,
        workspace: "missing-folder",
      })
    ).toThrow(/does not exist/i);
  });
});
