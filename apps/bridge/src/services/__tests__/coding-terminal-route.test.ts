/**
 * Coding Terminal command runner route registration (#148 / #112).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTOCOL_EXCEPTIONS } from "../../kernel/protocol-exceptions.js";

describe("coding terminal protocol exception", () => {
  it("registers POST /api/ai/coding/terminal/run as a mutation exception", () => {
    const hit = PROTOCOL_EXCEPTIONS.find(
      (e) => e.id === "ai-coding-workspace-terminal-run"
    );
    expect(hit).toBeTruthy();
    expect(hit?.methods).toContain("POST");
    expect(hit?.pathPattern).toBe("/api/ai/coding/terminal/run");
  });
});

describe("coding terminal route wiring", () => {
  it("mounts /terminal/run on the coding workspace router source", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "apps/bridge/src/routes/coding-workspace.ts"
      ),
      "utf8"
    );
    expect(src).toContain('"/terminal/run"');
    expect(src).toContain("ui_run_terminal");
    expect(src).toContain("runTerminal");
  });
});
