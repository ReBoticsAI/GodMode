import { config } from "../config.js";
import { getCoreDb } from "../core-db.js";
import { resolveStripeSecretKey, getPublicBillingConfig } from "./platform-billing.js";
import {
  findEntitlementByStripeSession,
  upsertEntitlementFromCheckout,
  verifyStripeWebhookSignature,
  type SaasEntitlement,
} from "./saas-entitlements.js";

export type SaasPlanPublic = {
  id: string;
  priceId: string;
  label: string;
  amountLabel: string;
  interval: "month" | "year" | "one_time";
};

function stripeForm(params: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") body.set(k, v);
  }
  return body;
}

export function listSaasPlans(): SaasPlanPublic[] {
  return config.saas.plans.map((p) => ({
    id: p.id,
    priceId: p.priceId,
    label: p.label,
    amountLabel: p.amountLabel,
    interval: p.interval,
  }));
}

export function resolveSaasPlan(planIdOrPriceId?: string): SaasPlanPublic | undefined {
  const plans = listSaasPlans();
  if (!plans.length) return undefined;
  const key = (planIdOrPriceId ?? "").trim();
  if (!key) return plans[0];
  return (
    plans.find((p) => p.id === key || p.priceId === key) ??
    undefined
  );
}

export function getSaasPaywallPublicConfig(): {
  enabled: boolean;
  paymentsConfigured: boolean;
  priceConfigured: boolean;
  publishableKey: string | null;
  checkoutMode: "payment" | "subscription";
  plans: SaasPlanPublic[];
} {
  const billing = getPublicBillingConfig();
  const plans = listSaasPlans();
  return {
    enabled: config.isSaas,
    paymentsConfigured: Boolean(resolveStripeSecretKey()),
    priceConfigured: plans.length > 0,
    publishableKey: billing.publishableKey,
    checkoutMode: config.saas.checkoutMode,
    plans,
  };
}

export async function createSaasCheckoutSession(opts: {
  email?: string;
  plan?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string; planId: string; priceId: string }> {
  const secret = resolveStripeSecretKey();
  const plans = listSaasPlans();
  if (!secret) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  if (!plans.length) {
    throw Object.assign(
      new Error("No SaaS plan configured (set STRIPE_SAAS_PRICE_MONTHLY / YEARLY)"),
      { status: 503 }
    );
  }
  const requested = (opts.plan ?? "").trim();
  const plan = requested
    ? plans.find((p) => p.id === requested || p.priceId === requested)
    : plans[0];
  if (!plan) {
    throw Object.assign(new Error("Unknown plan"), { status: 400 });
  }

  const params: Record<string, string> = {
    mode: config.saas.checkoutMode,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "line_items[0][price]": plan.priceId,
    "line_items[0][quantity]": "1",
    "metadata[godmode_saas]": "1",
    "metadata[godmode_plan]": plan.id,
    "subscription_data[metadata][godmode_saas]": "1",
    "subscription_data[metadata][godmode_plan]": plan.id,
  };
  if (config.saas.checkoutMode !== "subscription") {
    delete params["subscription_data[metadata][godmode_saas]"];
    delete params["subscription_data[metadata][godmode_plan]"];
  }
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
  return { url: body.url, sessionId: body.id, planId: plan.id, priceId: plan.priceId };
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
