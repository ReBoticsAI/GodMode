import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyHeuristic,
  confidenceFromScores,
  cosine,
  enrichWithEmbeddings,
  planLlmKnobs,
  rankScore,
  resetEmbedLabelCacheForTests,
  scoreComplexity,
  selectRosterCandidate,
  type RosterEntry,
} from "../inference-router/index.js";
import { isRosterEntryWithinQuota } from "../inference-router/quota-ledger.js";

const ROSTER: RosterEntry[] = [
  {
    id: "cheap-trivial",
    provider: "groq",
    model: "llama-3.1-8b-instant",
    band: "trivial",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 30, rpd: 100 },
    capabilities: ["tools"],
    capabilityScore: 0.5,
    tags: ["fast"],
  },
  {
    id: "tools-mid",
    provider: "zai",
    model: "glm-5.3-flash",
    band: "tools",
    costPer1kIn: 0.05,
    costPer1kOut: 0.15,
    caps: { rpm: 60, rpd: 1000 },
    capabilities: ["tools", "vision"],
    capabilityScore: 0.7,
    tags: ["coding"],
  },
  {
    id: "hard-hi",
    provider: "zai",
    model: "glm-5.3",
    band: "hard",
    costPer1kIn: 0.2,
    costPer1kOut: 0.6,
    caps: { rpm: 30, rpd: 200 },
    capabilities: ["tools", "vision", "long_context"],
    capabilityScore: 0.85,
    tags: ["smart", "coding"],
  },
  {
    id: "chat-free",
    provider: "google_ai",
    model: "gemini-2.5-flash",
    band: "chat",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 15, rpd: 500 },
    capabilities: ["tools", "vision"],
    capabilityScore: 0.6,
    tags: ["chat"],
  },
  {
    id: "chat-stronger",
    provider: "zai",
    model: "glm-5.3-flash",
    band: "chat",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 60, rpd: 1000 },
    capabilities: ["tools", "vision"],
    capabilityScore: 0.9,
    tags: ["chat", "smart"],
  },
];

vi.mock("../godmode-inference-supply.js", () => ({
  resolveGodModeInferenceSupplyKey: (p: string) =>
    ["groq", "zai", "google_ai"].includes(p) ? "test-key" : null,
  supplyBaseUrlForProvider: (p: string) => `https://example.test/${p}`,
  supplySecretIdForProvider: (p: string) => `${p}-api-key`,
  GODMODE_INFERENCE_PROVIDERS: ["groq", "zai", "google_ai"],
}));

vi.mock("../inference-router/quota-ledger.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../inference-router/quota-ledger.js")>();
  return {
    ...actual,
    isRosterEntryWithinQuota: vi.fn(() => true),
  };
});

afterEach(() => {
  vi.mocked(isRosterEntryWithinQuota).mockReturnValue(true);
  resetEmbedLabelCacheForTests();
  vi.unstubAllGlobals();
});

describe("scoreComplexity + planLlmKnobs", () => {
  it("scores short greeting low", () => {
    const s = scoreComplexity("hi");
    expect(s).toBeLessThan(0.2);
  });

  it("scores think-hard + code fence high", () => {
    const s = scoreComplexity(
      "think hard about this architecture:\n```rust\nfn main(){}\n```"
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });

  it("greeting turns thinking off and caps tokens", () => {
    const score = scoreComplexity("hi");
    const knobs = planLlmKnobs({
      userText: "hi",
      preference: "auto",
      score,
      band: "trivial",
    });
    expect(knobs.enableThinking).toBe(false);
    expect(knobs.maxTokens).toBeLessThanOrEqual(1024);
    expect(knobs.toolPolicy).toBe("none");
  });

  it("think hard enables thinking and larger budget", () => {
    const text = "think hard about this architecture and refactor plan";
    const score = scoreComplexity(text);
    const knobs = planLlmKnobs({
      userText: text,
      preference: "auto",
      score,
      band: "hard",
    });
    expect(knobs.enableThinking).toBe(true);
    expect(knobs.maxTokens).toBeGreaterThanOrEqual(4096);
  });
});

describe("classifyHeuristic", () => {
  it("maps short ask to trivial", () => {
    const r = classifyHeuristic({
      userMessage: "hi",
      chatMode: "ask",
    });
    expect(r.band).toBe("trivial");
    expect(r.source).toBe("heuristic");
  });

  it("maps agent mode to tools", () => {
    const r = classifyHeuristic({
      userMessage: "create a wiki page",
      chatMode: "agent",
      hasTools: true,
    });
    expect(r.band).toBe("tools");
  });

  it("maps long agent work to hard", () => {
    const r = classifyHeuristic({
      userMessage: "x".repeat(5000),
      chatMode: "agent",
      hasTools: true,
    });
    expect(r.band).toBe("hard");
  });

  it("auto:fast forces trivial", () => {
    const r = classifyHeuristic({
      userMessage: "think hard about architecture",
      chatMode: "ask",
      preference: "auto:fast",
    });
    expect(r.band).toBe("trivial");
  });
});

describe("selectRosterCandidate", () => {
  it("picks highest capability when costs equal", () => {
    const classify = {
      band: "chat" as const,
      reason: "test",
      source: "heuristic" as const,
      complexityScore: 0.4,
    };
    const picked = selectRosterCandidate({
      band: "chat",
      classify,
      roster: ROSTER,
    });
    expect(picked?.rosterId).toBe("chat-stronger");
    expect(picked?.failover.length).toBeGreaterThan(0);
    expect(picked?.enableThinking).toBeDefined();
    expect(picked?.maxTokens).toBeGreaterThan(0);
  });

  it("requires tools capability when hasTools", () => {
    const classify = {
      band: "trivial" as const,
      reason: "test",
      source: "heuristic" as const,
    };
    const picked = selectRosterCandidate({
      band: "trivial",
      classify,
      hasTools: true,
      roster: ROSTER,
    });
    expect(picked?.rosterId).toBe("cheap-trivial");
    expect(picked?.provider).toBe("groq");
  });

  it("skips excluded and exhausted then failovers", () => {
    vi.mocked(isRosterEntryWithinQuota).mockImplementation((e) => {
      return e.id !== "tools-mid";
    });
    const classify = {
      band: "tools" as const,
      reason: "test",
      source: "heuristic" as const,
    };
    const picked = selectRosterCandidate({
      band: "tools",
      classify,
      hasTools: true,
      excludeIds: ["cheap-trivial"],
      roster: ROSTER,
    });
    expect(picked).not.toBeNull();
    expect(picked!.rosterId).not.toBe("tools-mid");
  });

  it("returns null when roster empty", () => {
    const classify = {
      band: "chat" as const,
      reason: "test",
      source: "heuristic" as const,
    };
    expect(
      selectRosterCandidate({
        band: "chat",
        classify,
        roster: [],
      })
    ).toBeNull();
  });

  it("rankScore prefers higher capabilityScore", () => {
    const a = ROSTER.find((e) => e.id === "chat-free")!;
    const b = ROSTER.find((e) => e.id === "chat-stronger")!;
    expect(rankScore(b, "chat")).toBeGreaterThan(rankScore(a, "chat"));
  });
});

describe("embed enrich", () => {
  it("confidence rises with margin", () => {
    const low = confidenceFromScores(0.4, 0.38);
    const high = confidenceFromScores(0.85, 0.2);
    expect(high).toBeGreaterThan(low);
  });

  it("cosine identical is one", () => {
    const v = [1, 0, 0];
    expect(Math.abs(cosine(v, v) - 1)).toBeLessThan(1e-5);
  });

  it("unavailable embed keeps heuristics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      })
    );
    const base = selectRosterCandidate({
      band: "chat",
      classify: {
        band: "chat",
        reason: "t",
        source: "heuristic",
        complexityScore: 0.3,
      },
      roster: ROSTER,
      knobs: {
        enableThinking: false,
        maxTokens: 2048,
        toolPolicy: "none",
        reasons: ["test"],
      },
    });
    expect(base).not.toBeNull();
    const enriched = await enrichWithEmbeddings(base!, "hello there");
    expect(enriched.enableThinking).toBe(false);
    expect(enriched.maxTokens).toBe(2048);
    expect(enriched.reasons.some((r) => r.includes("embed=unavailable"))).toBe(
      true
    );
  });
});

describe("failover exclude", () => {
  it("excludes failed roster id on next select", () => {
    const picked = selectRosterCandidate({
      band: "chat",
      classify: {
        band: "chat",
        reason: "t",
        source: "heuristic",
      },
      excludeIds: ["chat-free"],
      roster: ROSTER,
    });
    expect(picked?.rosterId).not.toBe("chat-free");
    expect(picked?.rosterId).toBe("chat-stronger");
  });
});
