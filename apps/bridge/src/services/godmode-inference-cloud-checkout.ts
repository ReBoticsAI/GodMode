import { config } from "../config.js";
import { getCloudDb } from "../core-db.js";
import { resolveStripeSecretKey } from "./platform-billing.js";
import { cloudCommerceBase } from "./marketplace-cloud-checkout-client.js";
import { isAllowedMarketplaceReturnUrl } from "./marketplace-guest-checkout.js";

/**
 * Local installs have no Stripe secret. Checkout is created on GodMode Cloud,
 * the same way a Local Seller seat and a Local marketplace purchase are.
 */
export function inferenceCheckoutDelegatesToCloud(): boolean {
  if (config.isSaas) return false;
  if (resolveStripeSecretKey()) return false;
  return Boolean(cloudCommerceBase());
}

export function assertInferenceCloudReturnUrl(raw: unknown, kind: "success" | "cancel"): string {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url || !isAllowedMarketplaceReturnUrl(url)) {
    throw Object.assign(new Error(`Invalid ${kind} URL`), { status: 400 });
  }
  if (kind === "success" && !url.includes("{CHECKOUT_SESSION_ID}")) {
    throw Object.assign(
      new Error("successUrl must include {CHECKOUT_SESSION_ID}"),
      { status: 400 }
    );
  }
  return url;
}

function ensureCloudCheckoutTable(): void {
  getCloudDb().exec(`
    CREATE TABLE IF NOT EXISTS godmode_inference_cloud_checkouts (
      session_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      budget_usd REAL NOT NULL,
      status TEXT NOT NULL,
      claimed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function recordInferenceCloudCheckout(opts: {
  sessionId: string;
  planId: string;
  budgetUsd: number;
}): void {
  ensureCloudCheckoutTable();
  getCloudDb()
    .prepare(
      `INSERT INTO godmode_inference_cloud_checkouts (session_id, plan_id, budget_usd, status)
       VALUES (?, ?, ?, 'pending')
       ON CONFLICT(session_id) DO NOTHING`
    )
    .run(opts.sessionId, opts.planId, opts.budgetUsd);
}

export function markInferenceCloudCheckoutPaid(sessionId: string): boolean {
  if (!sessionId) return false;
  ensureCloudCheckoutTable();
  const info = getCloudDb()
    .prepare(
      `UPDATE godmode_inference_cloud_checkouts
       SET status='paid'
       WHERE session_id=? AND status='pending'`
    )
    .run(sessionId);
  if (info.changes > 0) return true;
  const row = getCloudDb()
    .prepare(
      `SELECT status FROM godmode_inference_cloud_checkouts WHERE session_id=?`
    )
    .get(sessionId) as { status?: string } | undefined;
  return row?.status === "paid";
}

export function claimInferenceCloudCheckout(sessionId: string): {
  planId: string;
  budgetUsd: number;
} {
  ensureCloudCheckoutTable();
  const db = getCloudDb();
  const row = db
    .prepare(
      `SELECT plan_id, budget_usd, status, claimed_at
       FROM godmode_inference_cloud_checkouts WHERE session_id=?`
    )
    .get(sessionId) as
    | { plan_id: string; budget_usd: number; status: string; claimed_at: string | null }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Checkout session not found"), { status: 404 });
  }
  if (row.status !== "paid") {
    throw Object.assign(new Error("Payment is not complete"), { status: 402 });
  }
  if (row.claimed_at) {
    throw Object.assign(new Error("This payment was already applied"), { status: 409 });
  }
  const info = db
    .prepare(
      `UPDATE godmode_inference_cloud_checkouts
       SET claimed_at=datetime('now')
       WHERE session_id=? AND status='paid' AND claimed_at IS NULL`
    )
    .run(sessionId);
  if (info.changes !== 1) {
    throw Object.assign(new Error("This payment was already applied"), { status: 409 });
  }
  return { planId: row.plan_id, budgetUsd: Number(row.budget_usd) };
}

async function cloudInferenceJson<T>(path: string, body: unknown): Promise<T> {
  const base = cloudCommerceBase();
  if (!base) {
    throw Object.assign(new Error("GodMode Cloud URL is not configured"), { status: 503 });
  }
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw Object.assign(
      new Error(typeof json.error === "string" ? json.error : `Cloud checkout failed (${res.status})`),
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 }
    );
  }
  return json;
}

export async function startDelegatedInferenceCheckout(body: {
  planId: string;
  successUrl: string;
  cancelUrl: string;
  email?: string;
}): Promise<{ url: string; sessionId: string; planId: string }> {
  return cloudInferenceJson("/api/godmode-inference/cloud-checkout", body);
}

export async function claimDelegatedInferenceCheckout(sessionId: string): Promise<{
  planId: string;
  budgetUsd: number;
}> {
  return cloudInferenceJson("/api/godmode-inference/cloud-checkout/claim", { sessionId });
}
