#!/usr/bin/env node
/**
 * Create live Stripe Products/Prices for GodMode Inference packs and
 * Cloud with Inference tiers. Prints env lines for deploy.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node deploy/scripts/provision-stripe-inference-prices.mjs
 *
 * Idempotent: reuses existing Prices that match nickname + unit_amount + recurring.
 */
const secret = (process.env.STRIPE_SECRET_KEY ?? "").trim();
if (!secret.startsWith("sk_")) {
  console.error("Set STRIPE_SECRET_KEY to a Stripe secret key.");
  process.exit(1);
}

async function stripe(path, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${path}: ${json?.error?.message ?? res.status}`);
  }
  return json;
}

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GET ${path}: ${json?.error?.message ?? res.status}`);
  }
  return json;
}

async function findOrCreateProduct(name) {
  const listed = await stripeGet("products?limit=100&active=true");
  const hit = (listed.data ?? []).find((p) => p.name === name);
  if (hit) return hit;
  return stripe("products", { name });
}

async function findOrCreatePrice(opts) {
  const listed = await stripeGet(
    `prices?product=${encodeURIComponent(opts.productId)}&limit=100&active=true`
  );
  const hit = (listed.data ?? []).find((p) => {
    if (p.unit_amount !== opts.unitAmount) return false;
    if (p.currency !== "usd") return false;
    if (opts.nickname && p.nickname !== opts.nickname) return false;
    if (!opts.recurring) return p.type === "one_time";
    return (
      p.recurring?.interval === opts.recurring.interval &&
      (opts.recurring.interval_count ?? 1) === (p.recurring?.interval_count ?? 1)
    );
  });
  if (hit) return hit;
  const params = {
    product: opts.productId,
    currency: "usd",
    unit_amount: opts.unitAmount,
    nickname: opts.nickname,
  };
  if (opts.recurring) {
    params["recurring[interval]"] = opts.recurring.interval;
    if (opts.recurring.interval_count && opts.recurring.interval_count > 1) {
      params["recurring[interval_count]"] = opts.recurring.interval_count;
    }
  }
  return stripe("prices", params);
}

const packs = [
  { env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_5", cents: 500, nick: "pack_5" },
  { env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_10", cents: 1000, nick: "pack_10" },
  { env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_25", cents: 2500, nick: "pack_25" },
  { env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_50", cents: 5000, nick: "pack_50" },
  { env: "STRIPE_GODMODE_INFERENCE_PRICE_PACK_100", cents: 10000, nick: "pack_100" },
];

const bundles = [
  {
    env: "STRIPE_SAAS_PRICE_MONTHLY_INFERENCE",
    cents: 1299,
    nick: "monthly_inference",
    recurring: { interval: "month" },
  },
  {
    env: "STRIPE_SAAS_PRICE_MONTHLY_INFERENCE_PLUS",
    cents: 1799,
    nick: "monthly_inference_plus",
    recurring: { interval: "month" },
  },
  {
    env: "STRIPE_SAAS_PRICE_MONTHLY_INFERENCE_PRO",
    cents: 2999,
    nick: "monthly_inference_pro",
    recurring: { interval: "month" },
  },
  {
    env: "STRIPE_SAAS_PRICE_YEARLY_INFERENCE",
    cents: 12900,
    nick: "yearly_inference",
    recurring: { interval: "year" },
  },
  {
    env: "STRIPE_SAAS_PRICE_YEARLY_INFERENCE_PLUS",
    cents: 17900,
    nick: "yearly_inference_plus",
    recurring: { interval: "year" },
  },
  {
    env: "STRIPE_SAAS_PRICE_YEARLY_INFERENCE_PRO",
    cents: 34900,
    nick: "yearly_inference_pro",
    recurring: { interval: "year" },
  },
];

const out = [];

const packProduct = await findOrCreateProduct("GodMode Inference");
for (const p of packs) {
  const price = await findOrCreatePrice({
    productId: packProduct.id,
    unitAmount: p.cents,
    nickname: p.nick,
  });
  out.push(`${p.env}=${price.id}`);
}

const bundleProduct = await findOrCreateProduct("GodMode Cloud with Inference");
for (const b of bundles) {
  const price = await findOrCreatePrice({
    productId: bundleProduct.id,
    unitAmount: b.cents,
    nickname: b.nick,
    recurring: b.recurring,
  });
  out.push(`${b.env}=${price.id}`);
}

console.log("# Paste into Cloud deploy env:");
for (const line of out) console.log(line);
