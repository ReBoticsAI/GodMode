import {
  supplyBaseUrlForProvider,
  supplySecretIdForProvider,
} from "../godmode-inference-supply.js";
import type { LlmKnobPlan } from "./decision-knobs.js";
import { listAvailableRosterEntries } from "./roster.js";
import { isRosterEntryWithinQuota } from "./quota-ledger.js";
import type {
  AutoRouteResult,
  ClassifyResult,
  InferenceBand,
  InferenceCapability,
  RosterEntry,
} from "./types.js";
import { INFERENCE_BANDS } from "./types.js";

function bandIndex(band: InferenceBand): number {
  return INFERENCE_BANDS.indexOf(band);
}

function degradeBand(band: InferenceBand): InferenceBand | null {
  const i = bandIndex(band);
  if (i <= 0) return null;
  return INFERENCE_BANDS[i - 1]!;
}

function upgradeBand(band: InferenceBand): InferenceBand | null {
  const i = bandIndex(band);
  if (i < 0 || i >= INFERENCE_BANDS.length - 1) return null;
  return INFERENCE_BANDS[i + 1]!;
}

function costScore(e: RosterEntry): number {
  return e.costPer1kIn * 0.6 + e.costPer1kOut * 0.4;
}

/** Friend-style rank: capabilityScore * 3 + tag boosts - cost. */
export function rankScore(entry: RosterEntry, band: InferenceBand): number {
  let s = (entry.capabilityScore ?? 0.5) * 3;
  s -= costScore(entry);
  const tags = entry.tags ?? [];
  if (band === "trivial" && tags.includes("fast")) s += 2;
  if (band === "chat" && tags.includes("chat")) s += 0.5;
  if (
    (band === "tools" || band === "hard") &&
    (tags.includes("coding") || tags.includes("smart"))
  ) {
    s += 2;
  }
  if (band === "hard" && tags.includes("smart")) s += 0.5;
  return s;
}

function hasCaps(
  entry: RosterEntry,
  required: InferenceCapability[]
): boolean {
  return required.every((c) => entry.capabilities.includes(c));
}

export function requiredCapabilities(opts: {
  hasTools?: boolean;
  hasImages?: boolean;
  historyChars?: number;
}): InferenceCapability[] {
  const req: InferenceCapability[] = [];
  if (opts.hasTools) req.push("tools");
  if (opts.hasImages) req.push("vision");
  if ((opts.historyChars ?? 0) > 20_000) req.push("long_context");
  return req;
}

function defaultKnobs(classify: ClassifyResult): LlmKnobPlan {
  return {
    enableThinking: classify.band === "hard",
    maxTokens: classify.band === "hard" ? 4096 : classify.band === "trivial" ? 512 : 2048,
    toolPolicy:
      classify.band === "tools" || classify.band === "hard" ? "full" : "none",
    reasons: [classify.reason],
  };
}

function toResult(
  entry: RosterEntry,
  band: InferenceBand,
  classify: ClassifyResult,
  knobs: LlmKnobPlan,
  failover: string[]
): AutoRouteResult {
  return {
    rosterId: entry.id,
    provider: entry.provider,
    modelId: entry.model,
    transport: entry.provider,
    baseUrl: supplyBaseUrlForProvider(entry.provider),
    apiKeyRef: supplySecretIdForProvider(entry.provider),
    band,
    classify,
    costPer1kIn: entry.costPer1kIn,
    costPer1kOut: entry.costPer1kOut,
    complexityScore: classify.complexityScore ?? 0,
    enableThinking: knobs.enableThinking,
    maxTokens: knobs.maxTokens,
    toolPolicy: knobs.toolPolicy,
    confidence: 1,
    source: classify.source === "model" ? "model" : "heuristic",
    reasons: [...knobs.reasons],
    failover,
  };
}

/**
 * Pick highest-ranked healthy roster row for band, then degrade/upgrade on empty.
 * Ranking: capabilityScore then cost (Friend weight).
 */
export function selectRosterCandidate(opts: {
  band: InferenceBand;
  classify: ClassifyResult;
  hasTools?: boolean;
  hasImages?: boolean;
  historyChars?: number;
  excludeIds?: string[];
  roster?: RosterEntry[];
  knobs?: LlmKnobPlan;
}): AutoRouteResult | null {
  const available = opts.roster ?? listAvailableRosterEntries();
  const exclude = new Set(opts.excludeIds ?? []);
  const required = requiredCapabilities({
    hasTools: opts.hasTools,
    hasImages: opts.hasImages,
    historyChars: opts.historyChars,
  });
  const knobs = opts.knobs ?? defaultKnobs(opts.classify);

  const poolFor = (band: InferenceBand): RosterEntry[] =>
    available
      .filter(
        (e) =>
          e.band === band &&
          !exclude.has(e.id) &&
          isRosterEntryWithinQuota(e) &&
          hasCaps(e, required)
      )
      .sort((a, b) => rankScore(b, band) - rankScore(a, band));

  const tryBand = (band: InferenceBand): RosterEntry[] => poolFor(band);

  let band = opts.band;
  let ranked = tryBand(band);

  if (ranked.length === 0 && opts.hasTools) {
    let up: InferenceBand | null = band;
    while (up) {
      up = upgradeBand(up);
      if (!up) break;
      ranked = tryBand(up);
      if (ranked.length > 0) {
        band = up;
        break;
      }
    }
  }
  while (ranked.length === 0) {
    const down = degradeBand(band);
    if (!down) break;
    band = down;
    ranked = tryBand(band);
  }
  if (ranked.length === 0) {
    ranked = available
      .filter(
        (e) =>
          !exclude.has(e.id) &&
          isRosterEntryWithinQuota(e) &&
          hasCaps(e, required)
      )
      .sort((a, b) => rankScore(b, opts.band) - rankScore(a, opts.band));
    if (ranked[0]) band = ranked[0].band;
  }
  if (ranked.length === 0) {
    ranked = available
      .filter(
        (e) =>
          !exclude.has(e.id) &&
          isRosterEntryWithinQuota(e) &&
          (!opts.hasTools || e.capabilities.includes("tools"))
      )
      .sort((a, b) => rankScore(b, opts.band) - rankScore(a, opts.band));
    if (ranked[0]) band = ranked[0].band;
  }

  const entry = ranked[0];
  if (!entry) return null;

  const failover = ranked.slice(1, 4).map((e) => e.id);
  return toResult(entry, band, opts.classify, knobs, failover);
}
