import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitAdd,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitPush,
  gitStatus,
  previewGitToolDiff,
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
});
