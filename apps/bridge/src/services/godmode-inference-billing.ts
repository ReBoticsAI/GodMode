/**
 * GodMode Inference commerce: prepaid packs ($5–$100).
 * Separate from SaaS Cloud seats. Tops up trial_inference_grants budgets.
 * Cloud with Inference bundles live on SaaS plans (included credit on seat renew).
 */

import { config } from "../config.js";
import { resolveStripeSecretKey, getPublicBillingConfig } from "./platform-billing.js";
import {
  packBudgetUsd,
  topUpGodModeInferenceGrant,
  findActiveGodModeInferenceGrant,
  remainingBudgetUsd,
  isGrantSpendable,
  listGodModeInferenceGrantStats,
} from "./godmode-inference-grants.js";
import { isGodModeInferenceSupplyReady } from "./godmode-inference-supply.js";
import { verifyStripeWebhookSignature } from "./saas-entitlements.js";
import {
  inferenceCheckoutDelegatesToCloud,
  recordInferenceCloudCheckout,
  markInferenceCloudCheckoutPaid,
} from "./godmode-inference-cloud-checkout.js";

export type GodModeInferencePlanInterval = "one_time";

export type GodModeInferencePlanPublic = {
  id: string;
  priceId: string;
  label: string;
  amountLabel: string;
  interval: GodModeInferencePlanInterval;
  budgetUsd: number;
};

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function stripeForm(params: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") body.set(k, v);
  }
  return body;
}

const PACK_DEFS: Array<{
  id: string;
  env: string;
  label: string;
  amountLabel: string;
  budgetUsd: number;
  unitAmountCents: number;
}> = [
  {
    id: "pack_5",
    env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_5",
    label: "$5 GodMode Inference pack",
    amountLabel: "$5",
    budgetUsd: 5,
    unitAmountCents: 500,
  },
  {
    id: "pack_10",
    env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_10",
    label: "$10 GodMode Inference pack",
    amountLabel: "$10",
    budgetUsd: 10,
    unitAmountCents: 1000,
  },
  {
    id: "pack_25",
    env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_25",
    label: "$25 GodMode Inference pack",
    amountLabel: "$25",
    budgetUsd: 25,
    unitAmountCents: 2500,
  },
  {
    id: "pack_50",
    env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_50",
    label: "$50 GodMode Inference pack",
    amountLabel: "$50",
    budgetUsd: 50,
    unitAmountCents: 5000,
  },
  {
    id: "pack_100",
    env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_100",
    label: "$100 GodMode Inference pack",
    amountLabel: "$100",
    budgetUsd: 100,
    unitAmountCents: 10000,
  },
];

export function isGodModeInferencePackPlanId(planId: string | null | undefined): boolean {
  const id = (planId ?? "").trim();
  if (!id) return false;
  if (id === "pack") return true;
  return PACK_DEFS.some((p) => p.id === id);
}

/** Prepaid packs always offered when Stripe (or Cloud delegate) is available. */
export function listGodModeInferencePlans(): GodModeInferencePlanPublic[] {
  const plans: GodModeInferencePlanPublic[] = [];
  const legacyPack = readEnv("STRIPE_GODMODE_INFERENCE_PRICE_PACK");
  for (const d of PACK_DEFS) {
    let priceId = readEnv(d.env);
    // Legacy single pack env maps to $5 when the $5-specific env is unset.
    if (!priceId && d.id === "pack_5" && legacyPack) priceId = legacyPack;
    plans.push({
      id: d.id,
      priceId: priceId || `price_data:${d.id}`,
      label: d.label,
      amountLabel: d.amountLabel,
      interval: "one_time",
      budgetUsd: d.budgetUsd,
    });
  }
  return plans;
}

export function getGodModeInferencePublicConfig(): {
  supplyReady: boolean;
  paymentsConfigured: boolean;
  publishableKey: string | null;
  plans: GodModeInferencePlanPublic[];
  payPath: string;
} {
  const billing = getPublicBillingConfig();
  return {
    supplyReady: isGodModeInferenceSupplyReady(),
    paymentsConfigured:
      Boolean(resolveStripeSecretKey()) || inferenceCheckoutDelegatesToCloud(),
    publishableKey: billing.publishableKey,
    plans: listGodModeInferencePlans(),
    payPath: "/platform-vault?vault=inference&sub=godmode",
  };
}

function accountCanCheckout(email: string, temporary: boolean): boolean {
  const value = email.trim().toLowerCase();
  if (temporary || value.startsWith("visitor+")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function getGodModeInferenceUserStatus(
  userId: string,
  account?: { email?: string | null; temporary?: boolean }
): {
  supplyReady: boolean;
  canCheckout: boolean;
  grant: {
    kind: string;
    status: string;
    remainingUsd: number | null;
    budgetUsd: number | null;
    spentUsd: number;
    promptCount: number;
  } | null;
  plans: GodModeInferencePlanPublic[];
  paymentsConfigured: boolean;
} {
  const grant = findActiveGodModeInferenceGrant({ userId });
  const remaining = grant ? remainingBudgetUsd(grant) : null;
  return {
    supplyReady: isGodModeInferenceSupplyReady(),
    canCheckout:
      inferenceCheckoutDelegatesToCloud() ||
      accountCanCheckout(account?.email ?? "", Boolean(account?.temporary)),
    grant: grant
      ? {
          kind: grant.kind,
          status: isGrantSpendable(grant) ? grant.status : "expired",
          remainingUsd: Number.isFinite(remaining as number)
            ? (remaining as number)
            : null,
          budgetUsd: grant.budget_usd,
          spentUsd: grant.spent_usd,
          promptCount: grant.prompt_count,
        }
      : null,
    plans: listGodModeInferencePlans(),
    paymentsConfigured:
      Boolean(resolveStripeSecretKey()) || inferenceCheckoutDelegatesToCloud(),
  };
}

function resolvePackDef(planId: string) {
  const id = planId.trim() === "pack" ? "pack_5" : planId.trim();
  return PACK_DEFS.find((p) => p.id === id) ?? null;
}

export async function createGodModeInferenceCheckoutSession(opts: {
  userId?: string;
  email?: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
  /** Local buyer. Cloud creates the Stripe session and the grant is claimed back on Local. */
  cloudClaim?: boolean;
}): Promise<{ url: string; sessionId: string; planId: string }> {
  const secret = resolveStripeSecretKey();
  if (!secret) {
    throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  }
  const requested = opts.planId.trim() === "pack" ? "pack_5" : opts.planId.trim();
  const plans = listGodModeInferencePlans();
  const plan = plans.find((p) => p.id === requested);
  if (!plan) {
    throw Object.assign(new Error("Unknown GodMode Inference plan"), {
      status: 400,
    });
  }
  const packDef = resolvePackDef(plan.id);
  const email = (opts.email ?? "").trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.startsWith("visitor+");
  if (!opts.cloudClaim && !emailOk) {
    throw Object.assign(new Error("Valid email is required"), { status: 400 });
  }

  const params: Record<string, string> = {
    mode: "payment",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "metadata[godmode_inference]": "1",
    "metadata[godmode_inference_plan]": plan.id,
    "metadata[godmode_inference_budget_usd]": String(plan.budgetUsd),
  };
  if (emailOk) params.customer_email = email;
  if (opts.cloudClaim) {
    params["metadata[godmode_inference_cloud]"] = "1";
  } else if (opts.userId) {
    params["metadata[godmode_inference_user]"] = opts.userId;
  }

  if (plan.priceId.startsWith("price_data:") || !plan.priceId.startsWith("price_")) {
    const cents = packDef?.unitAmountCents ?? Math.round(plan.budgetUsd * 100);
    params["line_items[0][price_data][currency]"] = "usd";
    params["line_items[0][price_data][unit_amount]"] = String(cents);
    params["line_items[0][price_data][product_data][name]"] = plan.label;
    params["line_items[0][quantity]"] = "1";
  } else {
    params["line_items[0][price]"] = plan.priceId;
    params["line_items[0][quantity]"] = "1";
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: stripeForm(params),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.id || !body.url) {
    throw Object.assign(
      new Error(body.error?.message || "Stripe Checkout failed"),
      { status: 502 }
    );
  }
  if (opts.cloudClaim) {
    recordInferenceCloudCheckout({
      sessionId: body.id,
      planId: plan.id,
      budgetUsd: plan.budgetUsd,
    });
  }
  return { url: body.url, sessionId: body.id, planId: plan.id };
}

function applyCheckoutGrant(meta: Record<string, string>, sessionId: string, subscriptionId?: string | null) {
  const userId = meta.godmode_inference_user?.trim();
  if (!userId) return false;
  const planId = meta.godmode_inference_plan?.trim() || "pack_5";
  const budget = Number(meta.godmode_inference_budget_usd) || packBudgetUsd();
  const kind = isGodModeInferencePackPlanId(planId) ? "pack" : "subscription";
  topUpGodModeInferenceGrant({
    userId,
    kind,
    budgetUsd: budget,
    stripeSessionId: sessionId,
    stripeSubscriptionId: subscriptionId ?? null,
  });
  return true;
}

/**
 * Demux helper for Cloud Stripe webhooks (same endpoint as SaaS seats).
 * Returns true when the event was a GodMode Inference purchase / renewal.
 */
export function tryApplyGodModeInferenceStripeEvent(
  type: string,
  obj: Record<string, unknown>
): boolean {
  if (type === "checkout.session.completed") {
    const meta = (obj.metadata ?? {}) as Record<string, string>;
    if (meta.godmode_inference !== "1") return false;
    if (meta.godmode_inference_cloud === "1") {
      return markInferenceCloudCheckoutPaid(String(obj.id ?? ""));
    }
    return applyCheckoutGrant(
      meta,
      String(obj.id ?? ""),
      typeof obj.subscription === "string" ? obj.subscription : null
    );
  }

  if (type === "invoice.paid") {
    const subDetails = obj.subscription_details as
      | { metadata?: Record<string, string> }
      | undefined;
    const meta =
      subDetails?.metadata ??
      (obj.metadata as Record<string, string> | undefined) ??
      {};
    if (meta.godmode_inference !== "1") return false;
    return applyCheckoutGrant(
      meta,
      String(obj.id ?? ""),
      typeof obj.subscription === "string" ? obj.subscription : null
    );
  }

  return false;
}

/**
 * Standalone webhook handler (alias of Cloud Stripe demux).
 * Prefer posting Inference events to `/api/saas/stripe/webhook` on GodMode Cloud;
 * this path remains for local hubs that reuse the same STRIPE_WEBHOOK_SECRET.
 */
export function handleGodModeInferenceStripeWebhook(
  rawBody: Buffer | string,
  signature: string | undefined
): { ok: boolean; detail?: string; status?: number } {
  const secret = config.saas.webhookSecret;
  if (!secret) {
    return {
      ok: false,
      detail: "STRIPE_WEBHOOK_SECRET is not configured",
      status: 503,
    };
  }
  const buf =
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  if (!verifyStripeWebhookSignature(buf, signature, secret)) {
    return { ok: false, detail: "Invalid Stripe signature", status: 400 };
  }

  let event: {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(buf.toString("utf8")) as typeof event;
  } catch {
    return { ok: false, detail: "Invalid JSON", status: 400 };
  }

  const type = event.type ?? "";
  const obj = event.data?.object ?? {};
  if (tryApplyGodModeInferenceStripeEvent(type, obj)) {
    return { ok: true, detail: "grant topped up" };
  }
  return { ok: true, detail: `ignored ${type || "event"}` };
}

export function getAdminGodModeInferenceHealth() {
  return {
    ...listGodModeInferenceGrantStats(),
    supplyReady: isGodModeInferenceSupplyReady(),
    plansConfigured: listGodModeInferencePlans().length,
  };
}
