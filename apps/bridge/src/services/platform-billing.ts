import { getCoreDb, getPlatformMeta, setPlatformMeta } from "../core-db.js";
import { encryptSecret, decryptSecret } from "./holdings/crypto-box.js";

const META_SECRET = "billing.stripe_secret_enc";
const META_PUBLISHABLE = "billing.stripe_publishable_key";
const META_CREDITS_PER_USD = "billing.stripe_credits_per_usd";

export interface PlatformBillingConfig {
  configured: boolean;
  publishableKey: string | null;
  creditsPerUsd: number;
  hasSecretKey: boolean;
}

export function getPlatformBillingConfig(): PlatformBillingConfig {
  const core = getCoreDb();
  const enc = getPlatformMeta(core, META_SECRET);
  const envSecret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const publishableKey = getPlatformMeta(core, META_PUBLISHABLE);
  const creditsRaw = getPlatformMeta(core, META_CREDITS_PER_USD);
  const creditsPerUsd = creditsRaw
    ? Number(creditsRaw)
    : Number(process.env.STRIPE_CREDITS_PER_USD ?? 100);

  return {
    configured: Boolean(enc || envSecret),
    publishableKey,
    creditsPerUsd: Number.isFinite(creditsPerUsd) ? creditsPerUsd : 100,
    hasSecretKey: Boolean(enc || envSecret),
  };
}

/** Resolve Stripe secret: platform_meta (encrypted) then env fallback. */
export function resolveStripeSecretKey(): string {
  const env = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (env) return env;
  const core = getCoreDb();
  const enc = getPlatformMeta(core, META_SECRET);
  if (!enc) return "";
  try {
    return decryptSecret(enc);
  } catch {
    return "";
  }
}

export function setPlatformBillingKeys(opts: {
  secretKey?: string;
  publishableKey?: string;
  creditsPerUsd?: number;
}): PlatformBillingConfig {
  const core = getCoreDb();
  if (opts.secretKey !== undefined) {
    const trimmed = opts.secretKey.trim();
    if (trimmed) {
      setPlatformMeta(core, META_SECRET, encryptSecret(trimmed));
    } else {
      core.prepare(`DELETE FROM platform_meta WHERE key=?`).run(META_SECRET);
    }
  }
  if (opts.publishableKey !== undefined) {
    const trimmed = opts.publishableKey.trim();
    if (trimmed) {
      setPlatformMeta(core, META_PUBLISHABLE, trimmed);
    } else {
      core.prepare(`DELETE FROM platform_meta WHERE key=?`).run(META_PUBLISHABLE);
    }
  }
  if (opts.creditsPerUsd !== undefined && Number.isFinite(opts.creditsPerUsd)) {
    setPlatformMeta(core, META_CREDITS_PER_USD, String(Math.max(1, opts.creditsPerUsd)));
  }
  return getPlatformBillingConfig();
}

export async function testStripeConnection(): Promise<{ ok: boolean; detail?: string }> {
  const key = resolveStripeSecretKey();
  if (!key) return { ok: false, detail: "Stripe secret key not configured" };
  const res = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, detail: body.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true, detail: "connected" };
}

/** Public config for Stripe.js on the marketplace (no secrets). */
export function getPublicBillingConfig(): {
  publishableKey: string | null;
  creditsPerUsd: number;
  paymentsEnabled: boolean;
} {
  const cfg = getPlatformBillingConfig();
  return {
    publishableKey: cfg.publishableKey,
    creditsPerUsd: cfg.creditsPerUsd,
    paymentsEnabled: cfg.configured,
  };
}
