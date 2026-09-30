import { describe, expect, it } from "vitest";
import { CLOUD_MONTHLY_PRICE, CLOUD_YEARLY_PRICE } from "../cloud-guide";
import { canBillEmail, inferenceCheckoutReturnUrls } from "../inference-checkout";
import {
  CLOUD_INFERENCE_OFFER_STOPS,
  INFERENCE_OFFER_STOPS,
  INFERENCE_PACK_PRICE,
  inferenceOfferStops,
} from "../inference-offer";

describe("inference offer", () => {
  it("keeps Inference and Cloud with Inference inside GodMode", () => {
    expect(inferenceOfferStops("inference").map((stop) => stop.id)).toEqual([
      "supply",
      "pack",
      "here",
    ]);
    expect(inferenceOfferStops("cloud_inference").map((stop) => stop.id)).toEqual([
      "workspace",
      "models",
      "here",
    ]);
    const inference = INFERENCE_OFFER_STOPS.map((stop) => stop.say).join(" ");
    const cloud = CLOUD_INFERENCE_OFFER_STOPS.map((stop) => stop.say).join(" ");
    expect(inference).toContain(INFERENCE_PACK_PRICE);
    expect(inference).toContain("GLM 5.3 Flash");
    expect(cloud).toContain(CLOUD_MONTHLY_PRICE);
    expect(cloud).toContain(CLOUD_YEARLY_PRICE);
    expect(cloud).toContain(INFERENCE_PACK_PRICE);
    expect(`${inference} ${cloud}`).toContain("Stripe Checkout");
    expect(`${inference} ${cloud}`).not.toMatch(/https?:\/\//);
    expect(`${inference} ${cloud}`).not.toContain("\u2014");
  });

  it("returns Stripe buyers to GodMode and skips visitor mail", () => {
    expect(inferenceCheckoutReturnUrls("http://127.0.0.1:5173", "inference")).toEqual({
      successUrl: "http://127.0.0.1:5173/?inference=paid&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "http://127.0.0.1:5173/?inference=cancel",
    });
    expect(canBillEmail("visitor+abc@godmode.local", true)).toBe(false);
    expect(canBillEmail("visitor+abc@godmode.local", false)).toBe(false);
    expect(canBillEmail("person@example.com", false)).toBe(true);
  });
});
