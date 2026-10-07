import { describe, expect, it, beforeEach } from "vitest";
import {
  assertAgentToolRateLimit,
  AgentToolRateLimitError,
  _resetAgentToolRateLimitForTests,
} from "../agent-tool-rate-limit.js";

describe("assertAgentToolRateLimit", () => {
  beforeEach(() => {
    _resetAgentToolRateLimitForTests();
  });

  it("allows up to max then throws", () => {
    for (let i = 0; i < 3; i++) {
      assertAgentToolRateLimit({
        agentId: "intelligence",
        toolName: "report_platform_issue",
        max: 3,
        windowMs: 60_000,
      });
    }
    expect(() =>
      assertAgentToolRateLimit({
        agentId: "intelligence",
        toolName: "report_platform_issue",
        max: 3,
        windowMs: 60_000,
      })
    ).toThrow(AgentToolRateLimitError);
  });

  it("isolates agents and tools", () => {
    assertAgentToolRateLimit({
      agentId: "a",
      toolName: "report_platform_issue",
      max: 1,
      windowMs: 60_000,
    });
    expect(() =>
      assertAgentToolRateLimit({
        agentId: "a",
        toolName: "report_platform_issue",
        max: 1,
        windowMs: 60_000,
      })
    ).toThrow(AgentToolRateLimitError);
    assertAgentToolRateLimit({
      agentId: "b",
      toolName: "report_platform_issue",
      max: 1,
      windowMs: 60_000,
    });
    assertAgentToolRateLimit({
      agentId: "a",
      toolName: "report_admin_ops",
      max: 1,
      windowMs: 60_000,
    });
  });
});
