/**
 * cursor_cloud agent cache / TTL + transcript fallback (#71 / #525).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../ai-agent.js";
import {
  buildPrompt,
  clearCursorCloudAgentCacheForTests,
  CURSOR_SESSION_STALE_CODE,
  CURSOR_STALE_AUTH_MAX_RETRIES,
  CursorSessionStaleError,
  isCursorSdkAgentCacheExpired,
  isCursorSdkAuthStaleError,
  isCursorSessionStaleError,
  resolveCursorSdkAgent,
  retryCursorRunOnStaleAuth,
  setCursorSdkAgentTtlForTests,
  shouldIncludeTranscriptAppendix,
} from "../agents/cursor-cloud-backend.js";

afterEach(() => {
  clearCursorCloudAgentCacheForTests();
});

const fakeAgent = { agentId: "godmode-c1" } as never;

describe("shouldIncludeTranscriptAppendix", () => {
  it("skips transcript when SDK conversation continued", () => {
    expect(shouldIncludeTranscriptAppendix(true)).toBe(false);
    expect(shouldIncludeTranscriptAppendix(false)).toBe(true);
  });
});

describe("isCursorSdkAuthStaleError", () => {
  it("matches Cursor AuthenticationError wording", () => {
    expect(
      isCursorSdkAuthStaleError(
        new Error(
          "Cursor agent run failed: Authentication error If you are logged in, try logging out and back in."
        )
      )
    ).toBe(true);
    expect(
      isCursorSdkAuthStaleError(new Error("code=unauthenticated"))
    ).toBe(true);
    expect(isCursorSdkAuthStaleError(new Error("ERROR_NOT_LOGGED_IN"))).toBe(
      true
    );
    expect(isCursorSdkAuthStaleError(new Error("git clone timed out"))).toBe(
      false
    );
  });
});

describe("CursorSessionStaleError (#668)", () => {
  it("exposes CURSOR_SESSION_STALE code and prefixes message", () => {
    const err = new CursorSessionStaleError();
    expect(err.code).toBe(CURSOR_SESSION_STALE_CODE);
    expect(err.message).toContain(CURSOR_SESSION_STALE_CODE);
    expect(isCursorSessionStaleError(err)).toBe(true);
    expect(
      isCursorSessionStaleError(new Error(`${CURSOR_SESSION_STALE_CODE}: x`))
    ).toBe(true);
    expect(CURSOR_STALE_AUTH_MAX_RETRIES).toBe(3);
  });

  it("retries three times then throws CursorSessionStaleError", async () => {
    const sleeps: number[] = [];
    const runOnce = vi.fn(async () => {
      throw new Error("Authentication error ERROR_NOT_LOGGED_IN");
    });
    const onEvict = vi.fn();
    await expect(
      retryCursorRunOnStaleAuth({
        runOnce,
        onEvict,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        backoffMs: [1, 2, 3],
      })
    ).rejects.toBeInstanceOf(CursorSessionStaleError);
    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(onEvict).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1, 2, 3]);
  });

  it("returns on a successful retry before exhaustion", async () => {
    let n = 0;
    const runOnce = vi.fn(async () => {
      n += 1;
      if (n < 2) throw new Error("Authentication error");
      return "ok";
    });
    await expect(
      retryCursorRunOnStaleAuth({
        runOnce,
        onEvict: () => {},
        sleep: async () => {},
        backoffMs: [0, 0, 0],
      })
    ).resolves.toBe("ok");
    expect(runOnce).toHaveBeenCalledTimes(2);
  });
});

describe("isCursorSdkAgentCacheExpired", () => {
  it("expires on idle and on max age", () => {
    const entry = { createdAt: 1_000, lastUsedAt: 1_000 };
    expect(
      isCursorSdkAgentCacheExpired(entry, 1_000 + 60_000, 10 * 60_000, 60 * 60_000)
    ).toBe(false);
    expect(
      isCursorSdkAgentCacheExpired(entry, 1_000 + 11 * 60_000, 10 * 60_000, 60 * 60_000)
    ).toBe(true);
    expect(
      isCursorSdkAgentCacheExpired(
        { createdAt: 1_000, lastUsedAt: 1_000 + 50 * 60_000 },
        1_000 + 61 * 60_000,
        10 * 60_000,
        60 * 60_000
      )
    ).toBe(true);
  });
});

describe("buildPrompt transcript gate", () => {
  const messages: AgentMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "first" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "second" },
  ];

  it("includes transcript by default", () => {
    const prompt = buildPrompt({ messages } as Parameters<typeof buildPrompt>[0]);
    expect(prompt).toContain("<!-- godmode-recent-transcript -->");
    expect(prompt).toContain("User: first");
    expect(prompt).toContain("second");
  });

  it("omits transcript when includeTranscript is false", () => {
    const prompt = buildPrompt(
      { messages } as Parameters<typeof buildPrompt>[0],
      { includeTranscript: false }
    );
    expect(prompt).not.toContain("godmode-recent-transcript");
    expect(prompt).toContain("<!-- godmode-system -->");
    expect(prompt).toContain("second");
    expect(prompt).not.toContain("User: first");
  });
});

describe("resolveCursorSdkAgent", () => {
  it("creates a fresh agent and does not cold-resume", async () => {
    const resume = vi.fn(async () => fakeAgent);
    const create = vi.fn(async () => fakeAgent);
    const result = await resolveCursorSdkAgent({
      chatKey: "godmode-c1",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      sdk: { resume, create },
    });
    expect(result.continued).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0]).toMatchObject({
      mode: "agent",
    });
    expect(String((create.mock.calls[0]![0] as { agentId: string }).agentId)).toMatch(
      /^godmode-c1-[a-f0-9]+$/
    );
  });

  it("creates with unique agent ids across rotates", async () => {
    const resume = vi.fn(async () => fakeAgent);
    const create = vi.fn(async () => fakeAgent);
    await resolveCursorSdkAgent({
      chatKey: "godmode-c2",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "plan",
      forceFresh: true,
      sdk: { resume, create },
    });
    await resolveCursorSdkAgent({
      chatKey: "godmode-c2",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "plan",
      forceFresh: true,
      sdk: { resume, create },
    });
    expect(create).toHaveBeenCalledTimes(2);
    const id1 = (create.mock.calls[0]![0] as { agentId: string }).agentId;
    const id2 = (create.mock.calls[1]![0] as { agentId: string }).agentId;
    expect(id1).not.toBe(id2);
    expect(resume).not.toHaveBeenCalled();
  });

  it("reuses in-memory agent when fingerprint matches and TTL is fresh", async () => {
    const resume = vi.fn(async () => fakeAgent);
    const create = vi.fn(async () => fakeAgent);
    const t0 = 1_000_000;
    await resolveCursorSdkAgent({
      chatKey: "godmode-c3",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      nowMs: t0,
      sdk: { resume, create },
    });
    resume.mockClear();
    create.mockClear();
    const second = await resolveCursorSdkAgent({
      chatKey: "godmode-c3",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      nowMs: t0 + 60_000,
      sdk: { resume, create },
    });
    expect(second.continued).toBe(true);
    expect(resume).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates again after idle TTL instead of resuming a dead session", async () => {
    setCursorSdkAgentTtlForTests({ idleMs: 5_000, maxAgeMs: 60 * 60_000 });
    const close = vi.fn();
    const firstAgent = { ...fakeAgent, close };
    const resume = vi.fn(async () => fakeAgent);
    const create = vi
      .fn()
      .mockResolvedValueOnce(firstAgent)
      .mockResolvedValueOnce(fakeAgent);
    const t0 = 1_000_000;
    await resolveCursorSdkAgent({
      chatKey: "godmode-c3b",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      nowMs: t0,
      sdk: { resume, create },
    });
    const second = await resolveCursorSdkAgent({
      chatKey: "godmode-c3b",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      nowMs: t0 + 6_000,
      sdk: { resume, create },
    });
    expect(close).toHaveBeenCalled();
    expect(second.continued).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
  });

  it("recreates when fingerprint changes", async () => {
    const close = vi.fn();
    const firstAgent = { ...fakeAgent, close };
    const resume = vi.fn(async () => fakeAgent);
    const create = vi
      .fn()
      .mockResolvedValueOnce(firstAgent)
      .mockResolvedValueOnce(fakeAgent);
    await resolveCursorSdkAgent({
      chatKey: "godmode-c4",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      sdk: { resume, create },
    });
    const second = await resolveCursorSdkAgent({
      chatKey: "godmode-c4",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp-changed",
      modelId: "composer-2.5",
      mode: "plan",
      sdk: { resume, create },
    });
    expect(close).toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
    expect(second.continued).toBe(false);
  });

  it("forceFresh skips cache and creates a new agent", async () => {
    const resume = vi.fn(async () => fakeAgent);
    const create = vi.fn(async () => fakeAgent);
    await resolveCursorSdkAgent({
      chatKey: "godmode-c5",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      forceFresh: true,
      sdk: { resume, create },
    });
    expect(resume).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });
});
