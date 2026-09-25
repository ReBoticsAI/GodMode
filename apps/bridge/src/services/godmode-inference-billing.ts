/**
 * GodMode Inference commerce: $1 packs + subscription ladder.
 * Separate from SaaS Cloud seats. Tops up trial_inference_grants budgets.
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

export type GodModeInferencePlanInterval =
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "semiannual"
  | "year"
  | "one_time";

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

/** $1 pack always offered when Stripe is configured (price id optional; price_data fallback). */
export function listGodModeInferencePlans(): GodModeInferencePlanPublic[] {
  const plans: GodModeInferencePlanPublic[] = [];
  const packPrice = readEnv("STRIPE_GODMODE_INFERENCE_PRICE_PACK");
  plans.push({
    id: "pack",
    priceId: packPrice || "price_data:pack",
    label: "$1 GodMode Inference pack",
    amountLabel: "$1",
    interval: "one_time",
    budgetUsd: packBudgetUsd(),
  });

  const defs: Array<{
    id: string;
    env: string;
    label: string;
    amountLabel: string;
    interval: GodModeInferencePlanInterval;
    budgetEnv: string;
    defaultBudget: number;
  }> = [
    {
      id: "daily",
      env: "STRIPE_GODMODE_INFERENCE_PRICE_DAILY",
      label: "Daily",
      amountLabel: "Daily",
      interval: "day",
      budgetEnv: "GODMODE_INFERENCE_BUDGET_DAILY_USD",
      defaultBudget: 1,
    },
    {
      id: "weekly",
      env: "STRIPE_GODMODE_INFERENCE_PRICE_WEEKLY",
      label: "Weekly",
      amountLabel: "Weekly",
      interval: "week",
      budgetEnv: "GODMODE_INFERENCE_BUDGET_WEEKLY_USD",
      defaultBudget: 5,
    },
    {
      id: "monthly",
      env: "STRIPE_GODMODE_INFERENCE_PRICE_MONTHLY",
      label: "Monthly",
      amountLabel: "Monthly",
      interval: "month",
      budgetEnv: "GODMODE_INFERENCE_BUDGET_MONTHLY_USD",
      defaultBudget: 15,
    },
    {
      id: "quarterly",
      env: "STRIPE_GODMODE_INFERENCE_PRICE_QUARTERLY",
      label: "Quarterly",
      amountLabel: "Quarterly",
      interval: "quarter",
      budgetEnv: "GODMODE_INFERENCE_BUDGET_QUARTERLY_USD",
      defaultBudget: 40,
    },
    {
      id: "semiannual",
      env: "STRIPE_GODMODE_INFERENCE_PRICE_SEMIANNUAL",
      label: "Semi-annual",
      amountLabel: "Semi-annual",
      interval: "semiannual",
      budgetEnv: "GODMODE_INFERENCE_BUDGET_SEMIANNUAL_USD",
      defaultBudget: 70,
    },
    {
      id: "yearly",
      env: "STRIPE_GODMODE_INFERENCE_PRICE_YEARLY",
      label: "Yearly",
      amountLabel: "Yearly",
      interval: "year",
      budgetEnv: "GODMODE_INFERENCE_BUDGET_YEARLY_USD",
      defaultBudget: 120,
    },
  ];

  for (const d of defs) {
    const priceId = readEnv(d.env);
    if (!priceId) continue;
    const budgetRaw = Number(readEnv(d.budgetEnv));
    plans.push({
      id: d.id,
      priceId,
      label: d.label,
      amountLabel: d.amountLabel,
      interval: d.interval,
      budgetUsd:
        Number.isFinite(budgetRaw) && budgetRaw > 0
          ? budgetRaw
          : d.defaultBudget,
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
    paymentsConfigured: Boolean(resolveStripeSecretKey()),
    publishableKey: billing.publishableKey,
    plans: listGodModeInferencePlans(),
    payPath: "/platform-vault?vault=inference&sub=godmode",
  };
}

export function getGodModeInferenceUserStatus(userId: string): {
  supplyReady: boolean;
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
    paymentsConfigured: Boolean(resolveStripeSecretKey()),
  };
}

export async function createGodModeInferenceCheckoutSession(opts: {
  userId: string;
  email: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string; planId: string }> {
  const secret = resolveStripeSecretKey();
  if (!secret) {
    throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  }
  const plans = listGodModeInferencePlans();
  const plan = plans.find((p) => p.id === opts.planId);
  if (!plan) {
    throw Object.assign(new Error("Unknown GodMode Inference plan"), {
      status: 400,
    });
  }
  const email = opts.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Valid email is required"), { status: 400 });
  }

  const mode = plan.interval === "one_time" ? "payment" : "subscription";
  const params: Record<string, string> = {
    mode,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: email,
    "metadata[godmode_inference]": "1",
    "metadata[godmode_inference_plan]": plan.id,
    "metadata[godmode_inference_user]": opts.userId,
    "metadata[godmode_inference_budget_usd]": String(plan.budgetUsd),
  };

  if (plan.priceId.startsWith("price_data:") || !plan.priceId.startsWith("price_")) {
    // $1 pack without a pre-created Stripe Price: use price_data.
    params["line_items[0][price_data][currency]"] = "usd";
    params["line_items[0][price_data][unit_amount]"] = "100";
    params["line_items[0][price_data][product_data][name]"] =
      "GodMode Inference pack";
    params["line_items[0][quantity]"] = "1";
  } else {
    params["line_items[0][price]"] = plan.priceId;
    params["line_items[0][quantity]"] = "1";
  }

  if (mode === "subscription") {
    params["subscription_data[metadata][godmode_inference]"] = "1";
    params["subscription_data[metadata][godmode_inference_plan]"] = plan.id;
    params["subscription_data[metadata][godmode_inference_user]"] = opts.userId;
    params["subscription_data[metadata][godmode_inference_budget_usd]"] =
      String(plan.budgetUsd);
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
  return { url: body.url, sessionId: body.id, planId: plan.id };
}

function applyCheckoutGrant(meta: Record<string, string>, sessionId: string, subscriptionId?: string | null) {
  const userId = meta.godmode_inference_user?.trim();
  if (!userId) return false;
  const planId = meta.godmode_inference_plan?.trim() || "pack";
  const budget = Number(meta.godmode_inference_budget_usd) || packBudgetUsd();
  const kind = planId === "pack" ? "pack" : "subscription";
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
