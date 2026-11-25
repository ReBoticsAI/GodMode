/**
 * Friend AutoRouter decision knobs ported to TypeScript.
 * Source: composer-harness plugins/core_plugins/src/router.rs
 */

import type {
  AutoPreference,
  InferenceBand,
  ToolPolicy,
} from "./types.js";

export type LlmKnobPlan = {
  enableThinking: boolean;
  maxTokens: number;
  toolPolicy: ToolPolicy;
  reasons: string[];
};

export function scoreComplexity(text: string): number {
  let score = 0;
  const len = text.length;
  score += Math.min(len / 400, 0.35);

  if (text.includes("```")) {
    score += 0.25;
  }
  const lower = text.toLowerCase();
  for (const needle of [
    "think hard",
    "step by step",
    "reason carefully",
    "architecture",
    "refactor",
    "prove",
    "algorithm",
  ]) {
    if (lower.includes(needle)) {
      score += 0.15;
    }
  }
  for (const needle of ["tool", "fetch", "http", "shell", "browser", "mcp"]) {
    if (lower.includes(needle)) {
      score += 0.08;
    }
  }
  const qmarks = [...text].filter((c) => c === "?").length;
  score += Math.min(qmarks * 0.05, 0.15);

  return Math.min(1, Math.max(0, score));
}

/**
 * Map Friend continuous score + preference pins onto GodMode bands.
 */
export function bandFromScoreAndPreference(opts: {
  preference?: AutoPreference | string | null;
  score: number;
  hasTools?: boolean;
  chatMode?: string | null;
}): InferenceBand {
  const pref = (opts.preference ?? "auto").trim().toLowerCase();
  const mode = (opts.chatMode ?? "ask").toLowerCase();

  if (pref === "auto:fast") return "trivial";
  if (pref === "auto:chat") return "chat";
  if (pref === "auto:smart") return "hard";

  if (pref === "auto:coding" || opts.hasTools || mode === "agent" || mode === "plan") {
    return opts.score >= 0.65 ? "hard" : "tools";
  }

  if (pref.startsWith("auto")) {
    if (opts.score >= 0.65) return "hard";
    if (opts.score <= 0.25) return "trivial";
    return "chat";
  }

  if (opts.score >= 0.65) return "hard";
  if (opts.score <= 0.25) return "trivial";
  return "chat";
}

export function planLlmKnobs(opts: {
  userText: string;
  preference?: AutoPreference | string | null;
  score: number;
  band: InferenceBand;
}): LlmKnobPlan {
  const userText = opts.userText;
  const lower = userText.toLowerCase();
  const trimmed = userText.trim();
  const reasons = [
    `complexity=${opts.score.toFixed(2)}`,
    `band=${opts.band}`,
  ];

  const greeting =
    trimmed.length <= 24 &&
    (lower === "hi" ||
      lower === "hey" ||
      lower === "hello" ||
      lower.startsWith("hi ") ||
      lower.startsWith("hey ") ||
      lower.startsWith("hello "));

  const thinkHard =
    [
      "think hard",
      "step by step",
      "reason carefully",
      "architecture",
      "refactor",
      "prove",
      "algorithm",
      "deep dive",
    ].some((n) => lower.includes(n)) || userText.includes("```");

  const toolish = ["browse", "browser", "shell", "mcp", "fetch http", "use tool"].some(
    (n) => lower.includes(n)
  );

  let enableThinking: boolean;
  let maxTokens: number;
  if (greeting) {
    reasons.push("thinking=off");
    reasons.push("max_tokens=512");
    enableThinking = false;
    maxTokens = 512;
  } else if (thinkHard || opts.band === "hard") {
    reasons.push("thinking=on");
    reasons.push("max_tokens=4096");
    enableThinking = true;
    maxTokens = 4096;
  } else {
    reasons.push("thinking=off");
    reasons.push("max_tokens=2048");
    enableThinking = false;
    maxTokens = 2048;
  }

  let toolPolicy: ToolPolicy;
  if (toolish || lower.includes("mcp")) {
    reasons.push("tool_policy=full");
    toolPolicy = "full";
  } else if (["tool", "fetch", "http", "time"].some((n) => lower.includes(n))) {
    reasons.push("tool_policy=light");
    toolPolicy = "light";
  } else if (greeting) {
    reasons.push("tool_policy=none");
    toolPolicy = "none";
  } else if (opts.band === "tools" || opts.band === "hard") {
    reasons.push("tool_policy=full");
    toolPolicy = "full";
  } else {
    reasons.push("tool_policy=none");
    toolPolicy = "none";
  }

  return { enableThinking, maxTokens, toolPolicy, reasons };
}

/** Raise-only band merge: never drop below floor. */
export function raiseBand(floor: InferenceBand, candidate: InferenceBand): InferenceBand {
  const order: InferenceBand[] = ["trivial", "chat", "tools", "hard"];
  return order.indexOf(candidate) > order.indexOf(floor) ? candidate : floor;
}
