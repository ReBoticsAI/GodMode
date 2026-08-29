import { randomUUID } from "node:crypto";
import type { CoreDatabase, CoreUser } from "../core-db.js";
import { getCloudDb } from "../core-db.js";
import { config } from "../config.js";
import {
  getSellerPayoutSnapshot,
  hasAcceptedMarketplaceTos,
} from "./marketplace-commerce.js";
import { githubProjectsStatus } from "./github-integration.js";
import { getUserDb } from "../user-registry.js";

/** Admin-granted Cloud access without Stripe. Distinct from platform admin (`is_admin`). */
export const COMPLIMENTARY_PLAN_ID = "complimentary";

/** Commerce-only Marketplace Seller seat. Does not grant full Cloud workspace access. */
export const SELLER_PLAN_ID = "seller";

const WORKSPACE_PLAN_IDS = new Set([
  "monthly",
  "yearly",
  "default",
  COMPLIMENTARY_PLAN_ID,
]);

export function isSellerPlanId(planId: string | null | undefined): boolean {
  return (planId ?? "").trim() === SELLER_PLAN_ID;
}

/** Workspace Cloud plans (and legacy null plan_id). Seller-only is excluded. */
export function isWorkspacePlanId(planId: string | null | undefined): boolean {
  const key = (planId ?? "").trim();
  if (!key) return true;
  if (isSellerPlanId(key)) return false;
  if (WORKSPACE_PLAN_IDS.has(key)) return true;
  const configured = config.saas.plans.find((p) => p.id === key || p.priceId === key);
  if (configured) return configured.id !== SELLER_PLAN_ID;
  return true;
}

function planMeta(planIdOrPriceId: string | null | undefined): {
  id: string | null;
  label: string | null;
  amountLabel: string | null;
} {
  const key = (planIdOrPriceId ?? "").trim();
  if (!key) return { id: null, label: null, amountLabel: null };
  if (key === COMPLIMENTARY_PLAN_ID) {
    return {
      id: COMPLIMENTARY_PLAN_ID,
      label: "Complimentary",
      amountLabel: "Free",
    };
  }
  if (key === SELLER_PLAN_ID) {
    const sellerPlan = config.saas.plans.find((p) => p.id === SELLER_PLAN_ID);
    return {
      id: SELLER_PLAN_ID,
      label: sellerPlan?.label ?? "Seller",
      amountLabel: sellerPlan?.amountLabel ?? null,
    };
  }
  const plan = config.saas.plans.find((p) => p.id === key || p.priceId === key);
  return plan
    ? { id: plan.id, label: plan.label, amountLabel: plan.amountLabel }
    : { id: key, label: key, amountLabel: null };
}

export function isComplimentarySubscription(
  sub: SaasSubscription | undefined
): boolean {
  if (!sub) return false;
  return (
    sub.plan_id === COMPLIMENTARY_PLAN_ID && !sub.stripe_subscription_id
  );
}

/** Admin-granted Seller seat without Stripe. Does not grant full Cloud workspace. */
export function isComplimentarySellerSubscription(
  sub: SaasSubscription | undefined
): boolean {
  if (!sub) return false;
  return isSellerPlanId(sub.plan_id) && !sub.stripe_subscription_id;
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
  /** ISO or SQLite datetime when status first became past_due; null when not past_due. */
  past_due_since: string | null;
  created_at: string;
  updated_at: string;
}

const TERMINAL_STATUSES = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

const ALLOWED_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Days of Cloud access after first past_due before access_revoked. */
export function pastDueGraceDays(): number {
  const n = Number(process.env.SAAS_PAST_DUE_GRACE_DAYS ?? "7");
  if (!Number.isFinite(n) || n < 0) return 7;
  return Math.floor(n);
}

function parseDbDatetimeMs(value: string | null | undefined): number | null {
  if (!value || !value.trim()) return null;
  const raw = value.trim();
  const asIso =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw) &&
    !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  const t = Date.parse(asIso);
  return Number.isFinite(t) ? t : null;
}

export function graceEndsAtIso(pastDueSince: string | null | undefined): string | null {
  const start = parseDbDatetimeMs(pastDueSince);
  if (start === null) return null;
  return new Date(start + pastDueGraceDays() * 24 * 60 * 60 * 1000).toISOString();
}

export function graceDaysRemaining(pastDueSince: string | null | undefined): number | null {
  const ends = graceEndsAtIso(pastDueSince);
  if (!ends) return null;
  const remainingMs = Date.parse(ends) - Date.now();
  if (!Number.isFinite(remainingMs)) return null;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

function pastDueGraceExpired(pastDueSince: string | null | undefined): boolean {
  const ends = graceEndsAtIso(pastDueSince);
  if (!ends) return false;
  return Date.parse(ends) <= Date.now();
}

/**
 * For past_due rows: backfill past_due_since once, then revoke after grace.
 * Returns the (possibly updated) subscription row used for access checks.
 */
export function enforcePastDueGrace(sub: SaasSubscription): SaasSubscription {
  if (sub.status !== "past_due" || sub.access_revoked) return sub;
  const core = getCloudDb();
  if (!sub.past_due_since) {
    core
      .prepare(
        `UPDATE saas_subscriptions
         SET past_due_since=datetime('now'), updated_at=datetime('now')
         WHERE id=? AND past_due_since IS NULL`
      )
      .run(sub.id);
    const refreshed = core
      .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
      .get(sub.id) as SaasSubscription | undefined;
    if (!refreshed) return sub;
    sub = refreshed;
  }
  if (!pastDueGraceExpired(sub.past_due_since)) return sub;
  core
    .prepare(
      `UPDATE saas_subscriptions
       SET access_revoked=1, updated_at=datetime('now')
       WHERE id=?`
    )
    .run(sub.id);
  return {
    ...sub,
    access_revoked: 1,
  };
}

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

function statusClearsPastDueClock(status: string): boolean {
  return status === "active" || status === "trialing";
}

export function findSubscriptionByUserId(
  core: CoreDatabase,
  userId: string
): SaasSubscription | undefined {
  const rows = core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE user_id=?
       ORDER BY datetime(updated_at) DESC`
    )
    .all(userId) as SaasSubscription[];
  if (rows.length === 0) return undefined;
  return rows.find((row) => subscriptionGrantsAccess(row)) ?? rows[0];
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
  const core = getCloudDb();
  const existing =
    (opts.stripeSubscriptionId
      ? findSubscriptionByStripeSubscriptionId(core, opts.stripeSubscriptionId)
      : undefined) ?? findSubscriptionBySessionId(core, opts.stripeSessionId);

  const email = opts.email?.trim().toLowerCase() || null;
  const status = (opts.status ?? "active").trim() || "active";
  const cancelAt = opts.cancelAtPeriodEnd ? 1 : 0;
  const accessRevoked = TERMINAL_STATUSES.has(status) && !periodStillActive(opts.currentPeriodEnd ?? null) ? 1 : 0;

  if (existing) {
    const clearPastDue = statusClearsPastDueClock(status);
    const setPastDue = status === "past_due";
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
          access_revoked=CASE
            WHEN ?=1 THEN 1
            WHEN ?=1 THEN 0
            ELSE access_revoked
          END,
          past_due_since=CASE
            WHEN ?=1 THEN NULL
            WHEN ?=1 THEN COALESCE(past_due_since, datetime('now'))
            ELSE past_due_since
          END,
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
        clearPastDue ? 1 : 0,
        clearPastDue ? 1 : 0,
        setPastDue ? 1 : 0,
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
        plan_id, price_id, status, current_period_end, cancel_at_period_end, access_revoked,
        past_due_since
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      accessRevoked,
      status === "past_due" ? new Date().toISOString() : null
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
  const core = getCloudDb();
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
    const clearPastDue = statusClearsPastDueClock(status);
    const setPastDue = status === "past_due";
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
          past_due_since=CASE
            WHEN ?=1 THEN NULL
            WHEN ?=1 THEN COALESCE(past_due_since, datetime('now'))
            ELSE past_due_since
          END,
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
        clearPastDue ? 1 : 0,
        setPastDue ? 1 : 0,
        existing.id
      );
    return findSubscriptionByStripeSubscriptionId(core, subscriptionId)!;
  }

  const id = randomUUID();
  core
    .prepare(
      `INSERT INTO saas_subscriptions (
        id, stripe_customer_id, stripe_subscription_id, plan_id, price_id,
        status, current_period_end, cancel_at_period_end, access_revoked, past_due_since
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      shouldRevoke ? 1 : 0,
      status === "past_due" ? new Date().toISOString() : null
    );
  return core
    .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
    .get(id) as SaasSubscription;
}

export function markSubscriptionPastDueByCustomer(
  customerId: string
): SaasSubscription | null {
  const core = getCloudDb();
  const existing = findSubscriptionByCustomerId(core, customerId);
  if (!existing) return null;
  core
    .prepare(
      `UPDATE saas_subscriptions
       SET status='past_due',
           past_due_since=COALESCE(past_due_since, datetime('now')),
           updated_at=datetime('now')
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
  const core = getCloudDb();
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

function subscriptionStatusGrantsCommerce(
  sub: SaasSubscription | undefined
): boolean {
  if (!sub) return false;
  const enforced = enforcePastDueGrace(sub);
  if (enforced.access_revoked) return false;
  if (ALLOWED_STATUSES.has(enforced.status)) {
    if (
      (isComplimentarySubscription(enforced) ||
        isComplimentarySellerSubscription(enforced)) &&
      enforced.current_period_end &&
      !periodStillActive(enforced.current_period_end)
    ) {
      return false;
    }
    return true;
  }
  if (
    enforced.status === "canceled" &&
    periodStillActive(enforced.current_period_end)
  ) {
    return true;
  }
  return false;
}

/** Full GodMode Cloud workspace access (Structure, agents, chat, …). Not Seller-only. */
export function subscriptionGrantsAccess(sub: SaasSubscription | undefined): boolean {
  if (!subscriptionStatusGrantsCommerce(sub)) return false;
  return isWorkspacePlanId(sub!.plan_id);
}

/**
 * Marketplace seller commerce (ToS / Connect / publish on Cloud).
 * True for an active Seller seat or an active full workspace subscription.
 */
export function subscriptionGrantsSellerCommerce(
  sub: SaasSubscription | undefined
): boolean {
  if (!subscriptionStatusGrantsCommerce(sub)) return false;
  if (isSellerPlanId(sub!.plan_id)) return true;
  return isWorkspacePlanId(sub!.plan_id);
}

export type SellerEntitlementSource = "seller" | "workspace" | null;

export type SellerEntitlement = {
  sellerActive: boolean;
  planId: string | null;
  source: SellerEntitlementSource;
};

export type SellerCommerceReadiness = {
  githubConnected: boolean;
  /** GitHub login on the Seller Cloud user (for Local claim/publish). */
  githubLogin: string | null;
  tosAccepted: boolean;
  stripePayoutReady: boolean;
};

export type SellerEntitlementPayload = SellerEntitlement & SellerCommerceReadiness;

function listSubscriptionsForUser(
  core: CoreDatabase,
  userId: string
): SaasSubscription[] {
  return core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE user_id=?
       ORDER BY datetime(updated_at) DESC`
    )
    .all(userId) as SaasSubscription[];
}

/** GitHub / ToS / Stripe Connect readiness for Local Sell checklist (#681). */
export function getSellerCommerceReadiness(userId: string): SellerCommerceReadiness {
  const core = getCloudDb();
  const payout = getSellerPayoutSnapshot(core, userId);
  const github = githubProjectsStatus(getUserDb(userId), userId);
  const githubLogin = String(github.login ?? "").trim() || null;
  return {
    githubConnected: Boolean(github.connected) || Boolean(githubLogin),
    githubLogin,
    tosAccepted: hasAcceptedMarketplaceTos(core, userId),
    stripePayoutReady: Boolean(payout.stripeConnectAccountId),
  };
}

/** Entitlement plus commerce readiness for Local / Cloud seller gates. */
export function getSellerEntitlementPayload(userId: string): SellerEntitlementPayload {
  return {
    ...getSellerEntitlementForUser(userId),
    ...getSellerCommerceReadiness(userId),
  };
}

/** Resolve seller commerce entitlement for a Cloud user (Seller seat or workspace). */
export function getSellerEntitlementForUser(userId: string): SellerEntitlement {
  const core = getCloudDb();
  const rows = listSubscriptionsForUser(core, userId);
  const sellerRow = rows.find(
    (row) => isSellerPlanId(row.plan_id) && subscriptionGrantsSellerCommerce(row)
  );
  if (sellerRow) {
    return {
      sellerActive: true,
      planId: sellerRow.plan_id,
      source: "seller",
    };
  }
  const workspaceRow = rows.find((row) => subscriptionGrantsAccess(row));
  if (workspaceRow) {
    return {
      sellerActive: true,
      planId: workspaceRow.plan_id,
      source: "workspace",
    };
  }
  return { sellerActive: false, planId: null, source: null };
}

/**
 * Seller seat is commerce-only. Workspace Cloud already includes Seller, so do not
 * start a second Seller subscription for that email. Also reject when Seller is
 * already active on its own seat.
 */
export function assertMayStartSellerCheckout(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const core = getCloudDb();
  const user = core
    .prepare(`SELECT id FROM users WHERE lower(email)=? LIMIT 1`)
    .get(normalized) as { id: string } | undefined;
  if (!user) return;
  const entitlement = getSellerEntitlementForUser(user.id);
  if (entitlement.source === "workspace") {
    throw Object.assign(
      new Error(
        "GodMode Cloud workspace already includes Seller. A separate Seller seat is not needed."
      ),
      { status: 409 }
    );
  }
  if (entitlement.source === "seller" && entitlement.sellerActive) {
    throw Object.assign(
      new Error("Seller seat is already active for this account."),
      { status: 409 }
    );
  }
}

/**
 * Grant complimentary GodMode Cloud access (no Stripe).
 * Restores a prior complimentary row when present; otherwise inserts one.
 * Does not change `is_admin`. Optional `expiresAt` uses `current_period_end`.
 */
export function grantComplimentaryAccess(
  userId: string,
  opts?: { expiresAt?: string | null }
): SaasSubscription {
  const core = getCloudDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as
    | CoreUser
    | undefined;
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const expiresAt =
    typeof opts?.expiresAt === "string" && opts.expiresAt.trim()
      ? opts.expiresAt.trim()
      : null;
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (!Number.isFinite(t)) {
      throw Object.assign(new Error("expiresAt must be a valid ISO date"), {
        status: 400,
      });
    }
  }

  const rows = core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE user_id=?
       ORDER BY datetime(updated_at) DESC`
    )
    .all(userId) as SaasSubscription[];
  const complimentary = rows.find((r) => isComplimentarySubscription(r));
  if (complimentary) {
    core
      .prepare(
        `UPDATE saas_subscriptions SET
          plan_id=?,
          status='active',
          access_revoked=0,
          current_period_end=?,
          cancel_at_period_end=0,
          email=COALESCE(?, email),
          updated_at=datetime('now')
         WHERE id=?`
      )
      .run(
        COMPLIMENTARY_PLAN_ID,
        expiresAt,
        user.email,
        complimentary.id
      );
    return core
      .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
      .get(complimentary.id) as SaasSubscription;
  }

  const id = randomUUID();
  core
    .prepare(
      `INSERT INTO saas_subscriptions (
        id, user_id, email, plan_id, status, current_period_end,
        cancel_at_period_end, access_revoked
      ) VALUES (?, ?, ?, ?, 'active', ?, 0, 0)`
    )
    .run(id, userId, user.email, COMPLIMENTARY_PLAN_ID, expiresAt);
  return core
    .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
    .get(id) as SaasSubscription;
}

/**
 * Grant complimentary GodMode Seller access (no Stripe).
 * Commerce-only: Local Sell / seller-link surfaces, not full Cloud workspace.
 */
export function grantComplimentarySellerAccess(
  userId: string,
  opts?: { expiresAt?: string | null }
): SaasSubscription {
  const core = getCloudDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as
    | CoreUser
    | undefined;
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const expiresAt =
    typeof opts?.expiresAt === "string" && opts.expiresAt.trim()
      ? opts.expiresAt.trim()
      : null;
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (!Number.isFinite(t)) {
      throw Object.assign(new Error("expiresAt must be a valid ISO date"), {
        status: 400,
      });
    }
  }

  const rows = core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE user_id=?
       ORDER BY datetime(updated_at) DESC`
    )
    .all(userId) as SaasSubscription[];
  const complimentary = rows.find((r) => isComplimentarySellerSubscription(r));
  if (complimentary) {
    core
      .prepare(
        `UPDATE saas_subscriptions SET
          plan_id=?,
          status='active',
          access_revoked=0,
          current_period_end=?,
          cancel_at_period_end=0,
          email=COALESCE(?, email),
          updated_at=datetime('now')
         WHERE id=?`
      )
      .run(SELLER_PLAN_ID, expiresAt, user.email, complimentary.id);
    return core
      .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
      .get(complimentary.id) as SaasSubscription;
  }

  const id = randomUUID();
  core
    .prepare(
      `INSERT INTO saas_subscriptions (
        id, user_id, email, plan_id, status, current_period_end,
        cancel_at_period_end, access_revoked
      ) VALUES (?, ?, ?, ?, 'active', ?, 0, 0)`
    )
    .run(id, userId, user.email, SELLER_PLAN_ID, expiresAt);
  return core
    .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
    .get(id) as SaasSubscription;
}

/**
 * Revoke complimentary Cloud access so the user must subscribe again.
 * Login then fails `assertSaasUserMayAccess` with the inactive-subscription
 * message (client should show that error and point them at signup/billing).
 * Paid Stripe rows are left alone; use Disable access for those.
 */
export function revokeComplimentaryAccess(userId: string): SaasSubscription {
  const core = getCloudDb();
  const user = core.prepare(`SELECT id FROM users WHERE id=?`).get(userId) as
    | { id: string }
    | undefined;
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const rows = core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE user_id=?
       ORDER BY datetime(updated_at) DESC`
    )
    .all(userId) as SaasSubscription[];
  const complimentary = rows.find((r) => isComplimentarySubscription(r));
  if (!complimentary) {
    throw Object.assign(
      new Error("User has no complimentary Cloud access to revoke"),
      { status: 400 }
    );
  }

  core
    .prepare(
      `UPDATE saas_subscriptions
       SET access_revoked=1, status='canceled', updated_at=datetime('now')
       WHERE id=?`
    )
    .run(complimentary.id);
  return core
    .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
    .get(complimentary.id) as SaasSubscription;
}

/**
 * Revoke complimentary Seller access (admin-granted seat without Stripe).
 */
export function revokeComplimentarySellerAccess(userId: string): SaasSubscription {
  const core = getCloudDb();
  const user = core.prepare(`SELECT id FROM users WHERE id=?`).get(userId) as
    | { id: string }
    | undefined;
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const rows = core
    .prepare(
      `SELECT * FROM saas_subscriptions
       WHERE user_id=?
       ORDER BY datetime(updated_at) DESC`
    )
    .all(userId) as SaasSubscription[];
  const complimentary = rows.find((r) => isComplimentarySellerSubscription(r));
  if (!complimentary) {
    throw Object.assign(
      new Error("User has no complimentary Seller access to revoke"),
      { status: 400 }
    );
  }

  core
    .prepare(
      `UPDATE saas_subscriptions
       SET access_revoked=1, status='canceled', updated_at=datetime('now')
       WHERE id=?`
    )
    .run(complimentary.id);
  return core
    .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
    .get(complimentary.id) as SaasSubscription;
}

export function userHasActiveComplimentaryAccess(userId: string): boolean {
  const rows = listSubscriptionsForUser(getCloudDb(), userId);
  return rows.some(
    (sub) => isComplimentarySubscription(sub) && subscriptionGrantsAccess(sub)
  );
}

export function userHasActiveComplimentarySellerAccess(userId: string): boolean {
  const rows = listSubscriptionsForUser(getCloudDb(), userId);
  return rows.some(
    (sub) =>
      isComplimentarySellerSubscription(sub) &&
      subscriptionGrantsSellerCommerce(sub)
  );
}

export function userHasActiveSellerCommerceAccess(userId: string): boolean {
  const rows = listSubscriptionsForUser(getCloudDb(), userId);
  return rows.some((sub) => subscriptionGrantsSellerCommerce(sub));
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

  const core = getCloudDb();
  const rows = listSubscriptionsForUser(core, user.id);
  if (rows.some((row) => subscriptionGrantsAccess(row))) return { ok: true };
  if (rows.some((row) => subscriptionGrantsSellerCommerce(row))) {
    return { ok: true };
  }

  const entitlement = core
    .prepare(
      `SELECT id FROM saas_entitlements
       WHERE consumed_by_user_id=? AND status='consumed'
       LIMIT 1`
    )
    .get(user.id) as { id: string } | undefined;

  if (rows.length === 0 && entitlement) return { ok: true };

  return {
    ok: false,
    error: "Your subscription is inactive. Renew to continue using GodMode Cloud.",
    status: 403,
  };
}

export function touchUserLastSeen(userId: string): void {
  getCloudDb()
    .prepare(
      `UPDATE users SET last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    )
    .run(userId);
}

export function setUserAccessDisabled(
  userId: string,
  disabled: boolean
): CoreUser | undefined {
  const core = getCloudDb();
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
  const core = getCloudDb();
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
  planLabel: string | null;
  amountLabel: string | null;
  priceId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  accessRevoked: boolean;
  complimentaryAccess: boolean;
  complimentarySellerAccess: boolean;
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
  const core = getCloudDb();
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

  return rows.map((r) => {
    const planId = typeof r.plan_id === "string" ? r.plan_id : null;
    const priceId = typeof r.price_id === "string" ? r.price_id : null;
    const meta = planMeta(planId ?? priceId);
    const stripeSubscriptionId =
      typeof r.stripe_subscription_id === "string"
        ? r.stripe_subscription_id
        : null;
    const accessRevoked = Boolean(r.access_revoked);
    const status = typeof r.status === "string" ? r.status : null;
    const complimentaryAccess =
      planId === COMPLIMENTARY_PLAN_ID &&
      !stripeSubscriptionId &&
      !accessRevoked &&
      (status === null || ALLOWED_STATUSES.has(status));
    const complimentarySellerAccess =
      planId === SELLER_PLAN_ID &&
      !stripeSubscriptionId &&
      !accessRevoked &&
      (status === null || ALLOWED_STATUSES.has(status));
    const planLabel =
      complimentarySellerAccess && meta.id === SELLER_PLAN_ID
        ? "Complimentary Seller"
        : meta.label;
    return {
    userId: typeof r.user_id === "string" ? r.user_id : null,
    email: typeof r.email === "string" ? r.email : null,
    displayName: typeof r.display_name === "string" ? r.display_name : null,
    tenantId: typeof r.tenant_id === "string" ? r.tenant_id : null,
    tenantName: typeof r.tenant_name === "string" ? r.tenant_name : null,
    isAdmin: Boolean(r.is_admin),
    accessDisabled: Boolean(r.access_disabled),
    lastSeenAt: typeof r.last_seen_at === "string" ? r.last_seen_at : null,
    planId: meta.id ?? planId,
    planLabel,
    amountLabel: meta.amountLabel,
    priceId,
    status,
    currentPeriodEnd:
      typeof r.current_period_end === "string" ? r.current_period_end : null,
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
    accessRevoked,
    complimentaryAccess,
    complimentarySellerAccess,
    stripeCustomerId:
      typeof r.stripe_customer_id === "string" ? r.stripe_customer_id : null,
    stripeSubscriptionId,
    stripeDashboardUrl: stripeDashboardCustomerUrl(
      typeof r.stripe_customer_id === "string" ? r.stripe_customer_id : null
    ),
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
  };
  });
}

export function getPublicSubscriptionForUser(userId: string): {
  planId: string | null;
  planLabel: string | null;
  amountLabel: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  accessRevoked: boolean;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  graceDaysRemaining: number | null;
} | null {
  const raw = findSubscriptionByUserId(getCloudDb(), userId);
  if (!raw) {
    const entitlement = getCloudDb()
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
      accessRevoked: false,
      pastDueSince: null,
      graceEndsAt: null,
      graceDaysRemaining: null,
    };
  }
  const sub = enforcePastDueGrace(raw);
  const plan = planMeta(sub.plan_id ?? sub.price_id);
  const pastDueSince = sub.status === "past_due" ? sub.past_due_since : null;
  return {
    planId: sub.plan_id,
    planLabel: plan.label ?? sub.plan_id ?? "GodMode Cloud",
    amountLabel: plan.amountLabel,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    hasCustomer: Boolean(sub.stripe_customer_id),
    accessRevoked: Boolean(sub.access_revoked),
    pastDueSince,
    graceEndsAt: pastDueSince ? graceEndsAtIso(pastDueSince) : null,
    graceDaysRemaining: pastDueSince ? graceDaysRemaining(pastDueSince) : null,
  };
}
