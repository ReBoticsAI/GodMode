import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CoreDatabase } from "../core-db.js";
import { getCoreDb } from "../core-db.js";

export type SaasEntitlementStatus = "pending" | "consumed" | "revoked";

/** One paid Checkout session → one signup entitlement (no invite codes). */
export interface SaasEntitlement {
  id: string;
  email: string | null;
  stripe_session_id: string;
  stripe_customer_id: string | null;
  status: SaasEntitlementStatus;
  created_at: string;
  consumed_at: string | null;
  consumed_by_user_id: string | null;
}

export function findEntitlementByStripeSession(
  core: CoreDatabase,
  sessionId: string
): SaasEntitlement | undefined {
  const trimmed = sessionId.trim();
  if (!trimmed) return undefined;
  return core
    .prepare(`SELECT * FROM saas_entitlements WHERE stripe_session_id=? LIMIT 1`)
    .get(trimmed) as SaasEntitlement | undefined;
}

export function findPendingEntitlementByStripeSession(
  core: CoreDatabase,
  sessionId: string
): SaasEntitlement | undefined {
  const row = findEntitlementByStripeSession(core, sessionId);
  return row?.status === "pending" ? row : undefined;
}

/** Create or return existing entitlement for a completed Checkout session. */
export function upsertEntitlementFromCheckout(opts: {
  stripeSessionId: string;
  email?: string | null;
  stripeCustomerId?: string | null;
}): SaasEntitlement {
  const core = getCoreDb();
  const existing = findEntitlementByStripeSession(core, opts.stripeSessionId);
  if (existing) return existing;

  const id = randomUUID();
  const email = opts.email?.trim().toLowerCase() || null;
  core
    .prepare(
      `INSERT INTO saas_entitlements (
        id, email, stripe_session_id, stripe_customer_id, status
      ) VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(id, email, opts.stripeSessionId, opts.stripeCustomerId ?? null);

  return core
    .prepare(`SELECT * FROM saas_entitlements WHERE id=?`)
    .get(id) as SaasEntitlement;
}

export function consumeSaasEntitlement(
  core: CoreDatabase,
  stripeSessionId: string,
  userId: string
): SaasEntitlement {
  const entitlement = findPendingEntitlementByStripeSession(core, stripeSessionId);
  if (!entitlement) {
    throw Object.assign(new Error("Complete payment before signing up"), {
      status: 403,
    });
  }
  const result = core
    .prepare(
      `UPDATE saas_entitlements
       SET status='consumed', consumed_at=datetime('now'), consumed_by_user_id=?
       WHERE id=? AND status='pending'`
    )
    .run(userId, entitlement.id);
  if (result.changes !== 1) {
    throw Object.assign(new Error("This payment has already been used to create an account"), {
      status: 403,
    });
  }
  return core
    .prepare(`SELECT * FROM saas_entitlements WHERE id=?`)
    .get(entitlement.id) as SaasEntitlement;
}

export function verifyStripeWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSec = 300
): boolean {
  if (!signatureHeader || !secret) return false;
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!timestamp || !v1) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
