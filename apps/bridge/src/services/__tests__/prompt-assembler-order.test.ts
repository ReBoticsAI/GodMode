/**
 * Cursor-parity prompt assembly (#71 first slice): heading order + flow migration.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import {
  assemblePrompt,
  getDefaultPromptFlowConfig,
  migratePromptFlowConfig,
  PROMPT_FLOW_VERSION,
  type PromptFlowConfig,
} from "../prompt-assembler.js";
import { HARNESS_VERSION } from "../harness-prompt.js";

function indexOrNeg(haystack: string, needle: string): number {
  const i = haystack.indexOf(needle);
  expect(i, `expected to find ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
  return i;
}

describe("prompt-assembler Cursor heading order", () => {
  it("places early harness before GodMode RAG and late harness after", () => {
    const db = new Database(":memory:") as unknown as AppDatabase;
    const flow = getDefaultPromptFlowConfig();
    for (const sec of flow.sections) {
      sec.enabled = ["base", "memory", "wiki", "capabilities", "final"].includes(
        sec.id
      );
    }

    const { systemPrompt } = assemblePrompt(db, {
      basePrompt: "BASE_IDENTITY_MARKER",
      flowConfig: flow,
      agent: null,
      memoryOverride: "MEMORY_MARKER_BODY",
      wikiOverride: "WIKI_MARKER_BODY",
      capabilitiesOverride: "CAPABILITIES_MARKER_BODY",
    });

    const base = indexOrNeg(systemPrompt, "BASE_IDENTITY_MARKER");
    const communication = indexOrNeg(systemPrompt, "<communication>");
    const memory = indexOrNeg(systemPrompt, "<godmode_memory>");
    const wiki = indexOrNeg(systemPrompt, "<godmode_wiki>");
    const caps = indexOrNeg(systemPrompt, "<godmode_capabilities>");
    const tasks = indexOrNeg(systemPrompt, "<tasks_and_self_loop>");
    const stamp = indexOrNeg(systemPrompt, `<!-- harness:${HARNESS_VERSION} -->`);

    expect(base).toBeLessThan(communication);
    expect(communication).toBeLessThan(memory);
    expect(memory).toBeLessThan(wiki);
    expect(wiki).toBeLessThan(caps);
    expect(caps).toBeLessThan(tasks);
    expect(tasks).toBeLessThan(stamp);
    expect(HARNESS_VERSION).toBe("cursor-parity-v4");
  });

  it("migrates stale prompt-flow orders while preserving enabled=false", () => {
    const stale: PromptFlowConfig = {
      promptFlowVersion: 2,
      sections: [
        { id: "profile", enabled: true, order: -2 },
        { id: "user", enabled: true, order: -1 },
        { id: "base", enabled: true, order: 0 },
        { id: "rules", enabled: true, order: 1 },
        { id: "memory", enabled: false, order: 2 },
        { id: "wiki", enabled: true, order: 2.5 },
        { id: "skills", enabled: true, order: 3 },
        { id: "capabilities", enabled: true, order: 4 },
        { id: "tools", enabled: true, order: 5 },
        { id: "platform", enabled: true, order: 6 },
        { id: "mentions", enabled: true, order: 7 },
        { id: "chatHistory", enabled: true, order: 8 },
        { id: "userMessage", enabled: true, order: 9 },
        { id: "final", enabled: true, order: 10 },
      ],
      positions: { base: { x: 1, y: 2 } },
    };

    const migrated = migratePromptFlowConfig(stale);
    expect(migrated.promptFlowVersion).toBe(PROMPT_FLOW_VERSION);
    expect(PROMPT_FLOW_VERSION).toBe(4);
    expect(migrated.sections.find((s) => s.id === "memory")?.enabled).toBe(false);
    expect(migrated.sections.find((s) => s.id === "mcp")?.enabled).toBe(true);
    expect(migrated.sections.find((s) => s.id === "platform")?.order).toBe(3);
    expect(migrated.sections.find((s) => s.id === "mcp")?.order).toBe(4);
    expect(migrated.positions).toEqual({ base: { x: 1, y: 2 } });
  });

  it("emits a dedicated MCP section from platform context", () => {
    const db = new Database(":memory:") as unknown as AppDatabase;
    const flow = getDefaultPromptFlowConfig();
    for (const sec of flow.sections) {
      sec.enabled = sec.id === "base" || sec.id === "mcp" || sec.id === "platform";
    }
    const { systemPrompt } = assemblePrompt(db, {
      basePrompt: "BASE",
      flowConfig: flow,
      agent: null,
      platformContext: {
        pathname: "/intelligence",
        mcpDiscovery: {
          servers: [{ name: "github", transport: "stdio" }],
          summary: "github (stdio) | discovery only (not executed by Bridge)",
        },
      },
    });
    expect(systemPrompt).toContain("<godmode_mcp>");
    expect(systemPrompt).toContain("github (stdio)");
    expect(systemPrompt).toContain("Route: /intelligence");
    expect(systemPrompt).not.toMatch(/MCP: github/);
  });
});
