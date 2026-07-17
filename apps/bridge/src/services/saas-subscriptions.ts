import { randomUUID } from "node:crypto";
import type { CoreDatabase, CoreUser } from "../core-db.js";
import { getCoreDb } from "../core-db.js";
import { config } from "../config.js";

function planMeta(planIdOrPriceId: string | null | undefined): {
  id: string | null;
  label: string | null;
  amountLabel: string | null;
} {
  const key = (planIdOrPriceId ?? "").trim();
  if (!key) return { id: null, label: null, amountLabel: null };
  const plan = config.saas.plans.find((p) => p.id === key || p.priceId === key);
  return plan
    ? { id: plan.id, label: plan.label, amountLabel: plan.amountLabel }
    : { id: key, label: key, amountLabel: null };
}

export type SaasSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export interface SaasSubscription {
  id: string;
  user_id: string | null;
  email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_session_id: string | null;
  plan_id: string | null;
  price_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
  access_revoked: number;
  created_at: string;
  updated_at: string;
}

const TERMINAL_STATUSES = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

const ALLOWED_STATUSES = new Set(["active", "trialing", "past_due"]);

function isoFromUnix(sec: unknown): string | null {
  const n = typeof sec === "number" ? sec : Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function periodStillActive(periodEnd: string | null): boolean {
  if (!periodEnd) return false;
  const t = Date.parse(periodEnd);
  return Number.isFinite(t) && t > Date.now();
}

export function findSubscriptionByUserId(
  core: CoreDatabase,
  userId: string
): SaasSubscription | undefined {
  return core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE user_id=?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`
    )
    .get(userId) as SaasSubscription | undefined;
}

export function findSubscriptionByCustomerId(
  core: CoreDatabase,
  customerId: string
): SaasSubscription | undefined {
  const trimmed = customerId.trim();
  if (!trimmed) return undefined;
  return core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE stripe_customer_id=?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`
    )
    .get(trimmed) as SaasSubscription | undefined;
}

export function findSubscriptionByStripeSubscriptionId(
  core: CoreDatabase,
  subscriptionId: string
): SaasSubscription | undefined {
  const trimmed = subscriptionId.trim();
  if (!trimmed) return undefined;
  return core
    .prepare(
      `SELECT * FROM saas_subscriptions WHERE stripe_subscription_id=? LIMIT 1`
    )
    .get(trimmed) as SaasSubscription | undefined;
}

export function findSubscriptionBySessionId(
  core: CoreDatabase,
  sessionId: string
): SaasSubscription | undefined {
  const trimmed = sessionId.trim();
  if (!trimmed) return undefined;
  return core
    .prepare(
      `SELECT * FROM saas_subscriptions WHERE stripe_session_id=? LIMIT 1`
    )
    .get(trimmed) as SaasSubscription | undefined;
}

export function upsertSubscriptionFromCheckout(opts: {
  stripeSessionId: string;
  email?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planId?: string | null;
  priceId?: string | null;
  status?: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}): SaasSubscription {
  const core = getCoreDb();
  const existing =
    (opts.stripeSubscriptionId
      ? findSubscriptionByStripeSubscriptionId(core, opts.stripeSubscriptionId)
      : undefined) ?? findSubscriptionBySessionId(core, opts.stripeSessionId);

  const email = opts.email?.trim().toLowerCase() || null;
  const status = (opts.status ?? "active").trim() || "active";
  const cancelAt = opts.cancelAtPeriodEnd ? 1 : 0;
  const accessRevoked = TERMINAL_STATUSES.has(status) && !periodStillActive(opts.currentPeriodEnd ?? null) ? 1 : 0;

  if (existing) {
    core
      .prepare(
        `UPDATE saas_subscriptions SET
          email=COALESCE(?, email),
          stripe_customer_id=COALESCE(?, stripe_customer_id),
          stripe_subscription_id=COALESCE(?, stripe_subscription_id),
          stripe_session_id=COALESCE(?, stripe_session_id),
          plan_id=COALESCE(?, plan_id),
          price_id=COALESCE(?, price_id),
          status=?,
          current_period_end=COALESCE(?, current_period_end),
          cancel_at_period_end=?,
          access_revoked=CASE WHEN ?=1 THEN 1 ELSE access_revoked END,
          updated_at=datetime('now')
         WHERE id=?`
      )
      .run(
        email,
        opts.stripeCustomerId ?? null,
        opts.stripeSubscriptionId ?? null,
        opts.stripeSessionId,
        opts.planId ?? null,
        opts.priceId ?? null,
        status,
        opts.currentPeriodEnd ?? null,
        cancelAt,
        accessRevoked,
        existing.id
      );
    return findSubscriptionBySessionId(core, opts.stripeSessionId) ??
      findSubscriptionByStripeSubscriptionId(core, opts.stripeSubscriptionId ?? "")!;
  }

  const id = randomUUID();
  core
    .prepare(
      `INSERT INTO saas_subscriptions (
        id, email, stripe_customer_id, stripe_subscription_id, stripe_session_id,
        plan_id, price_id, status, current_period_end, cancel_at_period_end, access_revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      email,
      opts.stripeCustomerId ?? null,
      opts.stripeSubscriptionId ?? null,
      opts.stripeSessionId,
      opts.planId ?? null,
      opts.priceId ?? null,
      status,
      opts.currentPeriodEnd ?? null,
      cancelAt,
      accessRevoked
    );

  return core
    .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
    .get(id) as SaasSubscription;
}

export function applyStripeSubscriptionObject(sub: {
  id?: string;
  customer?: string | { id?: string } | null;
  status?: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  items?: { data?: Array<{ price?: { id?: string } }> };
  metadata?: { godmode_plan?: string; godmode_saas?: string };
}): SaasSubscription | null {
  const core = getCoreDb();
  const subscriptionId = typeof sub.id === "string" ? sub.id : "";
  if (!subscriptionId) return null;

  const customerId =
    typeof sub.customer === "string"
      ? sub.customer
      : sub.customer && typeof sub.customer === "object"
        ? sub.customer.id ?? null
        : null;
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const planId =
    sub.metadata?.godmode_plan ??
    planMeta(priceId).id ??
    null;
  const status = (sub.status ?? "active").trim() || "active";
  const periodEnd = isoFromUnix(sub.current_period_end);
  const cancelAt = Boolean(sub.cancel_at_period_end);
  const shouldRevoke =
    TERMINAL_STATUSES.has(status) && !periodStillActive(periodEnd);

  const existing =
    findSubscriptionByStripeSubscriptionId(core, subscriptionId) ??
    (customerId ? findSubscriptionByCustomerId(core, customerId) : undefined);

  if (existing) {
    core
      .prepare(
        `UPDATE saas_subscriptions SET
          stripe_customer_id=COALESCE(?, stripe_customer_id),
          stripe_subscription_id=?,
          plan_id=COALESCE(?, plan_id),
          price_id=COALESCE(?, price_id),
          status=?,
          current_period_end=?,
          cancel_at_period_end=?,
          access_revoked=CASE WHEN ? THEN 1 ELSE 0 END,
          updated_at=datetime('now')
         WHERE id=?`
      )
      .run(
        customerId,
        subscriptionId,
        planId,
        priceId,
        status,
        periodEnd,
        cancelAt ? 1 : 0,
        shouldRevoke ? 1 : 0,
        existing.id
      );
    return findSubscriptionByStripeSubscriptionId(core, subscriptionId)!;
  }

  const id = randomUUID();
  core
    .prepare(
      `INSERT INTO saas_subscriptions (
        id, stripe_customer_id, stripe_subscription_id, plan_id, price_id,
        status, current_period_end, cancel_at_period_end, access_revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      customerId,
      subscriptionId,
      planId,
      priceId,
      status,
      periodEnd,
      cancelAt ? 1 : 0,
      shouldRevoke ? 1 : 0
    );
  return core
    .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
    .get(id) as SaasSubscription;
}

export function markSubscriptionPastDueByCustomer(
  customerId: string
): SaasSubscription | null {
  const core = getCoreDb();
  const existing = findSubscriptionByCustomerId(core, customerId);
  if (!existing) return null;
  core
    .prepare(
      `UPDATE saas_subscriptions
       SET status='past_due', updated_at=datetime('now')
       WHERE id=?`
    )
    .run(existing.id);
  return findSubscriptionByCustomerId(core, customerId) ?? null;
}

/** Link a consumed entitlement / checkout to the newly created user. */
export function linkSubscriptionToUser(opts: {
  userId: string;
  stripeSessionId?: string | null;
  stripeCustomerId?: string | null;
  email?: string | null;
}): SaasSubscription | null {
  const core = getCoreDb();
  const bySession = opts.stripeSessionId
    ? findSubscriptionBySessionId(core, opts.stripeSessionId)
    : undefined;
  const byCustomer =
    !bySession && opts.stripeCustomerId
      ? findSubscriptionByCustomerId(core, opts.stripeCustomerId)
      : undefined;
  const row = bySession ?? byCustomer;
  if (!row) return null;
  core
    .prepare(
      `UPDATE saas_subscriptions
       SET user_id=?, email=COALESCE(?, email), updated_at=datetime('now')
       WHERE id=?`
    )
    .run(opts.userId, opts.email?.trim().toLowerCase() || null, row.id);
  return findSubscriptionByUserId(core, opts.userId) ?? null;
}

export function subscriptionGrantsAccess(sub: SaasSubscription | undefined): boolean {
  if (!sub) return false;
  if (sub.access_revoked) return false;
  if (ALLOWED_STATUSES.has(sub.status)) return true;
  if (sub.status === "canceled" && periodStillActive(sub.current_period_end)) {
    return true;
  }
  return false;
}

/**
 * SaaS login/session gate. Platform admins are exempt.
 * Users with a consumed entitlement but no subscription row yet are allowed
 * (checkout just completed; webhook may still be catching up).
 */
export function assertSaasUserMayAccess(user: CoreUser): {
  ok: true;
} | { ok: false; error: string; status: number } {
  if (!config.isSaas) return { ok: true };
  if (user.is_admin) return { ok: true };
  if (user.access_disabled) {
    return {
      ok: false,
      error: "Your account has been disabled. Contact support.",
      status: 403,
    };
  }

  const core = getCoreDb();
  const sub = findSubscriptionByUserId(core, user.id);
  if (subscriptionGrantsAccess(sub)) return { ok: true };

  const entitlement = core
    .prepare(
      `SELECT id FROM saas_entitlements
       WHERE consumed_by_user_id=? AND status='consumed'
       LIMIT 1`
    )
    .get(user.id) as { id: string } | undefined;

  if (!sub && entitlement) return { ok: true };

  return {
    ok: false,
    error: "Your subscription is inactive. Renew to continue using GodMode Cloud.",
    status: 403,
  };
}

export function touchUserLastSeen(userId: string): void {
  getCoreDb()
    .prepare(
      `UPDATE users SET last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    )
    .run(userId);
}

export function setUserAccessDisabled(
  userId: string,
  disabled: boolean
): CoreUser | undefined {
  const core = getCoreDb();
  core
    .prepare(
      `UPDATE users SET access_disabled=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(disabled ? 1 : 0, userId);
  if (disabled) {
    const sub = findSubscriptionByUserId(core, userId);
    if (sub) {
      core
        .prepare(
          `UPDATE saas_subscriptions
           SET access_revoked=1, updated_at=datetime('now')
           WHERE id=?`
        )
        .run(sub.id);
    }
  }
  return core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as
    | CoreUser
    | undefined;
}

export function revokeAccessForSubscription(sub: SaasSubscription): void {
  const core = getCoreDb();
  core
    .prepare(
      `UPDATE saas_subscriptions
       SET access_revoked=1, status=CASE WHEN status='active' THEN 'canceled' ELSE status END,
           updated_at=datetime('now')
       WHERE id=?`
    )
    .run(sub.id);
}

export type SaasCustomerAdminRow = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  isAdmin: boolean;
  accessDisabled: boolean;
  lastSeenAt: string | null;
  planId: string | null;
  priceId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  accessRevoked: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeDashboardUrl: string | null;
  createdAt: string | null;
};

function stripeDashboardCustomerUrl(customerId: string | null): string | null {
  if (!customerId) return null;
  const test =
    (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_") ||
    (process.env.STRIPE_SECRET_KEY ?? "").includes("_test_");
  return test
    ? `https://dashboard.stripe.com/test/customers/${customerId}`
    : `https://dashboard.stripe.com/customers/${customerId}`;
}

export function listSaasCustomersForAdmin(): SaasCustomerAdminRow[] {
  const core = getCoreDb();
  const fromSubs = core
    .prepare(
      `SELECT
         u.id AS user_id,
         COALESCE(u.email, s.email) AS email,
         u.display_name AS display_name,
         COALESCE(u.is_admin, 0) AS is_admin,
         COALESCE(u.access_disabled, 0) AS access_disabled,
         u.last_seen_at AS last_seen_at,
         t.id AS tenant_id,
         t.name AS tenant_name,
         s.plan_id AS plan_id,
         s.price_id AS price_id,
         s.status AS status,
         s.current_period_end AS current_period_end,
         s.cancel_at_period_end AS cancel_at_period_end,
         s.access_revoked AS access_revoked,
         s.stripe_customer_id AS stripe_customer_id,
         s.stripe_subscription_id AS stripe_subscription_id,
         s.stripe_session_id AS stripe_session_id,
         s.created_at AS created_at
       FROM saas_subscriptions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN tenants t ON t.owner_user_id = u.id
       ORDER BY datetime(s.updated_at) DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const seenCustomers = new Set(
    fromSubs
      .map((r) =>
        typeof r.stripe_customer_id === "string" ? r.stripe_customer_id : ""
      )
      .filter(Boolean)
  );
  const seenSessions = new Set(
    fromSubs
      .map((r) => (typeof r.stripe_session_id === "string" ? r.stripe_session_id : ""))
      .filter(Boolean)
  );

  const fromEntitlements = core
    .prepare(
      `SELECT
         u.id AS user_id,
         COALESCE(u.email, e.email) AS email,
         u.display_name AS display_name,
         COALESCE(u.is_admin, 0) AS is_admin,
         COALESCE(u.access_disabled, 0) AS access_disabled,
         u.last_seen_at AS last_seen_at,
         t.id AS tenant_id,
         t.name AS tenant_name,
         e.status AS status,
         e.stripe_customer_id AS stripe_customer_id,
         e.stripe_session_id AS stripe_session_id,
         e.created_at AS created_at,
         CASE WHEN e.status='revoked' THEN 1 ELSE 0 END AS access_revoked
       FROM saas_entitlements e
       LEFT JOIN users u ON u.id = e.consumed_by_user_id
       LEFT JOIN tenants t ON t.owner_user_id = u.id
       ORDER BY datetime(e.created_at) DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const rows: Array<Record<string, unknown>> = [...fromSubs];
  for (const e of fromEntitlements) {
    const customer =
      typeof e.stripe_customer_id === "string" ? e.stripe_customer_id : "";
    const session =
      typeof e.stripe_session_id === "string" ? e.stripe_session_id : "";
    if (customer && seenCustomers.has(customer)) continue;
    if (session && seenSessions.has(session)) continue;
    rows.push({
      ...e,
      plan_id: null,
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: 0,
      stripe_subscription_id: null,
    });
  }

  return rows.map((r) => ({
    userId: typeof r.user_id === "string" ? r.user_id : null,
    email: typeof r.email === "string" ? r.email : null,
    displayName: typeof r.display_name === "string" ? r.display_name : null,
    tenantId: typeof r.tenant_id === "string" ? r.tenant_id : null,
    tenantName: typeof r.tenant_name === "string" ? r.tenant_name : null,
    isAdmin: Boolean(r.is_admin),
    accessDisabled: Boolean(r.access_disabled),
    lastSeenAt: typeof r.last_seen_at === "string" ? r.last_seen_at : null,
    planId: typeof r.plan_id === "string" ? r.plan_id : null,
    priceId: typeof r.price_id === "string" ? r.price_id : null,
    status: typeof r.status === "string" ? r.status : null,
    currentPeriodEnd:
      typeof r.current_period_end === "string" ? r.current_period_end : null,
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
    accessRevoked: Boolean(r.access_revoked),
    stripeCustomerId:
      typeof r.stripe_customer_id === "string" ? r.stripe_customer_id : null,
    stripeSubscriptionId:
      typeof r.stripe_subscription_id === "string"
        ? r.stripe_subscription_id
        : null,
    stripeDashboardUrl: stripeDashboardCustomerUrl(
      typeof r.stripe_customer_id === "string" ? r.stripe_customer_id : null
    ),
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
  }));
}

export function getPublicSubscriptionForUser(userId: string): {
  planId: string | null;
  planLabel: string | null;
  amountLabel: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
} | null {
  const sub = findSubscriptionByUserId(getCoreDb(), userId);
  if (!sub) {
    const entitlement = getCoreDb()
      .prepare(
        `SELECT stripe_customer_id FROM saas_entitlements
         WHERE consumed_by_user_id=? AND status='consumed' LIMIT 1`
      )
      .get(userId) as { stripe_customer_id: string | null } | undefined;
    if (!entitlement) return null;
    return {
      planId: null,
      planLabel: "GodMode Cloud",
      amountLabel: null,
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      hasCustomer: Boolean(entitlement.stripe_customer_id),
    };
  }
  const plan = planMeta(sub.plan_id ?? sub.price_id);
  return {
    planId: sub.plan_id,
    planLabel: plan.label ?? sub.plan_id ?? "GodMode Cloud",
    amountLabel: plan.amountLabel,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    hasCustomer: Boolean(sub.stripe_customer_id),
  };
}
