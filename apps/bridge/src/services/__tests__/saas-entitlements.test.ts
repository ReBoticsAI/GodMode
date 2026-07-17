import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeWebhookSignature } from "../saas-entitlements.js";

describe("verifyStripeWebhookSignature", () => {
  it("accepts a valid Stripe-style signature", () => {
    const secret = "whsec_test";
    const payload = '{"id":"evt_1"}';
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
    expect(
      verifyStripeWebhookSignature(payload, `t=${t},v1=${v1}`, secret)
    ).toBe(true);
  });

  it("rejects a bad signature", () => {
    const secret = "whsec_test";
    const payload = '{"id":"evt_1"}';
    const t = Math.floor(Date.now() / 1000);
    expect(
      verifyStripeWebhookSignature(payload, `t=${t},v1=deadbeef`, secret)
    ).toBe(false);
  });
});
