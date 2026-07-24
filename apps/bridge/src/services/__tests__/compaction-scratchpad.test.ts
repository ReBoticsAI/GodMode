/**
 * Compaction scratchpad + cursor_cloud dynamic reminders (#71).
 */
import { describe, expect, it } from "vitest";
import { compactAgentMessages } from "../chat-history.js";
import {
  buildDynamicReminders,
  buildPrompt,
} from "../agents/cursor-cloud-backend.js";
import type { AgentMessage } from "../ai-agent.js";
import type { AgentRunRequest } from "../agents/backend.js";
import type { AiAgent } from "../agents/types.js";

describe("compactAgentMessages scratchpad", () => {
  it("returns empty scratchpad when nothing is dropped", () => {
    const result = compactAgentMessages(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      10_000
    );
    expect(result.droppedTurns).toBe(0);
    expect(result.scratchpad).toBe("");
  });

  it("builds a godmode_compaction scratchpad for dropped turns", () => {
    const result = compactAgentMessages(
      [
        { role: "user", content: "first topic about auth" },
        { role: "assistant", content: "b".repeat(100) },
        { role: "user", content: "second topic about billing" },
        { role: "assistant", content: "d".repeat(100) },
        { role: "user", content: "keep me" },
      ],
      250
    );
    expect(result.droppedTurns).toBeGreaterThanOrEqual(1);
    expect(result.scratchpad).toContain("<godmode_compaction>");
    expect(result.scratchpad).toContain("Dropped user turns");
    expect(result.messages.some((m) => m.content === "keep me")).toBe(true);
  });
});

describe("buildDynamicReminders", () => {
  const baseAgent = {
    id: "intelligence",
    config: { workspace: "C:/repo" },
  } as unknown as AiAgent;

  function req(
    mode: "agent" | "plan" | "ask",
    extra?: Partial<AgentRunRequest>
  ): AgentRunRequest {
    return {
      agent: baseAgent,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "go" },
      ],
      chatMode: mode,
      toolCtx: {} as AgentRunRequest["toolCtx"],
      ...extra,
    };
  }

  it("labels plan and ask modes", () => {
    expect(buildDynamicReminders(req("plan"))).toContain("Mode: plan");
    expect(buildDynamicReminders(req("ask"))).toContain("Mode: ask");
    expect(buildDynamicReminders(req("agent"))).toContain("Mode: agent");
  });

  it("includes workspace and abort hint when present", () => {
    const text = buildDynamicReminders(
      req("agent", { abortSignal: new AbortController().signal })
    );
    expect(text).toContain("Coding workspace: C:/repo");
    expect(text).toContain("abort");
  });

  it("is injected by buildPrompt before the live user turn", () => {
    const prompt = buildPrompt(req("plan"), { includeTranscript: false });
    expect(prompt).toContain("<!-- godmode-reminders -->");
    expect(prompt).toContain("Mode: plan");
    expect(prompt.endsWith("go")).toBe(true);
  });
});

describe("AgentMessage compaction type", () => {
  it("accepts tool messages in the input list", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "1", name: "read_file", content: "ok" },
    ];
    expect(compactAgentMessages(messages, 10_000).droppedTurns).toBe(0);
  });
});
