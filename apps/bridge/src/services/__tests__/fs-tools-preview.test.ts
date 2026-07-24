/**
 * Pre-apply write-tool diff preview (#71 slice 7).
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPatchToContent,
  previewWriteToolDiff,
} from "../coding/fs-tools.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-preview-diff-"));
  temps.push(dir);
  return dir;
}

describe("applyPatchToContent", () => {
  it("applies a simple hunk in memory", () => {
    const original = "a\nb\nc\n";
    const patch = [
      "--- a/x.txt",
      "+++ b/x.txt",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      "",
    ].join("\n");
    expect(applyPatchToContent(original, patch)).toBe("a\nB\nc\n");
  });
});

describe("previewWriteToolDiff", () => {
  it("previews write_file as a full-file add without writing", () => {
    const root = tempWorkspace();
    const preview = previewWriteToolDiff(
      "write_file",
      { path: "new.txt", content: "hello\n" },
      { root }
    );
    expect(preview.previewError).toBeUndefined();
    expect(preview.previewDiff).toContain("+++ b/new.txt");
    expect(preview.previewDiff).toContain("+hello");
    expect(() => readFileSync(join(root, "new.txt"))).toThrow();
  });

  it("previews edit_file against disk content without writing", () => {
    const root = tempWorkspace();
    writeFileSync(join(root, "a.txt"), "hello world\n", "utf8");
    const preview = previewWriteToolDiff(
      "edit_file",
      {
        path: "a.txt",
        old_string: "world",
        new_string: "GodMode",
      },
      { root }
    );
    expect(preview.previewError).toBeUndefined();
    expect(preview.previewDiff).toContain("-hello world");
    expect(preview.previewDiff).toContain("+hello GodMode");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("hello world\n");
  });

  it("returns previewError when edit target is missing", () => {
    const root = tempWorkspace();
    const preview = previewWriteToolDiff(
      "edit_file",
      { path: "missing.txt", old_string: "a", new_string: "b" },
      { root }
    );
    expect(preview.previewDiff).toBeUndefined();
    expect(preview.previewError).toMatch(/not found/i);
  });

  it("previews apply_patch without writing", () => {
    const root = tempWorkspace();
    writeFileSync(join(root, "p.txt"), "one\ntwo\nthree\n", "utf8");
    const patch = [
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "",
    ].join("\n");
    const preview = previewWriteToolDiff(
      "apply_patch",
      { path: "p.txt", patch },
      { root }
    );
    expect(preview.previewError).toBeUndefined();
    expect(preview.previewDiff).toContain("-two");
    expect(preview.previewDiff).toContain("+TWO");
    expect(readFileSync(join(root, "p.txt"), "utf8")).toBe("one\ntwo\nthree\n");
  });

  it("ignores non-write tools", () => {
    expect(previewWriteToolDiff("run_terminal", { command: "ls" })).toEqual({});
  });
});
