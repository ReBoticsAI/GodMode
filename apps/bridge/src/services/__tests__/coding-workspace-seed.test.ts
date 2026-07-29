/**
 * Starter hello.md for empty tenant coding roots.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODING_STARTER_FILENAME,
  CODING_STARTER_MARKDOWN,
  seedCodingWorkspaceStarter,
} from "../coding/coding-workspace-seed.js";
import { listDir, resolveCodingRoot } from "../coding/fs-tools.js";

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

describe("seedCodingWorkspaceStarter", () => {
  it("writes hello.md into an empty directory once", () => {
    const root = tempDir("gm-coding-seed-");
    expect(seedCodingWorkspaceStarter(root)).toBe(true);
    expect(readFileSync(join(root, CODING_STARTER_FILENAME), "utf8")).toBe(
      CODING_STARTER_MARKDOWN
    );
    expect(seedCodingWorkspaceStarter(root)).toBe(false);
    expect(readdirSync(root)).toEqual([CODING_STARTER_FILENAME]);
  });

  it("does not overwrite an existing hello.md", () => {
    const root = tempDir("gm-coding-seed-");
    writeFileSync(join(root, CODING_STARTER_FILENAME), "keep me\n", "utf8");
    expect(seedCodingWorkspaceStarter(root)).toBe(false);
    expect(readFileSync(join(root, CODING_STARTER_FILENAME), "utf8")).toBe(
      "keep me\n"
    );
  });

  it("does not seed when the directory already has other files", () => {
    const root = tempDir("gm-coding-seed-");
    writeFileSync(join(root, "notes.txt"), "x\n", "utf8");
    expect(seedCodingWorkspaceStarter(root)).toBe(false);
    expect(existsSync(join(root, CODING_STARTER_FILENAME))).toBe(false);
  });

  it("seeds when only legacy .godmode-egress is present and removes it", () => {
    const root = tempDir("gm-coding-seed-egress-");
    const legacy = join(root, ".godmode-egress");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "tcp-to-uds.mjs"), "old\n", "utf8");
    expect(seedCodingWorkspaceStarter(root)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(join(root, CODING_STARTER_FILENAME), "utf8")).toBe(
      CODING_STARTER_MARKDOWN
    );
  });

  it("seeds when only .bash_history is present", () => {
    const root = tempDir("gm-coding-seed-hist-");
    writeFileSync(join(root, ".bash_history"), "ls\n", "utf8");
    expect(seedCodingWorkspaceStarter(root)).toBe(true);
    expect(readFileSync(join(root, CODING_STARTER_FILENAME), "utf8")).toBe(
      CODING_STARTER_MARKDOWN
    );
    expect(existsSync(join(root, ".bash_history"))).toBe(true);
  });

  it("does not overwrite hello.md when shell history is also present", () => {
    const root = tempDir("gm-coding-seed-hist-keep-");
    writeFileSync(join(root, CODING_STARTER_FILENAME), "keep me\n", "utf8");
    writeFileSync(join(root, ".bash_history"), "pwd\n", "utf8");
    expect(seedCodingWorkspaceStarter(root)).toBe(false);
    expect(readFileSync(join(root, CODING_STARTER_FILENAME), "utf8")).toBe(
      "keep me\n"
    );
  });

  it("does not seed when a real user file is present alongside shell noise", () => {
    const root = tempDir("gm-coding-seed-real-");
    writeFileSync(join(root, ".bash_history"), "ls\n", "utf8");
    writeFileSync(join(root, "notes.txt"), "x\n", "utf8");
    expect(seedCodingWorkspaceStarter(root)).toBe(false);
    expect(existsSync(join(root, CODING_STARTER_FILENAME))).toBe(false);
  });
});

describe("resolveCodingRoot seeds empty hub tenants", () => {
  it("creates hello.md when an isolated tenant root is first resolved", () => {
    const workspaces = tempDir("gm-coding-seed-ws-");
    const root = resolveCodingRoot({
      tenantId: "tenant-new",
      tenantWorkspacesDir: workspaces,
      isolatedDeployment: true,
    });
    expect(root).toBe(join(workspaces, "tenant-new"));
    expect(readFileSync(join(root, CODING_STARTER_FILENAME), "utf8")).toContain(
      "sandboxed coding root"
    );
    const listed = listDir({
      path: ".",
      tenantId: "tenant-new",
      tenantWorkspacesDir: workspaces,
      isolatedDeployment: true,
    });
    expect(listed.entries.map((e) => e.name)).toEqual([CODING_STARTER_FILENAME]);
  });

  it("does not reseed a non-empty tenant root without hello.md", () => {
    const workspaces = tempDir("gm-coding-seed-ws-");
    const tenantRoot = join(workspaces, "tenant-used");
    mkdirSync(tenantRoot, { recursive: true });
    writeFileSync(join(tenantRoot, "project.ts"), "export {}\n", "utf8");
    resolveCodingRoot({
      tenantId: "tenant-used",
      tenantWorkspacesDir: workspaces,
      isolatedDeployment: true,
    });
    expect(existsSync(join(tenantRoot, CODING_STARTER_FILENAME))).toBe(false);
  });

  it("hides legacy .godmode-egress from listDir after ensure", () => {
    const workspaces = tempDir("gm-coding-seed-ws-");
    const tenantRoot = join(workspaces, "tenant-egress");
    mkdirSync(join(tenantRoot, ".godmode-egress"), { recursive: true });
    writeFileSync(
      join(tenantRoot, ".godmode-egress", "tcp-to-uds.mjs"),
      "x\n",
      "utf8"
    );
    resolveCodingRoot({
      tenantId: "tenant-egress",
      tenantWorkspacesDir: workspaces,
      isolatedDeployment: true,
    });
    expect(existsSync(join(tenantRoot, ".godmode-egress"))).toBe(false);
    const listed = listDir({
      path: ".",
      tenantId: "tenant-egress",
      tenantWorkspacesDir: workspaces,
      isolatedDeployment: true,
    });
    expect(listed.entries.map((e) => e.name)).toEqual([CODING_STARTER_FILENAME]);
  });

  it("hides .bash_history from listDir and still seeds hello.md", () => {
    const workspaces = tempDir("gm-coding-seed-ws-");
    const tenantRoot = join(workspaces, "tenant-hist");
    mkdirSync(tenantRoot, { recursive: true });
    writeFileSync(join(tenantRoot, ".bash_history"), "echo hi\n", "utf8");
    resolveCodingRoot({
      tenantId: "tenant-hist",
      tenantWorkspacesDir: workspaces,
      isolatedDeployment: true,
    });
    expect(existsSync(join(tenantRoot, ".bash_history"))).toBe(true);
    expect(existsSync(join(tenantRoot, CODING_STARTER_FILENAME))).toBe(true);
    const listed = listDir({
      path: ".",
      tenantId: "tenant-hist",
      tenantWorkspacesDir: workspaces,
      isolatedDeployment: true,
    });
    expect(listed.entries.map((e) => e.name)).toEqual([CODING_STARTER_FILENAME]);
  });
});
