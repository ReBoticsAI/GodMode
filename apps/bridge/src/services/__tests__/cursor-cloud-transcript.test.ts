/**
 * cursor_cloud tool-aware transcript appendix (#71 slice 2).
 */
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../ai-agent.js";
import {
  buildPrompt,
  buildTranscriptAppendix,
  formatTranscriptMessageLines,
  TRANSCRIPT_CHAR_BUDGET,
} from "../agents/cursor-cloud-backend.js";

const toolPair: AgentMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "find the handler" },
  {
    role: "assistant",
    content: "Searching.",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: {
          name: "codebase_search",
          arguments: JSON.stringify({ query: "auth handler" }),
        },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_1",
    name: "codebase_search",
    content: "apps/bridge/src/auth.ts:42 handleLogin",
  },
  { role: "user", content: "open that file" },
];

describe("buildTranscriptAppendix tool-aware replay", () => {
  it("includes prior tool calls and results, drops live user turn", () => {
    const appendix = buildTranscriptAppendix(toolPair);
    expect(appendix).toContain("<!-- godmode-recent-transcript -->");
    expect(appendix).toContain("User: find the handler");
    expect(appendix).toContain("Assistant: Searching.");
    expect(appendix).toContain("Assistant tool_call codebase_search:");
    expect(appendix).toContain("auth handler");
    expect(appendix).toContain("Tool[codebase_search]:");
    expect(appendix).toContain("handleLogin");
    expect(appendix).not.toContain("open that file");
    expect(appendix).toContain("tool calls/results truncated");
  });

  it("leaves single-turn and no-prior chats empty", () => {
    expect(buildTranscriptAppendix([{ role: "user", content: "only" }])).toBe(
      ""
    );
    expect(
      buildTranscriptAppendix([
        { role: "system", content: "sys" },
        { role: "user", content: "only" },
      ])
    ).toBe("");
  });

  it("keeps text-only multi-turn continuity", () => {
    const textOnly = buildTranscriptAppendix([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply one" },
      { role: "user", content: "second" },
    ]);
    expect(textOnly).toContain("User: first");
    expect(textOnly).toContain("Assistant: reply one");
    expect(textOnly).not.toContain("second");
  });

  it("truncates large tool results under the char budget", () => {
    const hugeResult = "x".repeat(5_000);
    const budgeted = buildTranscriptAppendix(
      [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "t1",
              type: "function",
              function: { name: "read_file", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          name: "read_file",
          tool_call_id: "t1",
          content: hugeResult,
        },
        { role: "user", content: "next" },
      ],
      2_000
    );
    expect(budgeted).toContain("chars omitted");
    expect(budgeted).not.toContain("x".repeat(2_000));
    const openTag = "<!-- godmode-recent-transcript -->\n";
    const closeTag = "\n<!-- /godmode-recent-transcript -->";
    expect(budgeted.startsWith(openTag)).toBe(true);
    expect(budgeted.endsWith(closeTag)).toBe(true);
    const inner = budgeted.slice(openTag.length, -closeTag.length);
    const blocksOnly = inner.slice(inner.indexOf("\n") + 1);
    expect(blocksOnly.length).toBeLessThanOrEqual(2_000);
  });

  it("prefers newer blocks when the budget is tight", () => {
    const fullAppendix = buildTranscriptAppendix(toolPair);
    const tinyBudget = buildTranscriptAppendix(toolPair, 80);
    expect(tinyBudget.length).toBeLessThan(fullAppendix.length);
    expect(
      tinyBudget === "" || tinyBudget.includes("<!-- godmode-recent-transcript -->")
    ).toBe(true);
  });

  it("wires appendix into buildPrompt ahead of the live user turn", () => {
    const prompt = buildPrompt({
      messages: toolPair,
    } as Parameters<typeof buildPrompt>[0]);
    expect(prompt).toContain("<!-- godmode-system -->");
    expect(prompt).toContain("User: find the handler");
    expect(prompt).toContain("Assistant tool_call codebase_search:");
    expect(prompt).toContain("open that file");
    expect(prompt.indexOf("find the handler")).toBeLessThan(
      prompt.lastIndexOf("open that file")
    );
  });

  it("formats assistant tool_call lines", () => {
    expect(
      formatTranscriptMessageLines({
        role: "assistant",
        content: "ok",
        tool_calls: [
          {
            id: "c",
            type: "function",
            function: { name: "grep", arguments: '{"p":"foo"}' },
          },
        ],
      })
    ).toEqual(["Assistant: ok", 'Assistant tool_call grep: {"p":"foo"}']);
  });

  it("uses a raised default transcript budget", () => {
    expect(TRANSCRIPT_CHAR_BUDGET).toBeGreaterThanOrEqual(8_000);
  });
});
