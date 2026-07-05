import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase } from "../core-db.js";
import { config } from "../config.js";
import { adjustCredits, CreditsError } from "./credits.js";
import {
  getPlatformBillingConfig,
  resolveStripeSecretKey,
} from "./platform-billing.js";

function creditsPerUsd(): number {
  return getPlatformBillingConfig().creditsPerUsd;
}

/**
 * Purchase credits via Stripe when configured; dev grant only in local mode.
 */
export async function purchaseCredits(
  core: CoreDatabase,
  userId: string,
  amount: number,
  opts?: { paymentIntentId?: string; usdCents?: number }
): Promise<number> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CreditsError(400, "amount must be positive");
  }

  const stripeKey = resolveStripeSecretKey();
  const allowDev =
    !config.isProduction &&
    process.env.ALLOW_DEV_CREDIT_PURCHASE === "true" &&
    !stripeKey;

  if (!stripeKey && !allowDev && !opts?.paymentIntentId) {
    throw new CreditsError(
      503,
      "Credit purchases are not configured — connect Stripe in Admin → Billing"
    );
  }

  if (stripeKey && opts?.paymentIntentId) {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(opts.paymentIntentId)}`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    if (!res.ok) {
      throw new CreditsError(402, "Stripe payment verification failed");
    }
    const pi = (await res.json()) as { status?: string; amount?: number };
    if (pi.status !== "succeeded") {
      throw new CreditsError(402, `Payment not completed (${pi.status ?? "unknown"})`);
    }
    const paidCredits =
      opts.usdCents != null
        ? Math.round((opts.usdCents / 100) * creditsPerUsd())
        : amount;
    return adjustCredits(core, {
      userId,
      delta: paidCredits,
      reason: "stripe_purchase",
      refType: "stripe_payment_intent",
      refId: opts.paymentIntentId,
    });
  }

  return adjustCredits(core, {
    userId,
    delta: amount,
    reason: allowDev ? "dev_credit_grant" : "purchase_stub",
    refType: "purchase",
    refId: uuidv4(),
  });
}

/** Create a Stripe PaymentIntent for the checkout UI (hub only). */
export async function createStripePaymentIntent(
  usdCents: number,
  metadata: Record<string, string>
): Promise<{ clientSecret: string; id: string } | null> {
  const stripeKey = resolveStripeSecretKey();
  if (!stripeKey || usdCents < 50) return null;

  const body = new URLSearchParams();
  body.set("amount", String(usdCents));
  body.set("currency", "usd");
  body.set("automatic_payment_methods[enabled]", "true");
  for (const [k, v] of Object.entries(metadata)) {
    body.set(`metadata[${k}]`, v);
  }

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { client_secret?: string; id?: string };
  if (!data.client_secret || !data.id) return null;
  return { clientSecret: data.client_secret, id: data.id };
}

/** Verify webhook signature and grant credits (optional hardening). */
export async function grantCreditsFromPaymentIntent(
  core: CoreDatabase,
  userId: string,
  paymentIntentId: string,
  usdCents: number
): Promise<number> {
  return purchaseCredits(core, userId, 0, { paymentIntentId, usdCents });
}
