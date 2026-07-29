/**
 * Hub/SaaS Layer 1 coding isolation (#112 slice): tenant roots, escapes, plugin paths.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWithinCodingRoot,
  listDir,
  readFile,
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

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function hubOpts(tenantId: string, workspacesDir: string, root?: string) {
  return {
    tenantId,
    tenantWorkspacesDir: workspacesDir,
    isolatedDeployment: true as const,
    root,
  };
}

describe("resolveCodingRoot hub isolation", () => {
  it("requires tenantId on isolated deployments", () => {
    const workspaces = tempDir("gm-iso-ws-");
    expect(() =>
      resolveCodingRoot({
        isolatedDeployment: true,
        tenantWorkspacesDir: workspaces,
      })
    ).toThrow(/tenantId required/i);
  });

  it("never returns an arbitrary repo root for a tenant", () => {
    const workspaces = tempDir("gm-iso-ws-");
    const fakeRepo = tempDir("gm-iso-repo-");
    writeFileSync(join(fakeRepo, "secret.txt"), "core\n", "utf8");
    const root = resolveCodingRoot(hubOpts("tenant-a", workspaces));
    expect(root).toBe(join(workspaces, "tenant-a"));
    expect(root).not.toBe(fakeRepo);
  });

  it("rejects agent workspace that escapes the tenant root", () => {
    const workspaces = tempDir("gm-iso-ws-");
    expect(() =>
      resolveCodingRoot(hubOpts("tenant-a", workspaces, "../tenant-b"))
    ).toThrow(/escapes/i);
    expect(() =>
      resolveCodingRoot(
        hubOpts("tenant-a", workspaces, join(workspaces, "tenant-b"))
      )
    ).toThrow(/escapes/i);
  });

  it("allows a workspace subpath under the tenant root", () => {
    const workspaces = tempDir("gm-iso-ws-");
    mkdirSync(join(workspaces, "tenant-a", "wt"), { recursive: true });
    const root = resolveCodingRoot(hubOpts("tenant-a", workspaces, "wt"));
    expect(root).toBe(join(workspaces, "tenant-a", "wt"));
  });
});

describe("cross-tenant file tools", () => {
  it("tenant A cannot read tenant B files", () => {
    const workspaces = tempDir("gm-iso-ws-");
    const optsA = hubOpts("tenant-a", workspaces);
    const optsB = hubOpts("tenant-b", workspaces);
    writeFile({ path: "secret.txt", content: "b-only\n", ...optsB });
    writeFile({ path: "ok.txt", content: "a\n", ...optsA });

    expect(readFileSync(join(workspaces, "tenant-b", "secret.txt"), "utf8")).toBe(
      "b-only\n"
    );
    expect(
      listDir({ path: ".", ...optsA }).entries.map((e) => e.name).sort()
    ).toEqual(["hello.md", "ok.txt"]);
    expect(() => readFile({ path: "secret.txt", ...optsA })).toThrow(/not found/i);
    expect(() =>
      resolveRepoPath("../tenant-b/secret.txt", optsA)
    ).toThrow(/escapes/i);
  });
});

describe("assertWithinCodingRoot for plugins", () => {
  it("rejects a sibling tenant plugin root", () => {
    const workspaces = tempDir("gm-iso-ws-");
    const pluginB = join(workspaces, "tenant-b", "plugins", "evil");
    mkdirSync(pluginB, { recursive: true });
    expect(() =>
      assertWithinCodingRoot(pluginB, hubOpts("tenant-a", workspaces))
    ).toThrow(/escapes/i);
  });

  it("accepts a plugin under the caller tenant", () => {
    const workspaces = tempDir("gm-iso-ws-");
    const pluginA = join(workspaces, "tenant-a", "plugins", "ok");
    mkdirSync(pluginA, { recursive: true });
    expect(assertWithinCodingRoot(pluginA, hubOpts("tenant-a", workspaces))).toBe(
      pluginA
    );
    expect(
      assertWithinCodingRoot("plugins/ok", hubOpts("tenant-a", workspaces))
    ).toBe(pluginA);
  });
});
