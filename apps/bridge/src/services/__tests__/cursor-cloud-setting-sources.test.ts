/**
 * cursor_cloud project settingSources (#71 slice 3).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCursorLocalCreateOptions,
  cursorCloudCacheFingerprint,
  cursorSettingSourcesFingerprint,
  resolveCursorSettingSources,
} from "../agents/cursor-cloud-backend.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-cursor-ss-"));
  temps.push(dir);
  return dir;
}

describe("resolveCursorSettingSources", () => {
  it("returns project when cwd has a .cursor directory", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".cursor"));
    writeFileSync(join(cwd, ".cursor", "rules.md"), "be terse");
    expect(resolveCursorSettingSources(cwd)).toEqual(["project"]);
  });

  it("returns empty when .cursor is missing", () => {
    const cwd = tempDir();
    expect(resolveCursorSettingSources(cwd)).toEqual([]);
  });

  it("returns empty when .cursor is a file, not a directory", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, ".cursor"), "not a dir");
    expect(resolveCursorSettingSources(cwd)).toEqual([]);
  });

  it("never includes user/team/all sources", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".cursor"));
    const sources = resolveCursorSettingSources(cwd);
    expect(sources).toEqual(["project"]);
    expect(sources).not.toContain("user");
    expect(sources).not.toContain("team");
    expect(sources).not.toContain("all");
  });
});

describe("buildCursorLocalCreateOptions", () => {
  it("includes settingSources project when .cursor exists", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".cursor"));
    expect(buildCursorLocalCreateOptions(cwd)).toEqual({
      cwd,
      sandboxOptions: { enabled: false },
      settingSources: ["project"],
    });
  });

  it("passes empty settingSources without .cursor", () => {
    const cwd = tempDir();
    expect(buildCursorLocalCreateOptions(cwd)).toEqual({
      cwd,
      sandboxOptions: { enabled: false },
      settingSources: [],
    });
  });
});

describe("cursorSettingSourcesFingerprint", () => {
  it("changes cache fingerprint when project sources are enabled", () => {
    expect(cursorSettingSourcesFingerprint([])).toBe("");
    expect(cursorSettingSourcesFingerprint(["project"])).toBe("project");
    expect(
      cursorCloudCacheFingerprint("auto", "sys", "", "")
    ).not.toEqual(
      cursorCloudCacheFingerprint("auto", "sys", "", "project")
    );
  });
});
