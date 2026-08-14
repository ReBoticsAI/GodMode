import { describe, expect, it } from "vitest";
import { resolveSandboxedGitNetMode } from "../coding/git-tools.js";

describe("resolveSandboxedGitNetMode", () => {
  it("upgrades terminal none to allowlist when sandbox is required", () => {
    expect(
      resolveSandboxedGitNetMode({ sandboxed: true, terminalNet: "none" })
    ).toBe("allowlist");
  });

  it("stays none when sandbox is off", () => {
    expect(
      resolveSandboxedGitNetMode({ sandboxed: false, terminalNet: "none" })
    ).toBe("none");
  });

  it("preserves shared and allowlist when configured", () => {
    expect(
      resolveSandboxedGitNetMode({ sandboxed: true, terminalNet: "shared" })
    ).toBe("shared");
    expect(
      resolveSandboxedGitNetMode({ sandboxed: true, terminalNet: "allowlist" })
    ).toBe("allowlist");
  });
});
