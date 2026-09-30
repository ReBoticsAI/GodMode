import {
  cancelGraphTour,
  GRAPH_TOUR_DWELL_MS,
  GRAPH_TOUR_LINE_EVENT,
} from "@/lib/guide-ui-action";
import {
  CLOUD_INFERENCE_PLUS_PRICE,
  CLOUD_INFERENCE_PRO_PRICE,
  CLOUD_INFERENCE_STARTER_PRICE,
  CLOUD_MONTHLY_PRICE,
  CLOUD_YEARLY_PRICE,
} from "@/lib/cloud-guide";

/** Default highlighted prepaid pack. Ladder is $5 / $10 / $25 / $50 / $100. */
export const INFERENCE_PACK_PRICE = "$10";
export const INFERENCE_PACK_PRICES = ["$5", "$10", "$25", "$50", "$100"] as const;

export const INFERENCE_OFFER_OPEN_EVENT = "godmode:inference-offer-open";
export const INFERENCE_OFFER_SECTION_EVENT = "godmode:inference-offer-section";
export const INFERENCE_OFFER_DONE_EVENT = "godmode:inference-offer-done";

export type InferenceOfferKind = "inference" | "cloud_inference";

export type InferenceOfferStop = {
  id: string;
  title: string;
  say: string;
};

export const INFERENCE_OFFER_STOPS: InferenceOfferStop[] = [
  {
    id: "supply",
    title: "Model supply",
    say: "GodMode Inference is the model supply. It is not the hosted workspace. It pairs with a local install, or with GodMode Cloud.",
  },
  {
    id: "pack",
    title: "Inference pack",
    say: `Prepaid packs are ${INFERENCE_PACK_PRICES.join(", ")}. Each pack tops up the managed balance at face value. The model is GLM 5.3 Flash.`,
  },
  {
    id: "here",
    title: "Stay in GodMode",
    say: "The prices and your balance stay in this chat and in the window beside it. Payment uses Stripe Checkout, then returns to GodMode.",
  },
];

export const CLOUD_INFERENCE_OFFER_STOPS: InferenceOfferStop[] = [
  {
    id: "workspace",
    title: "Hosted workspace",
    say: `GodMode Cloud hosts the workspace. Cloud Monthly (BYOK) is ${CLOUD_MONTHLY_PRICE}. Cloud Yearly is ${CLOUD_YEARLY_PRICE}. You are not running GodMode on this computer.`,
  },
  {
    id: "models",
    title: "Models included",
    say: `Cloud with Inference bundles the seat and included Inference credit. Starter is ${CLOUD_INFERENCE_STARTER_PRICE}/mo with $5 credit, Plus ${CLOUD_INFERENCE_PLUS_PRICE}/mo with $10, Pro ${CLOUD_INFERENCE_PRO_PRICE}/mo with $25. The model is GLM 5.3 Flash. You do not bring your own key on this path.`,
  },
  {
    id: "here",
    title: "Stay in GodMode",
    say: "The prices and your balance stay in this chat and in the window beside it. Payment uses Stripe Checkout, then returns to GodMode.",
  },
];

export function inferenceOfferStops(kind: InferenceOfferKind): InferenceOfferStop[] {
  return kind === "cloud_inference"
    ? CLOUD_INFERENCE_OFFER_STOPS
    : INFERENCE_OFFER_STOPS;
}

export function inferenceOfferTitle(kind: InferenceOfferKind): string {
  return kind === "cloud_inference"
    ? "Cloud with Inference"
    : "GodMode Inference";
}

/** Open the offer window without narrating. Used from the composer balance chip. */
export function openInferenceOffer(kind: InferenceOfferKind): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(INFERENCE_OFFER_OPEN_EVENT, { detail: { kind } })
  );
}

/** Open the offer window and narrate it in chat. No model call. */
export function playInferenceOffer(
  kind: InferenceOfferKind,
  dwellMs = GRAPH_TOUR_DWELL_MS
): void {
  cancelGraphTour();
  if (typeof window === "undefined") return;
  const stops = inferenceOfferStops(kind);
  const wait = Math.min(20_000, Math.max(1_000, dwellMs));
  const timers: number[] = [];
  const onReset = () => {
    for (const id of timers) window.clearTimeout(id);
    window.removeEventListener("godmode:graph-tour-reset", onReset);
  };
  window.addEventListener("godmode:graph-tour-reset", onReset);
  window.dispatchEvent(
    new CustomEvent(INFERENCE_OFFER_OPEN_EVENT, { detail: { kind } })
  );
  const show = (stop: InferenceOfferStop) => {
    window.dispatchEvent(
      new CustomEvent(INFERENCE_OFFER_SECTION_EVENT, { detail: { id: stop.id } })
    );
    window.dispatchEvent(
      new CustomEvent(GRAPH_TOUR_LINE_EVENT, {
        detail: { label: stop.title, say: stop.say },
      })
    );
  };
  show(stops[0]);
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i];
    timers.push(window.setTimeout(() => show(stop), i * wait));
  }
  timers.push(
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(INFERENCE_OFFER_DONE_EVENT));
    }, stops.length * wait)
  );
}
