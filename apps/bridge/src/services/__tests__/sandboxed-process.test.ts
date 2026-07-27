/**
 * Layer 3 helper spawn jail (#112): argv quoting + sandboxed runner.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runSandboxedArgv,
  runSandboxedArgvSync,
  shellQuoteArg,
  shellQuoteArgv,
} from "../coding/sandboxed-process.js";
import {
  buildBubblewrapArgs,
  resetBubblewrapProbeCache,
} from "../coding/terminal-sandbox.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
  resetBubblewrapProbeCache();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe("shellQuoteArgv", () => {
  it("quotes spaces and single quotes", () => {
    expect(shellQuoteArg("a b")).toBe("'a b'");
    expect(shellQuoteArg("it's")).toBe("'it'\\''s'");
    expect(shellQuoteArgv(["rg", "foo bar", "path"])).toBe(
      "'rg' 'foo bar' 'path'"
    );
  });
});

describe("runSandboxedArgv helper net", () => {
  it("builds helper commands with net=none (--unshare-net)", () => {
    const root = tempDir("gm-helper-args-");
    mkdirSync(join(root, "src"), { recursive: true });
    const command = shellQuoteArgv(["rg", "pattern", join(root, "src")]);
    const args = buildBubblewrapArgs({
      codingRoot: root,
      cwd: root,
      command,
      net: "none",
    });
    expect(args).toContain("--unshare-net");
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", command]);
    expect(command).toContain("rg");
  });

  it("runs host argv when sandbox is off", async () => {
    const root = tempDir("gm-helper-host-");
    writeFileSync(join(root, "hi.txt"), "hello\n", "utf8");
    // node -e works cross-platform without needing rg/git in PATH quirks
    const res = await runSandboxedArgv({
      codingRoot: root,
      cwd: root,
      argv: [
        process.execPath,
        "-e",
        "process.stdout.write(require('fs').readFileSync('hi.txt','utf8'))",
      ],
      net: "none",
      timeoutMs: 10_000,
    });
    expect(res.sandboxed).toBe(false);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello");
    expect(res.netMode).toBe("none");
  });

  it("sync runner returns exit code for failing argv", () => {
    const root = tempDir("gm-helper-sync-");
    const res = runSandboxedArgvSync({
      codingRoot: root,
      cwd: root,
      argv: [process.execPath, "-e", "process.exit(7)"],
      net: "none",
      timeoutMs: 10_000,
    });
    expect(res.exitCode).toBe(7);
    expect(res.sandboxed).toBe(false);
  });

  it("rejects cwd outside coding root", async () => {
    const root = tempDir("gm-helper-esc-");
    const other = tempDir("gm-helper-other-");
    await expect(
      runSandboxedArgv({
        codingRoot: root,
        cwd: other,
        argv: [process.execPath, "-e", "1"],
        net: "none",
      })
    ).rejects.toThrow(/escapes/i);
  });
});
