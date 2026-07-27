/**
 * Tenant Cursor SDK sandbox.json helper (#171 / #112).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCursorSandboxJson,
  ensureTenantCursorSandboxJson,
  resolveCursorSdkSandboxHosts,
} from "../coding/cursor-sandbox-policy.js";
import { DEFAULT_TERMINAL_EGRESS_HOSTS } from "../coding/terminal-egress-proxy.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-sdk-sandbox-"));
  temps.push(dir);
  return dir;
}

describe("cursor sandbox policy", () => {
  it("builds deny-by-default networkPolicy with npm/git defaults", () => {
    const json = buildCursorSandboxJson([]);
    expect(json.networkPolicy.default).toBe("deny");
    expect(json.networkPolicy.allow).toEqual([...DEFAULT_TERMINAL_EGRESS_HOSTS]);
    expect(resolveCursorSdkSandboxHosts([])).toContain("registry.npmjs.org");
  });

  it("creates tenant .cursor/sandbox.json when missing", () => {
    const cwd = tempDir();
    expect(ensureTenantCursorSandboxJson(cwd, { hosts: ["github.com"] })).toBe(
      "created"
    );
    const path = join(cwd, ".cursor", "sandbox.json");
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      networkPolicy: { allow: string[] };
    };
    expect(parsed.networkPolicy.allow).toEqual(["github.com"]);
  });

  it("skip-if-exists does not clobber tenant-authored file", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".cursor"), { recursive: true });
    const path = join(cwd, ".cursor", "sandbox.json");
    writeFileSync(
      path,
      JSON.stringify({ networkPolicy: { default: "deny", allow: ["custom.example"] } })
    );
    expect(ensureTenantCursorSandboxJson(cwd, { hosts: ["github.com"] })).toBe(
      "exists"
    );
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      networkPolicy: { allow: string[] };
    };
    expect(parsed.networkPolicy.allow).toEqual(["custom.example"]);
  });
});
