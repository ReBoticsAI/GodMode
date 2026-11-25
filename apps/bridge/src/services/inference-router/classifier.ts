import {
  resolveGodModeInferenceSupplyKey,
  supplyBaseUrlForProvider,
} from "../godmode-inference-supply.js";
import {
  bandFromScoreAndPreference,
  raiseBand,
  scoreComplexity,
} from "./decision-knobs.js";
import { pickClassifierEntry } from "./roster.js";
import { isRosterEntryWithinQuota, recordQuotaAttempt } from "./quota-ledger.js";
import type {
  ClassifyInput,
  ClassifyResult,
  InferenceBand,
} from "./types.js";
import { INFERENCE_BANDS } from "./types.js";

const CLASSIFIER_TIMEOUT_MS = 2000;

/**
 * Friend-style heuristic: continuous score → band (+ preference / tools floor).
 */
export function classifyHeuristic(input: ClassifyInput): ClassifyResult {
  const msg = input.userMessage ?? "";
  const score = scoreComplexity(msg);
  const historyChars = input.historyChars ?? 0;
  const longHistory = historyChars > 12_000 || msg.length > 4000;
  let band = bandFromScoreAndPreference({
    preference: input.preference,
    score: longHistory ? Math.max(score, 0.7) : score,
    hasTools: input.hasTools,
    chatMode: input.chatMode,
  });
  if (input.hasImages && band !== "hard") {
    band = raiseBand(band, "tools");
  }
  return {
    band,
    reason: `friend score=${score.toFixed(2)} → ${band}`,
    source: "heuristic",
    complexityScore: score,
  };
}

function parseBandJson(text: string): InferenceBand | null {
  const trimmed = text.trim();
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    const raw = jsonMatch ? jsonMatch[0] : trimmed;
    const parsed = JSON.parse(raw) as { band?: string };
    if (parsed.band && (INFERENCE_BANDS as string[]).includes(parsed.band)) {
      return parsed.band as InferenceBand;
    }
  } catch {
    // fall through
  }
  const lower = trimmed.toLowerCase();
  for (const b of INFERENCE_BANDS) {
    if (lower.includes(`"${b}"`) || lower.includes(`band: ${b}`)) return b;
  }
  return null;
}

/**
 * Cheap Decision/JEV-style classify. Raise-only vs Friend heuristic floor.
 * Falls back to heuristic on timeout, missing key, or parse failure.
 */
export async function classifyComplexity(
  input: ClassifyInput
): Promise<ClassifyResult> {
  const heuristic = classifyHeuristic(input);
  const entry = pickClassifierEntry();
  if (!entry || !isRosterEntryWithinQuota(entry)) {
    return heuristic;
  }
  const apiKey = resolveGodModeInferenceSupplyKey(entry.provider);
  if (!apiKey) return heuristic;

  const baseUrl = supplyBaseUrlForProvider(entry.provider).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: entry.model,
        temperature: 0,
        max_tokens: 64,
        messages: [
          {
            role: "system",
            content:
              'Classify the user turn into one complexity band for model routing. Reply with JSON only: {"band":"trivial"|"chat"|"tools"|"hard","reason":"short"}. trivial=short FAQ; chat=normal dialogue; tools=needs tool use or agent work; hard=long/refactor/multimodal hard.',
          },
          {
            role: "user",
            content: JSON.stringify({
              chatMode: input.chatMode ?? "agent",
              hasTools: Boolean(input.hasTools),
              hasImages: Boolean(input.hasImages),
              historyChars: input.historyChars ?? 0,
              preference: input.preference ?? "auto",
              message: (input.userMessage ?? "").slice(0, 1500),
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    recordQuotaAttempt(entry.provider, {
      exhausted: res.status === 429,
      exhaustedMs: res.status === 429 ? 120_000 : undefined,
    });
    if (!res.ok) return heuristic;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const modelBand = parseBandJson(content);
    if (!modelBand) return heuristic;

    // Raise-only: never drop below Friend heuristic floor.
    const band = raiseBand(heuristic.band, modelBand);
    return {
      band,
      reason:
        band === modelBand
          ? `classifier:${content.slice(0, 120)}`
          : `classifier ${modelBand} raised to ${band} (friend floor)`,
      source: "model",
      complexityScore: heuristic.complexityScore,
    };
  } catch {
    return heuristic;
  } finally {
    clearTimeout(timer);
  }
}
