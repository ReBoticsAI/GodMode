/**
 * Coding workspace FS helpers: escape rejection, rename, empty-dir delete, root isolation.
 */
import { chdir, cwd } from "node:process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deletePath,
  listDir,
  mkdirPath,
  readFile,
  renamePath,
  resolveCodingRoot,
  resolveRepoPath,
  writeFile,
} from "../coding/fs-tools.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-coding-ws-"));
  temps.push(dir);
  return dir;
}

describe("resolveRepoPath", () => {
  it("rejects path escapes outside the coding root", () => {
    const root = tempWorkspace();
    expect(() => resolveRepoPath("../secret.txt", { root })).toThrow(/escapes/i);
  });
});

describe("renamePath / mkdirPath / deletePath", () => {
  it("renames a file within the root", () => {
    const root = tempWorkspace();
    writeFileSync(join(root, "a.txt"), "hi\n", "utf8");
    expect(renamePath({ from: "a.txt", to: "b.txt", root })).toEqual({
      from: "a.txt",
      to: "b.txt",
    });
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("hi\n");
  });

  it("rejects rename overwrite and escapes", () => {
    const root = tempWorkspace();
    writeFileSync(join(root, "a.txt"), "a\n", "utf8");
    writeFileSync(join(root, "b.txt"), "b\n", "utf8");
    expect(() => renamePath({ from: "a.txt", to: "b.txt", root })).toThrow(
      /already exists/i
    );
    expect(() =>
      renamePath({ from: "a.txt", to: "../outside.txt", root })
    ).toThrow(/escapes/i);
  });

  it("creates directories and deletes empty ones only", () => {
    const root = tempWorkspace();
    expect(mkdirPath({ path: "src/lib", root })).toEqual({
      path: "src/lib",
      created: true,
    });
    writeFileSync(join(root, "src", "lib", "x.ts"), "export {}\n", "utf8");
    expect(() => deletePath({ path: "src/lib", root })).toThrow(/not empty/i);
    expect(deletePath({ path: "src/lib/x.ts", root })).toMatchObject({
      deleted: true,
      type: "file",
    });
    expect(deletePath({ path: "src/lib", root })).toMatchObject({
      deleted: true,
      type: "dir",
    });
  });
});

describe("root isolation", () => {
  it("cannot list or write into another root via relative paths", () => {
    const tenantA = tempWorkspace();
    const tenantB = tempWorkspace();
    writeFileSync(join(tenantB, "secret.txt"), "nope\n", "utf8");
    writeFile({ path: "ok.txt", content: "a\n", root: tenantA });
    const listed = listDir({ path: ".", recursive: false, root: tenantA });
    expect(listed.entries.map((e) => e.name)).toEqual(["ok.txt"]);
    expect(() =>
      resolveRepoPath(join("..", basename(tenantB), "secret.txt"), {
        root: tenantA,
      })
    ).toThrow(/escapes/i);
  });

  it("lists only the configured root", () => {
    const tenantA = tempWorkspace();
    const tenantB = tempWorkspace();
    mkdirSync(join(tenantA, "apps"), { recursive: true });
    writeFileSync(join(tenantA, "apps", "a.ts"), "a\n", "utf8");
    writeFileSync(join(tenantB, "b.ts"), "b\n", "utf8");
    const entries = listDir({ path: ".", recursive: true, root: tenantA }).entries;
    expect(entries.some((e) => e.name.includes("b.ts"))).toBe(false);
    expect(entries.some((e) => e.name.replace(/\\/g, "/") === "apps/a.ts")).toBe(
      true
    );
  });
});

describe("local Layer 2 worktree workspace", () => {
  it("read_file and list_dir work when cwd differs from repo root", () => {
    const repo = tempWorkspace();
    const elsewhere = tempWorkspace();
    const workspace = ".worktrees/feat-read";
    const wtAbs = join(repo, ".worktrees", "feat-read");
    mkdirSync(wtAbs, { recursive: true });
    writeFileSync(join(wtAbs, "note.txt"), "from-worktree\n", "utf8");

    const prev = cwd();
    try {
      chdir(elsewhere);
      const codingRoot = resolveCodingRoot({
        localRepoRoot: repo,
        root: workspace,
      });
      expect(codingRoot.replace(/\\/g, "/")).toBe(wtAbs.replace(/\\/g, "/"));

      const listed = listDir({
        path: ".",
        localRepoRoot: repo,
        root: workspace,
      });
      expect(listed.entries.map((e) => e.name)).toContain("note.txt");

      const read = readFile({
        path: "note.txt",
        localRepoRoot: repo,
        root: workspace,
      });
      expect(read.content).toContain("from-worktree");
    } finally {
      chdir(prev);
    }
  });

  it("rejects relative workspace that escapes the local repo root", () => {
    const repo = tempWorkspace();
    expect(() =>
      resolveCodingRoot({ localRepoRoot: repo, root: "../outside" })
    ).toThrow(/escapes/i);
  });
});
