/**
 * EmbeddingGemma-backed enricher for AutoRouteResult knobs (Friend port).
 * Fail-open: any error keeps heuristics. Does not re-pick the model.
 */

import type { AutoRouteResult, ToolPolicy } from "./types.js";

/** Same host as knowledge RAG by default (EmbeddingGemma 2 double-duty on :8082). */
const DEFAULT_EMBED_URL = "http://127.0.0.1:8082";
const CONFIDENCE_THRESHOLD = 0.55;
const EMBED_TIMEOUT_MS = 250;
const DEFAULT_EMBED_MODEL = "embeddinggemma-2";

type LabelProto = { key: string; text: string };

const TIER_LABELS: LabelProto[] = [
  {
    key: "simple",
    text: "simple short chat greeting or one-line question",
  },
  {
    key: "balanced",
    text: "balanced helpful conversational answer about Chat or everyday topics",
  },
  {
    key: "reasoning",
    text: "hard multi-step reasoning architecture refactor algorithm proof or deep analysis",
  },
];

const THINKING_LABELS: LabelProto[] = [
  { key: "off", text: "direct short answer without deep reasoning" },
  { key: "on", text: "needs deep careful step by step reasoning" },
];

const TOOLS_LABELS: LabelProto[] = [
  { key: "none", text: "plain conversation no tools needed" },
  { key: "light", text: "may need a light tool like time or fetch" },
  { key: "full", text: "needs browser shell mcp or multi-tool use" },
];

let labelCache: Map<string, number[]> = new Map();

export function embedBaseUrl(): string {
  return (
    process.env.GODMODE_ROUTER_EMBED_BASE_URL?.trim() || DEFAULT_EMBED_URL
  );
}

/** Softmax-friendly confidence from top1 cosine and margin to top2. */
export function confidenceFromScores(top1: number, top2?: number): number {
  const margin = top1 - (top2 ?? 0);
  const s = top1 * 0.65 + margin * 1.2;
  return Math.min(1, Math.max(0, 1 / (1 + Math.exp(-(s * 4.0 - 1.2)))));
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom <= Number.EPSILON) return 0;
  return Math.min(1, Math.max(-1, dot / denom));
}

async function embedOne(
  base: string,
  text: string,
  signal: AbortSignal
): Promise<number[]> {
  const url = `${base.replace(/\/$/, "")}/v1/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model:
        process.env.GODMODE_ROUTER_EMBED_MODEL?.trim() || DEFAULT_EMBED_MODEL,
      input: text,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`embed http ${res.status}`);
  }
  const v = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const emb = v.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) {
    throw new Error("missing embedding");
  }
  return emb.map((x) => Number(x));
}

function pickBest(
  scores: Array<[string, number]>
): { key: string; top1: number; top2?: number } | null {
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return null;
  return {
    key: top[0],
    top1: top[1],
    top2: ranked[1]?.[1],
  };
}

async function scoreLabels(
  base: string,
  promptVec: number[],
  labels: LabelProto[],
  signal: AbortSignal
): Promise<Array<[string, number]>> {
  const out: Array<[string, number]> = [];
  for (const lab of labels) {
    let emb = labelCache.get(lab.key);
    if (!emb) {
      emb = await embedOne(base, lab.text, signal);
      labelCache.set(lab.key, emb);
    }
    out.push([lab.key, cosine(promptVec, emb)]);
  }
  return out;
}

/** Reset label cache (tests). */
export function resetEmbedLabelCacheForTests(): void {
  labelCache = new Map();
}

/**
 * Enrich a heuristic AutoRouteResult with embedding Choices when the embed
 * service is healthy. On any failure or low confidence, returns the original
 * decision unchanged (fail open). Does not re-pick the model.
 */
export async function enrichWithEmbeddings(
  decision: AutoRouteResult,
  userText: string
): Promise<AutoRouteResult> {
  const base = embedBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const promptVec = await embedOne(base, userText, controller.signal);
    if (promptVec.length === 0) {
      return {
        ...decision,
        reasons: [...decision.reasons, "embed=unavailable; heuristics kept"],
      };
    }

    const tierScores = await scoreLabels(
      base,
      promptVec,
      TIER_LABELS,
      controller.signal
    );
    const thinkScores = await scoreLabels(
      base,
      promptVec,
      THINKING_LABELS,
      controller.signal
    );
    const toolScores = await scoreLabels(
      base,
      promptVec,
      TOOLS_LABELS,
      controller.signal
    );

    const tier = pickBest(tierScores);
    const thinking = pickBest(thinkScores);
    const tools = pickBest(toolScores);
    if (!tier || !thinking || !tools) return decision;

    const conf = confidenceFromScores(
      Math.max(tier.top1, thinking.top1, tools.top1),
      Math.max(tier.top2 ?? 0, thinking.top2 ?? 0, tools.top2 ?? 0)
    );

    const reasons = [
      ...decision.reasons,
      `embed=tier:${tier.key}(${tier.top1.toFixed(2)}) thinking:${thinking.key}(${thinking.top1.toFixed(2)}) tools:${tools.key}(${tools.top1.toFixed(2)}) conf=${conf.toFixed(2)}`,
    ];

    if (conf < CONFIDENCE_THRESHOLD) {
      return {
        ...decision,
        confidence: conf,
        reasons: [
          ...reasons,
          `embed=abstain conf<${CONFIDENCE_THRESHOLD}`,
        ],
      };
    }

    let enableThinking = decision.enableThinking;
    let maxTokens = decision.maxTokens;
    let toolPolicy: ToolPolicy = decision.toolPolicy;

    if (tier.key === "simple") {
      maxTokens = Math.min(maxTokens, 512);
      enableThinking = false;
      if (tools.key === "full") toolPolicy = "light";
      else if (tools.key === "light" && conf >= 0.75) toolPolicy = "light";
      else toolPolicy = "none";
    } else if (tier.key === "reasoning") {
      maxTokens = Math.max(maxTokens, 4096);
      enableThinking = true;
      if (tools.key === "full") toolPolicy = "full";
      else if (tools.key === "light") toolPolicy = "light";
    } else {
      if (thinking.key === "on") enableThinking = true;
      else if (thinking.key === "off") enableThinking = false;
      if (tools.key === "full") toolPolicy = "full";
      else if (tools.key === "light") toolPolicy = "light";
      else toolPolicy = "none";
      if (enableThinking) maxTokens = Math.max(maxTokens, 4096);
    }

    return {
      ...decision,
      enableThinking,
      maxTokens,
      toolPolicy,
      confidence: conf,
      source: "merged",
      reasons: [
        ...reasons,
        `thinking=${enableThinking ? "on" : "off"}`,
        `max_tokens=${maxTokens}`,
        `tool_policy=${toolPolicy}`,
      ],
    };
  } catch {
    return {
      ...decision,
      reasons: [...decision.reasons, "embed=unavailable; heuristics kept"],
    };
  } finally {
    clearTimeout(timer);
  }
}
