import { createHmac, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Database(":memory:");
mem.pragma("foreign_keys = ON");

vi.mock("../../core-db.js", async () => {
  const actual = await vi.importActual<typeof import("../../core-db.js")>(
    "../../core-db.js"
  );
  return {
    ...actual,
    getCoreDb: () => mem,
  };
});

vi.mock("../../config.js", () => ({
  config: {
    isSaas: true,
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
      ],
    },
  },
}));

import { handleSaasStripeWebhook } from "../saas-billing.js";
import {
  applyStripeSubscriptionObject,
  assertSaasUserMayAccess,
  linkSubscriptionToUser,
  listSaasCustomersForAdmin,
  setUserAccessDisabled,
  subscriptionGrantsAccess,
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
      last_seen_at TEXT,
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
    expect(subscriptionGrantsAccess(pastDue!)).toBe(true);
  });

  it("assertSaasUserMayAccess exempts admins and blocks disabled users", () => {
    const admin = insertUser({ email: "admin@example.com", isAdmin: true });
    expect(assertSaasUserMayAccess(admin).ok).toBe(true);

    const user = insertUser({
      email: "blocked@example.com",
      accessDisabled: true,
    });
    const denied = assertSaasUserMayAccess(user);
    expect(denied.ok).toBe(false);
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
});
