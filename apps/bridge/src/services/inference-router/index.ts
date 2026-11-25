import { classifyComplexity } from "./classifier.js";
import {
  planLlmKnobs,
  scoreComplexity,
} from "./decision-knobs.js";
import { appendRouteDecision, listRouteDecisions } from "./decisions.js";
import { enrichWithEmbeddings } from "./embed-enrich.js";
import {
  getInferenceRoster,
  listAvailableRosterEntries,
  resetInferenceRoster,
  setInferenceRoster,
} from "./roster.js";
import {
  getQuotaSnapshot,
  listQuotaSnapshots,
  markProviderExhausted,
  recordQuotaAttempt,
} from "./quota-ledger.js";
import { selectRosterCandidate } from "./select.js";
import type {
  AutoRouteRequest,
  AutoRouteResult,
  InferenceBand,
  RosterEntry,
} from "./types.js";
import { GODMODE_INFERENCE_PROVIDERS } from "../godmode-inference-supply.js";

export type {
  AutoPreference,
  AutoRouteRequest,
  AutoRouteResult,
  ClassifyResult,
  DecisionSource,
  InferenceBand,
  RosterEntry,
  RouteDecisionLog,
  ToolPolicy,
} from "./types.js";
export { INFERENCE_BANDS } from "./types.js";
export {
  DEFAULT_INFERENCE_ROSTER,
  getInferenceRoster,
  listAvailableRosterEntries,
  resetInferenceRoster,
  setInferenceRoster,
} from "./roster.js";
export {
  classifyComplexity,
  classifyHeuristic,
} from "./classifier.js";
export {
  bandFromScoreAndPreference,
  planLlmKnobs,
  raiseBand,
  scoreComplexity,
} from "./decision-knobs.js";
export {
  confidenceFromScores,
  cosine,
  embedBaseUrl,
  enrichWithEmbeddings,
  resetEmbedLabelCacheForTests,
} from "./embed-enrich.js";
export {
  getQuotaSnapshot,
  listQuotaSnapshots,
  markProviderExhausted,
  recordQuotaAttempt,
  isRosterEntryWithinQuota,
  resetQuotaLedgerForTests,
} from "./quota-ledger.js";
export { listRouteDecisions, appendRouteDecision } from "./decisions.js";
export { selectRosterCandidate, rankScore } from "./select.js";

/**
 * Classify then pick ranked healthy upstream for GodMode Inference Auto.
 * Applies Friend knobs + optional embed enrich (fail-open).
 */
export async function resolveAutoRoute(
  req: AutoRouteRequest
): Promise<AutoRouteResult | null> {
  const preference = req.preference ?? "auto";
  const score = scoreComplexity(req.userMessage ?? "");

  const classify =
    req.band != null
      ? {
          band: req.band,
          reason: "forced band",
          source: "heuristic" as const,
          complexityScore: score,
        }
      : await classifyComplexity({
          userMessage: req.userMessage,
          chatMode: req.chatMode,
          hasTools: req.hasTools,
          hasImages: req.hasImages,
          historyChars: req.historyChars,
          preference,
        });

  const knobs = planLlmKnobs({
    userText: req.userMessage ?? "",
    preference,
    score: classify.complexityScore ?? score,
    band: classify.band,
  });

  let result = selectRosterCandidate({
    band: classify.band,
    classify,
    hasTools: req.hasTools,
    hasImages: req.hasImages,
    historyChars: req.historyChars,
    excludeIds: req.excludeIds,
    knobs,
  });

  if (result) {
    result = await enrichWithEmbeddings(result, req.userMessage ?? "");
  }

  appendRouteDecision({
    at: new Date().toISOString(),
    band: classify.band,
    classifySource: classify.source,
    classifyReason: classify.reason,
    chosenRosterId: result?.rosterId ?? null,
    chosenModel: result?.modelId ?? null,
    chosenProvider: result?.provider ?? null,
    attempts: req.excludeIds ?? [],
    error: result ? undefined : "no healthy supply in roster",
    complexityScore: result?.complexityScore ?? classify.complexityScore,
    enableThinking: result?.enableThinking,
    maxTokens: result?.maxTokens,
    toolPolicy: result?.toolPolicy,
    confidence: result?.confidence,
    source: result?.source,
    reasons: result?.reasons,
    failover: result?.failover,
  });

  return result;
}

/** After a failed upstream attempt, mark exhausted on 429 and try next. */
export async function resolveAutoRouteFailover(
  req: AutoRouteRequest,
  failed: { rosterId: string; provider: string; status?: number }
): Promise<AutoRouteResult | null> {
  if (failed.status === 429 || failed.status === 503) {
    markProviderExhausted(failed.provider, 120_000);
  } else {
    recordQuotaAttempt(failed.provider);
  }
  const excludeIds = [...(req.excludeIds ?? []), failed.rosterId];
  return resolveAutoRoute({ ...req, excludeIds, band: req.band });
}

export function getAutoRouterAdminSnapshot(): {
  roster: RosterEntry[];
  available: RosterEntry[];
  quotas: ReturnType<typeof listQuotaSnapshots>;
  decisions: ReturnType<typeof listRouteDecisions>;
} {
  const roster = getInferenceRoster();
  return {
    roster,
    available: listAvailableRosterEntries(roster),
    quotas: listQuotaSnapshots([...GODMODE_INFERENCE_PROVIDERS]),
    decisions: listRouteDecisions(25),
  };
}

export function bandOrder(): InferenceBand[] {
  return ["trivial", "chat", "tools", "hard"];
}

/** Light tool name allowlist for toolPolicy=light. */
export const LIGHT_TOOL_NAME_RE =
  /^(time|fetch|http|get_time|web_fetch|fetch_url|browser_navigate)$/i;

export function filterToolsByPolicy(
  toolNames: string[],
  policy: AutoRouteResult["toolPolicy"]
): string[] | null {
  if (policy === "full") return null; // no filter
  if (policy === "none") return [];
  return toolNames.filter((n) => LIGHT_TOOL_NAME_RE.test(n));
}
