import {
  playGraphTour,
  type GraphTourStop,
  GRAPH_TOUR_DWELL_MS,
} from "@/lib/guide-ui-action";

/** Shorter dwell than interest tours: subtle framing, not a long narration. */
export const EXPLORE_BUY_TOUR_DWELL_MS = Math.min(4_000, GRAPH_TOUR_DWELL_MS);

/**
 * Soft Graph walk after Explore: Hub then Platform Vault (Cloud seats + Inference).
 * Buy cards / CloudGuide / InferenceOffer stay in chat; this only frames the Graph.
 */
export const EXPLORE_BUY_TOUR_STOPS: GraphTourStop[] = [
  {
    nodeId: "hub:heart",
    label: "Hub",
    say: "Hub is home base on the Graph. Cloud seats and Inference live under Hub, on Platform Vault.",
  },
  {
    nodeId: "hub:vault-platform",
    label: "Platform Vault",
    say: "Platform Vault holds GodMode Cloud and Inference. Pick a path in chat when you are ready to buy or sign up.",
  },
];

/** One-stop focus used when Inference allowance runs out. */
export const ALLOWANCE_OUT_TOUR_STOPS: GraphTourStop[] = [
  {
    nodeId: "hub:vault-platform",
    label: "Platform Vault",
    say: "Your free Inference allowance is used up. Open Platform Vault from here, or pick Cloud or Inference in chat to continue.",
  },
];

export function playExploreBuyTour(dwellMs = EXPLORE_BUY_TOUR_DWELL_MS): void {
  // Soft: keep Social + buy cards mounted on phone while the Graph frames Hub /
  // Platform Vault (tour:true would dismiss the phone Social surface).
  playGraphTour(EXPLORE_BUY_TOUR_STOPS, dwellMs, { soft: true });
}

export function playAllowanceOutTour(dwellMs = EXPLORE_BUY_TOUR_DWELL_MS): void {
  playGraphTour(ALLOWANCE_OUT_TOUR_STOPS, dwellMs, { soft: true });
}

/** True when a chat stream error means GodMode Inference budget is spent. */
export function isInferenceAllowanceExhaustedError(
  error: string | null | undefined,
  code?: string | null
): boolean {
  const text = String(error ?? "").trim();
  if (!text && !code) return false;
  if (code === "INFERENCE_ALLOWANCE_EXHAUSTED") return true;
  return /\ballowance exhausted\b/i.test(text) || /\bused up\b.*\ballowance\b/i.test(text);
}
