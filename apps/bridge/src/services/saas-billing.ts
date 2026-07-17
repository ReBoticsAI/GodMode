import { config } from "../config.js";
import { getCoreDb } from "../core-db.js";
import { resolveStripeSecretKey, getPublicBillingConfig } from "./platform-billing.js";
import {
  findEntitlementByStripeSession,
  upsertEntitlementFromCheckout,
  verifyStripeWebhookSignature,
  type SaasEntitlement,
} from "./saas-entitlements.js";

function stripeForm(params: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") body.set(k, v);
  }
  return body;
}

export function getSaasPaywallPublicConfig(): {
  enabled: boolean;
  paymentsConfigured: boolean;
  priceConfigured: boolean;
  publishableKey: string | null;
  checkoutMode: "payment" | "subscription";
} {
  const billing = getPublicBillingConfig();
  return {
    enabled: config.isSaas,
    paymentsConfigured: Boolean(resolveStripeSecretKey()),
    priceConfigured: Boolean(config.saas.priceId),
    publishableKey: billing.publishableKey,
    checkoutMode: config.saas.checkoutMode,
  };
}

export async function createSaasCheckoutSession(opts: {
  email?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const secret = resolveStripeSecretKey();
  const priceId = config.saas.priceId;
  if (!secret) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  if (!priceId) {
    throw Object.assign(new Error("STRIPE_SAAS_PRICE_ID is not configured"), { status: 503 });
  }

  const params: Record<string, string> = {
    mode: config.saas.checkoutMode,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[godmode_saas]": "1",
  };
  if (opts.email?.trim()) {
    params.customer_email = opts.email.trim().toLowerCase();
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: stripeForm(params),
  });
  const body = (await res.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.id || !body.url) {
    throw Object.assign(
      new Error(body.error?.message ?? `Stripe Checkout failed (HTTP ${res.status})`),
      { status: 502 }
    );
  }
  return { url: body.url, sessionId: body.id };
}

/** Verify Checkout is paid and ensure a pending entitlement row exists. */
export async function resolveEntitlementForCheckoutSession(
  sessionId: string
): Promise<SaasEntitlement | null> {
  const existing = findEntitlementByStripeSession(getCoreDb(), sessionId);
  if (existing) return existing;

  const secret = resolveStripeSecretKey();
  if (!secret) return null;

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${secret}` } }
  );
  const session = (await res.json()) as {
    id?: string;
    payment_status?: string;
    status?: string;
    customer_email?: string | null;
    customer_details?: { email?: string | null };
    customer?: string | { id?: string } | null;
    metadata?: { godmode_saas?: string };
    error?: { message?: string };
  };
  if (!res.ok || !session.id) return null;
  if (session.metadata?.godmode_saas !== "1") return null;
  const paid =
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required" ||
    session.status === "complete";
  if (!paid) return null;

  const email =
    session.customer_details?.email ?? session.customer_email ?? null;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  return upsertEntitlementFromCheckout({
    stripeSessionId: session.id,
    email,
    stripeCustomerId: customerId,
  });
}

export function handleSaasStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined
): { ok: true; entitlement?: SaasEntitlement } | { ok: false; error: string; status: number } {
  const secret = config.saas.webhookSecret;
  if (!secret) {
    return { ok: false, error: "STRIPE_WEBHOOK_SECRET is not configured", status: 503 };
  }
  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, error: "Invalid Stripe signature", status: 400 };
  }

  let event: {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody.toString("utf8")) as typeof event;
  } catch {
    return { ok: false, error: "Invalid JSON", status: 400 };
  }

  if (event.type !== "checkout.session.completed") {
    return { ok: true };
  }

  const session = event.data?.object ?? {};
  const sessionId = typeof session.id === "string" ? session.id : "";
  if (!sessionId) return { ok: true };

  const metadata = (session.metadata ?? {}) as { godmode_saas?: string };
  if (metadata.godmode_saas !== "1") return { ok: true };

  const customerDetails = session.customer_details as
    | { email?: string | null }
    | undefined;
  const email =
    (typeof customerDetails?.email === "string" ? customerDetails.email : null) ??
    (typeof session.customer_email === "string" ? session.customer_email : null);
  const customer =
    typeof session.customer === "string"
      ? session.customer
      : session.customer && typeof session.customer === "object" &&
          typeof (session.customer as { id?: string }).id === "string"
        ? (session.customer as { id: string }).id
        : null;

  const entitlement = upsertEntitlementFromCheckout({
    stripeSessionId: sessionId,
    email,
    stripeCustomerId: customer,
  });
  return { ok: true, entitlement };
}
