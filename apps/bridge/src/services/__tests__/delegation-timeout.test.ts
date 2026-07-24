/**
 * Bounded delegate_to_subagent (#70): timeout + structured status.
 */
import { describe, expect, it } from "vitest";
import {
  DELEGATE_DEFAULT_TIMEOUT_MS,
  DELEGATE_MAX_TIMEOUT_MS,
  runBoundedSubagentDelegation,
} from "../ai-tool-executor.js";

describe("runBoundedSubagentDelegation", () => {
  it("returns status ok with answer on success", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "reviewer",
      timeoutMs: 5_000,
      run: async () => "reviewed OK",
    });
    expect(result).toMatchObject({
      agentId: "reviewer",
      status: "ok",
      answer: "reviewed OK",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns status timeout when the run exceeds the cap", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "slow",
      timeoutMs: 30,
      run: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("too late"), 500);
        }),
    });
    expect(result.status).toBe("timeout");
    expect(result.agentId).toBe("slow");
    expect(result.answer).toBeUndefined();
    expect(result.error).toMatch(/timed out after 30ms/i);
    expect(result.durationMs).toBeGreaterThanOrEqual(25);
  });

  it("returns status error when the run throws", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "broken",
      timeoutMs: 5_000,
      run: async () => {
        throw new Error("backend exploded");
      },
    });
    expect(result).toMatchObject({
      agentId: "broken",
      status: "error",
      error: "backend exploded",
    });
    expect(result.answer).toBeUndefined();
  });

  it("caps timeoutMs at DELEGATE_MAX_TIMEOUT_MS", async () => {
    const result = await runBoundedSubagentDelegation({
      agentId: "capped",
      timeoutMs: DELEGATE_MAX_TIMEOUT_MS + 50_000,
      run: async () => "ok",
    });
    expect(result.status).toBe("ok");
    expect(DELEGATE_DEFAULT_TIMEOUT_MS).toBe(120_000);
    expect(DELEGATE_MAX_TIMEOUT_MS).toBe(300_000);
  });
});
