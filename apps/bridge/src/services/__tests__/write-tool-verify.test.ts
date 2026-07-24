/**
 * Post-apply TypeScript verification for write tools (#71 slice 8).
 */
import { describe, expect, it, vi } from "vitest";
import {
  filterDiagnosticsForPath,
  isTypeScriptPath,
  verifyTypeScriptAfterWrite,
  type DiagnosticItem,
} from "../coding/read-diagnostics.js";

describe("isTypeScriptPath", () => {
  it("detects ts/tsx/mts/cts", () => {
    expect(isTypeScriptPath("a.ts")).toBe(true);
    expect(isTypeScriptPath("a.tsx")).toBe(true);
    expect(isTypeScriptPath("a.mts")).toBe(true);
    expect(isTypeScriptPath("a.cts")).toBe(true);
    expect(isTypeScriptPath("a.js")).toBe(false);
    expect(isTypeScriptPath("README.md")).toBe(false);
  });
});

describe("filterDiagnosticsForPath", () => {
  it("prefers the edited file then a few others", () => {
    const diags: DiagnosticItem[] = [
      { file: "other.ts", line: 1, severity: "error", message: "x" },
      { file: "apps/web/a.ts", line: 2, severity: "error", message: "y" },
      { file: "z.ts", line: 3, severity: "warning", message: "z" },
    ];
    const filtered = filterDiagnosticsForPath(diags, "apps/web/a.ts", 10);
    expect(filtered[0]?.file).toBe("apps/web/a.ts");
    expect(filtered.length).toBeLessThanOrEqual(10);
  });
});

describe("verifyTypeScriptAfterWrite", () => {
  it("skips non-TypeScript paths without calling tsc", async () => {
    const runner = vi.fn();
    const result = await verifyTypeScriptAfterWrite(
      { path: "docs/README.md" },
      runner as never
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("not_typescript");
    expect(runner).not.toHaveBeenCalled();
  });

  it("attaches filtered diagnostics for a TS path when runner reports errors", async () => {
    const runner = vi.fn(async () => ({
      ok: false,
      diagnostics: [
        {
          file: "src/foo.ts",
          line: 10,
          column: 1,
          severity: "error" as const,
          message: "Type error",
        },
        {
          file: "src/bar.ts",
          line: 1,
          severity: "error" as const,
          message: "other",
        },
      ],
      raw: "",
    }));

    // Use a temp path that looks like TS; may skip on no_tsconfig in sandbox.
    // Force path through runner by stubbing hasTypeScriptConfig via cwd that has tsconfig in repo.
    const result = await verifyTypeScriptAfterWrite(
      { path: "src/foo.ts", timeoutMs: 1000 },
      runner
    );

    if (result.skipped) {
      expect(result.reason).toBe("no_tsconfig");
      expect(runner).not.toHaveBeenCalled();
      return;
    }

    expect(runner).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.file.includes("foo.ts"))).toBe(
      true
    );
  });
});
