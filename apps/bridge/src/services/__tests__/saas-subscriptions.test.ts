import { createHmac, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Database(":memory:");
mem.pragma("foreign_keys = ON");

const platformMeta = new Map<string, string>();

vi.mock("../../core-db.js", () => ({
  getCloudDb: () => mem,
  initCoreDb: () => mem,
  getPlatformMeta: (_db: unknown, key: string) => platformMeta.get(key) ?? null,
  setPlatformMeta: (_db: unknown, key: string, value: string) => {
    platformMeta.set(key, value);
  },
}));

vi.mock("../../config.js", () => ({
  config: {
    isSaas: true,
    dataDir: "/tmp/gm-saas-sub",
    cloudDbPath: "/tmp/gm-saas-sub/Cloud.sqlite",
    usersDir: "/tmp/gm-saas-sub/users",
    tenantsDir: "/tmp/gm-saas-sub/tenants",
    saas: {
      webhookSecret: "whsec_test",
      checkoutMode: "subscription",
      plans: [
        {
          id: "monthly",
          priceId: "price_month",
          label: "Monthly",
          amountLabel: "$9.99/month",
          interval: "month",
        },
        {
          id: "seller",
          priceId: "price_seller",
          label: "GodMode Seller",
          amountLabel: "$4.99/month",
          interval: "month",
        },
      ],
    },
  },
}));

import { handleSaasStripeWebhook } from "../saas-billing.js";
import {
  applyStripeSubscriptionObject,
  assertMayStartSellerCheckout,
  assertSaasUserMayAccess,
  getPublicSubscriptionForUser,
  getSellerEntitlementForUser,
  grantComplimentaryAccess,
  grantComplimentarySellerAccess,
  linkSubscriptionToUser,
  listSaasCustomersForAdmin,
  markSubscriptionPastDueByCustomer,
  revokeComplimentaryAccess,
  revokeComplimentarySellerAccess,
  setUserAccessDisabled,
  subscriptionGrantsAccess,
  subscriptionGrantsSellerCommerce,
  userHasActiveComplimentarySellerAccess,
  upsertSubscriptionFromCheckout,
  type SaasSubscription,
} from "../saas-subscriptions.js";
import type { CoreUser } from "../../core-db.js";

function signedPayload(payload: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", "whsec_test")
    .update(`${t}.${payload}`)
    .digest("hex");
  return `t=${t},v1=${v1}`;
}

function seedSchema(): void {
  mem.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      access_disabled INTEGER NOT NULL DEFAULT 0,
      access_disabled_reason TEXT,
      last_seen_at TEXT,
      deleted_at TEXT,
      deletion_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_operator INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saas_entitlements (
      id TEXT PRIMARY KEY,
      email TEXT,
      stripe_session_id TEXT NOT NULL UNIQUE,
      stripe_customer_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      consumed_at TEXT,
      consumed_by_user_id TEXT REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS saas_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      email TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      stripe_session_id TEXT,
      plan_id TEXT,
      price_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_end TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      access_revoked INTEGER NOT NULL DEFAULT 0,
      past_due_since TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function insertUser(opts: {
  id?: string;
  email: string;
  isAdmin?: boolean;
  accessDisabled?: boolean;
}): CoreUser {
  const id = opts.id ?? randomUUID();
  mem
    .prepare(
      `INSERT INTO users (id, email, display_name, is_admin, access_disabled)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      id,
      opts.email,
      opts.email.split("@")[0],
      opts.isAdmin ? 1 : 0,
      opts.accessDisabled ? 1 : 0
    );
  return mem.prepare(`SELECT * FROM users WHERE id=?`).get(id) as CoreUser;
}

describe("saas subscriptions", () => {
  beforeEach(() => {
    seedSchema();
  });

  afterEach(() => {
    mem.exec(`
      DELETE FROM saas_subscriptions;
      DELETE FROM saas_entitlements;
      DELETE FROM tenants;
      DELETE FROM users;
    `);
  });

  it("upserts subscription from checkout and links to user", () => {
    const sub = upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_test_1",
      email: "a@example.com",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      planId: "monthly",
      priceId: "price_month",
    });
    expect(sub.status).toBe("active");
    expect(sub.stripe_customer_id).toBe("cus_1");

    const user = insertUser({ email: "a@example.com" });
    const linked = linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_test_1",
      stripeCustomerId: "cus_1",
      email: "a@example.com",
    });
    expect(linked?.user_id).toBe(user.id);
  });

  it("revokes access when subscription is deleted", () => {
    upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_test_2",
      email: "b@example.com",
      stripeCustomerId: "cus_2",
      stripeSubscriptionId: "sub_2",
      planId: "monthly",
    });
    const updated = applyStripeSubscriptionObject({
      id: "sub_2",
      customer: "cus_2",
      status: "canceled",
      cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) - 60,
      metadata: { godmode_plan: "monthly", godmode_saas: "1" },
    });
    expect(updated?.access_revoked).toBe(1);
    expect(subscriptionGrantsAccess(updated as SaasSubscription)).toBe(false);
  });

  it("keeps access for active and past_due", () => {
    const active = upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_test_3",
      stripeCustomerId: "cus_3",
      stripeSubscriptionId: "sub_3",
      status: "active",
    });
    expect(subscriptionGrantsAccess(active)).toBe(true);
    const pastDue = applyStripeSubscriptionObject({
      id: "sub_3",
      customer: "cus_3",
      status: "past_due",
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
    });
    expect(pastDue?.past_due_since).toBeTruthy();
    expect(subscriptionGrantsAccess(pastDue!)).toBe(true);
  });

  it("revokes past_due access after grace and recovers on active", () => {
    const prev = process.env.SAAS_PAST_DUE_GRACE_DAYS;
    process.env.SAAS_PAST_DUE_GRACE_DAYS = "7";
    try {
      upsertSubscriptionFromCheckout({
        stripeSessionId: "cs_grace_1",
        email: "grace@example.com",
        stripeCustomerId: "cus_grace",
        stripeSubscriptionId: "sub_grace",
        planId: "monthly",
        status: "active",
      });
      const marked = markSubscriptionPastDueByCustomer("cus_grace");
      expect(marked?.status).toBe("past_due");
      expect(marked?.past_due_since).toBeTruthy();
      expect(subscriptionGrantsAccess(marked!)).toBe(true);

      const firstSince = marked!.past_due_since;
      const again = markSubscriptionPastDueByCustomer("cus_grace");
      expect(again?.past_due_since).toBe(firstSince);

      mem
        .prepare(
          `UPDATE saas_subscriptions
           SET past_due_since=datetime('now', '-8 days')
           WHERE id=?`
        )
        .run(marked!.id);
      const expired = mem
        .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
        .get(marked!.id) as SaasSubscription;
      expect(subscriptionGrantsAccess(expired)).toBe(false);
      const revoked = mem
        .prepare(`SELECT * FROM saas_subscriptions WHERE id=?`)
        .get(marked!.id) as SaasSubscription;
      expect(revoked.access_revoked).toBe(1);

      const recovered = applyStripeSubscriptionObject({
        id: "sub_grace",
        customer: "cus_grace",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        metadata: { godmode_plan: "monthly", godmode_saas: "1" },
      });
      expect(recovered?.status).toBe("active");
      expect(recovered?.past_due_since).toBeNull();
      expect(recovered?.access_revoked).toBe(0);
      expect(subscriptionGrantsAccess(recovered!)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SAAS_PAST_DUE_GRACE_DAYS;
      else process.env.SAAS_PAST_DUE_GRACE_DAYS = prev;
    }
  });

  it("exposes past_due grace fields on the public subscription payload", () => {
    const user = insertUser({ email: "pub@example.com" });
    upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_pub",
      email: "pub@example.com",
      stripeCustomerId: "cus_pub",
      stripeSubscriptionId: "sub_pub",
      planId: "monthly",
      status: "active",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_pub",
      stripeCustomerId: "cus_pub",
    });
    markSubscriptionPastDueByCustomer("cus_pub");
    const pub = getPublicSubscriptionForUser(user.id);
    expect(pub?.status).toBe("past_due");
    expect(pub?.pastDueSince).toBeTruthy();
    expect(pub?.graceEndsAt).toBeTruthy();
    expect(pub?.graceDaysRemaining).toBeGreaterThan(0);
    expect(pub?.accessRevoked).toBe(false);
  });

  it("assertSaasUserMayAccess exempts admins and blocks suspended users", () => {
    const admin = insertUser({ email: "admin@example.com", isAdmin: true });
    expect(assertSaasUserMayAccess(admin).ok).toBe(true);

    const user = insertUser({
      email: "blocked@example.com",
      accessDisabled: true,
    });
    mem
      .prepare(
        `UPDATE users SET access_disabled_reason=? WHERE id=?`
      )
      .run("ToS violation", user.id);
    const refreshed = mem
      .prepare(`SELECT * FROM users WHERE id=?`)
      .get(user.id) as CoreUser;
    const denied = assertSaasUserMayAccess(refreshed);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toMatch(/suspended: ToS violation/i);
  });

  it("setUserAccessDisabled does not flip billing access_revoked", () => {
    const user = insertUser({ email: "suspend@example.com" });
    upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_suspend",
      email: "suspend@example.com",
      stripeCustomerId: "cus_suspend",
      stripeSubscriptionId: "sub_suspend",
      planId: "monthly",
      status: "active",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_suspend",
      stripeCustomerId: "cus_suspend",
    });
    setUserAccessDisabled(user.id, true, "security review");
    const sub = mem
      .prepare(`SELECT * FROM saas_subscriptions WHERE user_id=?`)
      .get(user.id) as SaasSubscription;
    expect(sub.access_revoked).toBe(0);
    const refreshed = mem
      .prepare(`SELECT * FROM users WHERE id=?`)
      .get(user.id) as CoreUser;
    expect(refreshed.access_disabled).toBe(1);
    expect(refreshed.access_disabled_reason).toBe("security review");
  });

  it("assertSaasUserMayAccess blocks canceled subscribers", () => {
    const user = insertUser({ email: "c@example.com" });
    upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_test_4",
      email: "c@example.com",
      stripeCustomerId: "cus_4",
      stripeSubscriptionId: "sub_4",
      status: "canceled",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_test_4",
      stripeCustomerId: "cus_4",
    });
    applyStripeSubscriptionObject({
      id: "sub_4",
      customer: "cus_4",
      status: "canceled",
      current_period_end: Math.floor(Date.now() / 1000) - 10,
    });
    const denied = assertSaasUserMayAccess(user);
    expect(denied.ok).toBe(false);
  });

  it("handles checkout and subscription webhooks", () => {
    const checkout = JSON.stringify({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_wh_1",
          customer: "cus_wh",
          subscription: "sub_wh",
          customer_details: { email: "wh@example.com" },
          metadata: { godmode_saas: "1", godmode_plan: "monthly" },
        },
      },
    });
    const checkoutResult = handleSaasStripeWebhook(
      Buffer.from(checkout),
      signedPayload(checkout)
    );
    expect(checkoutResult.ok).toBe(true);
    if (checkoutResult.ok) {
      expect(checkoutResult.entitlement?.stripe_session_id).toBe("cs_wh_1");
    }

    const updated = JSON.stringify({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_wh",
          customer: "cus_wh",
          status: "active",
          cancel_at_period_end: true,
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          metadata: { godmode_saas: "1", godmode_plan: "monthly" },
          items: { data: [{ price: { id: "price_month" } }] },
        },
      },
    });
    expect(
      handleSaasStripeWebhook(Buffer.from(updated), signedPayload(updated)).ok
    ).toBe(true);

    const failed = JSON.stringify({
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_wh" } },
    });
    expect(
      handleSaasStripeWebhook(Buffer.from(failed), signedPayload(failed)).ok
    ).toBe(true);
  });

  it("lists customers and can disable access", () => {
    const user = insertUser({ email: "list@example.com" });
    upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_list",
      email: "list@example.com",
      stripeCustomerId: "cus_list",
      stripeSubscriptionId: "sub_list",
      planId: "monthly",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_list",
      stripeCustomerId: "cus_list",
    });
    const customers = listSaasCustomersForAdmin();
    expect(customers.some((c) => c.email === "list@example.com")).toBe(true);

    const updated = setUserAccessDisabled(user.id, true);
    expect(updated?.access_disabled).toBe(1);
    expect(assertSaasUserMayAccess(updated!).ok).toBe(false);
  });

  it("grants and revokes complimentary access without Stripe or is_admin", () => {
    const user = insertUser({ email: "gift@example.com" });
    expect(assertSaasUserMayAccess(user).ok).toBe(false);

    const granted = grantComplimentaryAccess(user.id);
    expect(granted.plan_id).toBe("complimentary");
    expect(granted.stripe_subscription_id).toBeNull();
    expect(user.is_admin).toBe(0);
    expect(assertSaasUserMayAccess(user).ok).toBe(true);

    const customers = listSaasCustomersForAdmin();
    const row = customers.find((c) => c.userId === user.id);
    expect(row?.complimentaryAccess).toBe(true);
    expect(row?.planLabel).toBe("Complimentary");

    const revoked = revokeComplimentaryAccess(user.id);
    expect(revoked.access_revoked).toBe(1);
    expect(assertSaasUserMayAccess(user).ok).toBe(false);
    const denied = assertSaasUserMayAccess(user);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toMatch(/subscription is inactive/i);
    }
  });

  it("re-grants complimentary access after revoke", () => {
    const user = insertUser({ email: "regift@example.com" });
    grantComplimentaryAccess(user.id);
    revokeComplimentaryAccess(user.id);
    expect(assertSaasUserMayAccess(user).ok).toBe(false);
    grantComplimentaryAccess(user.id);
    expect(assertSaasUserMayAccess(user).ok).toBe(true);
  });

  it("expired complimentary access does not pass the gate", () => {
    const user = insertUser({ email: "expired@example.com" });
    grantComplimentaryAccess(user.id, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(assertSaasUserMayAccess(user).ok).toBe(false);
  });

  it("grants and revokes complimentary Seller access without Stripe or workspace", () => {
    const user = insertUser({ email: "seller-gift@example.com" });
    expect(assertSaasUserMayAccess(user).ok).toBe(false);

    const granted = grantComplimentarySellerAccess(user.id);
    expect(granted.plan_id).toBe("seller");
    expect(granted.stripe_subscription_id).toBeNull();
    expect(subscriptionGrantsAccess(granted)).toBe(false);
    expect(subscriptionGrantsSellerCommerce(granted)).toBe(true);
    expect(assertSaasUserMayAccess(user).ok).toBe(true);
    expect(userHasActiveComplimentarySellerAccess(user.id)).toBe(true);
    expect(getSellerEntitlementForUser(user.id)).toEqual({
      sellerActive: true,
      planId: "seller",
      source: "seller",
    });

    const customers = listSaasCustomersForAdmin();
    const row = customers.find((c) => c.userId === user.id);
    expect(row?.complimentarySellerAccess).toBe(true);
    expect(row?.planLabel).toBe("Complimentary Seller");

    const revoked = revokeComplimentarySellerAccess(user.id);
    expect(revoked.access_revoked).toBe(1);
    expect(assertSaasUserMayAccess(user).ok).toBe(false);
  });

  it("seller plan grants seller commerce but not full workspace access", () => {
    const user = insertUser({ email: "seller@example.com" });
    const seller = upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_seller_1",
      email: "seller@example.com",
      stripeCustomerId: "cus_seller_1",
      stripeSubscriptionId: "sub_seller_1",
      planId: "seller",
      priceId: "price_seller",
      status: "active",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_seller_1",
      stripeCustomerId: "cus_seller_1",
      email: "seller@example.com",
    });
    expect(subscriptionGrantsAccess(seller)).toBe(false);
    expect(subscriptionGrantsSellerCommerce(seller)).toBe(true);
    expect(assertSaasUserMayAccess(user).ok).toBe(true);
    expect(getSellerEntitlementForUser(user.id)).toEqual({
      sellerActive: true,
      planId: "seller",
      source: "seller",
    });
  });

  it("workspace plan grants seller commerce and full workspace access", () => {
    const user = insertUser({ email: "workspace@example.com" });
    const monthly = upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_ws_1",
      email: "workspace@example.com",
      stripeCustomerId: "cus_ws_1",
      stripeSubscriptionId: "sub_ws_1",
      planId: "monthly",
      priceId: "price_month",
      status: "active",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_ws_1",
      stripeCustomerId: "cus_ws_1",
      email: "workspace@example.com",
    });
    expect(subscriptionGrantsAccess(monthly)).toBe(true);
    expect(subscriptionGrantsSellerCommerce(monthly)).toBe(true);
    expect(assertSaasUserMayAccess(user).ok).toBe(true);
    expect(getSellerEntitlementForUser(user.id)).toEqual({
      sellerActive: true,
      planId: "monthly",
      source: "workspace",
    });
  });

  it("blocks Seller seat checkout when workspace already grants Seller", () => {
    const user = insertUser({ email: "stack@example.com" });
    upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_stack_ws",
      email: "stack@example.com",
      stripeCustomerId: "cus_stack_ws",
      stripeSubscriptionId: "sub_stack_ws",
      planId: "monthly",
      priceId: "price_month",
      status: "active",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_stack_ws",
      stripeCustomerId: "cus_stack_ws",
      email: "stack@example.com",
    });
    expect(() => assertMayStartSellerCheckout("stack@example.com")).toThrow(
      /already includes Seller/i
    );
    expect(() => assertMayStartSellerCheckout("fresh-seller@example.com")).not.toThrow();
  });

  it("blocks Seller seat checkout when Seller seat is already active", () => {
    const user = insertUser({ email: "seller-active@example.com" });
    upsertSubscriptionFromCheckout({
      stripeSessionId: "cs_seller_active",
      email: "seller-active@example.com",
      stripeCustomerId: "cus_seller_active",
      stripeSubscriptionId: "sub_seller_active",
      planId: "seller",
      priceId: "price_seller",
      status: "active",
    });
    linkSubscriptionToUser({
      userId: user.id,
      stripeSessionId: "cs_seller_active",
      stripeCustomerId: "cus_seller_active",
      email: "seller-active@example.com",
    });
    expect(() => assertMayStartSellerCheckout("seller-active@example.com")).toThrow(
      /already active/i
    );
  });
});
