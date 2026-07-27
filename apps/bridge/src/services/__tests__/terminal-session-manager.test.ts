/**
 * Shared PTY session manager (#162).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeTerminalSession,
  createTerminalSession,
  listTerminalSessions,
  readTerminalSession,
  resetTerminalSessionsForTests,
  writeTerminalSession,
} from "../coding/terminal-session-manager.js";
import { resolveRepoPath } from "../coding/fs-tools.js";

const temps: string[] = [];

afterEach(async () => {
  await resetTerminalSessionsForTests();
  // ConPTY may briefly keep the cwd handle after kill.
  await new Promise((r) => setTimeout(r, 200));
  while (temps.length) {
    const dir = temps.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows EBUSY: leave for OS temp cleanup */
    }
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-pty-"));
  temps.push(dir);
  return dir;
}

describe("terminal session manager", () => {
  it("creates, writes, reads, and closes a session under the coding root", async () => {
    const root = tempRoot();
    const session = await createTerminalSession({
      root,
      tenantId: "test-tenant",
      name: "smoke",
      cwd: ".",
    });
    expect(session.sessionId).toBeTruthy();
    expect(session.running).toBe(true);
    expect(listTerminalSessions("test-tenant").some((s) => s.sessionId === session.sessionId)).toBe(
      true
    );

    // Cross-tenant list isolation
    expect(listTerminalSessions("other-tenant")).toHaveLength(0);

    writeTerminalSession({
      sessionId: session.sessionId,
      tenantId: "test-tenant",
      data: process.platform === "win32" ? "echo hello-pty\r\n" : "echo hello-pty\n",
    });

    // Wait briefly for shell echo
    await new Promise((r) => setTimeout(r, 800));
    const chunk = readTerminalSession({
      sessionId: session.sessionId,
      tenantId: "test-tenant",
    });
    expect(chunk.data.length).toBeGreaterThan(0);

    const closed = await closeTerminalSession({
      sessionId: session.sessionId,
      tenantId: "test-tenant",
    });
    expect(closed.closed).toBe(true);
    expect(listTerminalSessions("test-tenant")).toHaveLength(0);
  }, 20_000);

  it("rejects cwd that escapes the coding root", async () => {
    const root = tempRoot();
    await expect(
      createTerminalSession({
        root,
        tenantId: "test-tenant",
        cwd: "../outside",
      })
    ).rejects.toThrow(/escapes|outside|not under/i);
  });

  it("confines resolveRepoPath for session cwd", () => {
    const root = tempRoot();
    expect(() =>
      resolveRepoPath("../secret", { root, tenantId: "t" })
    ).toThrow();
  });
});
