/**
 * Coding-root git snapshot for platform context (#71 slice 5).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectGitWorkspaceSnapshot,
  enrichPlatformContextWithGit,
} from "../coding/git-workspace.js";
import { assemblePrompt, getDefaultPromptFlowConfig } from "../prompt-assembler.js";
import type { AppDatabase } from "../../db.js";
import Database from "better-sqlite3";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-git-snap-"));
  temps.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    windowsHide: true,
  });
}

describe("collectGitWorkspaceSnapshot", () => {
  it("returns null outside a git work tree", () => {
    const cwd = tempDir();
    expect(collectGitWorkspaceSnapshot(cwd)).toBeNull();
  });

  it("summarizes branch and dirty files", () => {
    const cwd = tempDir();
    git(cwd, ["init"]);
    git(cwd, ["config", "user.email", "test@example.com"]);
    git(cwd, ["config", "user.name", "Test"]);
    writeFileSync(join(cwd, "a.txt"), "one");
    git(cwd, ["add", "a.txt"]);
    git(cwd, ["commit", "-m", "init"]);
    writeFileSync(join(cwd, "b.txt"), "two");

    const snap = collectGitWorkspaceSnapshot(cwd);
    expect(snap).not.toBeNull();
    expect(snap!.dirtyCount).toBeGreaterThanOrEqual(1);
    expect(snap!.summary).toContain("Branch:");
    expect(snap!.summary).toMatch(/dirty: \d+ files?/);
    expect(snap!.summary.length).toBeLessThanOrEqual(500);
  });

  it("reports clean when the work tree has no changes", () => {
    const cwd = tempDir();
    git(cwd, ["init"]);
    git(cwd, ["config", "user.email", "test@example.com"]);
    git(cwd, ["config", "user.name", "Test"]);
    writeFileSync(join(cwd, "a.txt"), "one");
    git(cwd, ["add", "a.txt"]);
    git(cwd, ["commit", "-m", "init"]);

    const snap = collectGitWorkspaceSnapshot(cwd);
    expect(snap?.summary).toContain("clean");
    expect(snap?.dirtyCount).toBe(0);
  });
});

describe("enrichPlatformContextWithGit", () => {
  it("attaches gitSnapshot when workspace is a git repo", () => {
    const cwd = tempDir();
    git(cwd, ["init"]);
    git(cwd, ["config", "user.email", "test@example.com"]);
    git(cwd, ["config", "user.name", "Test"]);
    writeFileSync(join(cwd, "a.txt"), "one");
    git(cwd, ["add", "a.txt"]);
    git(cwd, ["commit", "-m", "init"]);

    const enriched = enrichPlatformContextWithGit(
      { pathname: "/intelligence" },
      { workspace: cwd }
    );
    expect(enriched?.pathname).toBe("/intelligence");
    expect(enriched?.gitSnapshot?.summary).toContain("Branch:");
  });

  it("leaves context unchanged when not a git repo", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, "nested"));
    const enriched = enrichPlatformContextWithGit(
      { pathname: "/x" },
      { workspace: cwd }
    );
    expect(enriched).toEqual({ pathname: "/x" });
  });
});

describe("prompt-assembler git line", () => {
  it("renders Git: summary in the platform section", () => {
    const db = new Database(":memory:") as unknown as AppDatabase;
    const flow = getDefaultPromptFlowConfig();
    for (const sec of flow.sections) {
      sec.enabled = sec.id === "platform" || sec.id === "base";
    }
    const assembled = assemblePrompt(db, {
      basePrompt: "You are a test agent.",
      flowConfig: flow,
      agent: null,
      platformContext: {
        pathname: "/intelligence",
        gitSnapshot: {
          branch: "feat/x",
          dirtyCount: 2,
          ahead: 1,
          behind: 0,
          summary: "Branch: feat/x | dirty: 2 files | ahead 1 / behind 0",
        },
      },
      agentId: "intelligence",
    });
    expect(assembled.systemPrompt).toContain(
      "Git: Branch: feat/x | dirty: 2 files | ahead 1 / behind 0"
    );
    expect(assembled.systemPrompt).toContain("Route: /intelligence");
  });
});
