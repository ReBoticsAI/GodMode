/**
 * cursor_cloud Agent.resume + transcript fallback (#71 slice 6).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../ai-agent.js";
import {
  buildPrompt,
  clearCursorCloudAgentCacheForTests,
  isCursorSdkAuthStaleError,
  resolveCursorSdkAgent,
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
  it("resumes when Agent.resume succeeds", async () => {
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
    expect(result.continued).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates when resume fails and marks continued false", async () => {
    const resume = vi.fn(async () => {
      throw new Error("not found");
    });
    const create = vi.fn(async () => fakeAgent);
    const result = await resolveCursorSdkAgent({
      chatKey: "godmode-c2",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "plan",
      sdk: { resume, create },
    });
    expect(result.continued).toBe(false);
    expect(resume).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0]).toMatchObject({
      agentId: "godmode-c2",
      mode: "plan",
    });
  });

  it("reuses in-memory agent when fingerprint matches", async () => {
    const resume = vi.fn(async () => fakeAgent);
    const create = vi.fn(async () => fakeAgent);
    await resolveCursorSdkAgent({
      chatKey: "godmode-c3",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
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
      sdk: { resume, create },
    });
    expect(second.continued).toBe(true);
    expect(resume).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("recreates when fingerprint changes", async () => {
    const close = vi.fn();
    const firstAgent = { ...fakeAgent, close };
    const resume = vi.fn(async () => firstAgent);
    const create = vi.fn(async () => fakeAgent);
    await resolveCursorSdkAgent({
      chatKey: "godmode-c4",
      apiKey: "k",
      cwd: process.cwd(),
      fingerprint: "fp1",
      modelId: "auto",
      mode: "agent",
      sdk: { resume, create },
    });
    resume.mockClear();
    create.mockClear();
    resume.mockImplementation(async () => fakeAgent);
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
    expect(resume).toHaveBeenCalledOnce();
    expect(second.continued).toBe(false);
  });

  it("forceFresh skips resume and creates a new agent", async () => {
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
