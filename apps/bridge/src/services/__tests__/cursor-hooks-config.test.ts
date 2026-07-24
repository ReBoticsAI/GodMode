/**
 * Read-only `.cursor/hooks.json` discovery (#71).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCursorHooksDiscovery,
  enrichPlatformContextWithHooks,
} from "../coding/cursor-hooks-config.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-hooks-"));
  temps.push(dir);
  return dir;
}

describe("collectCursorHooksDiscovery", () => {
  it("returns null when hooks.json is missing", () => {
    expect(collectCursorHooksDiscovery(tempRoot())).toBeNull();
  });

  it("lists hook event names without executing", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "echo" }],
          afterFileEdit: [{ command: "echo" }],
        },
      }),
      "utf8"
    );
    const disc = collectCursorHooksDiscovery(root);
    expect(disc?.events.sort()).toEqual(["afterFileEdit", "beforeSubmitPrompt"]);
    expect(disc?.summary).toContain("discovery only");
    expect(disc?.summary).not.toContain("echo");
  });
});

describe("enrichPlatformContextWithHooks", () => {
  it("attaches hooksDiscovery when present", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "hooks.json"),
      JSON.stringify({ hooks: { sessionStart: [] } }),
      "utf8"
    );
    const enriched = enrichPlatformContextWithHooks(
      { pathname: "/intelligence" },
      { workspace: root }
    );
    expect(enriched?.hooksDiscovery?.events).toEqual(["sessionStart"]);
  });
});
