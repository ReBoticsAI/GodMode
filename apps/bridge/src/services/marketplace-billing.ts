import cron, { type ScheduledTask } from "node-cron";
import { getCoreDb } from "../core-db.js";
import {
  chargeSubscriptionPeriod,
  expireEntitlement,
} from "./entitlements.js";

let billingTask: ScheduledTask | null = null;

export function sweepSubscriptionEntitlements(): number {
  const core = getCoreDb();
  const now = new Date().toISOString();
  const due = core
    .prepare(
      `SELECT * FROM marketplace_entitlements
       WHERE status='active'
         AND pricing_model='subscription'
         AND expires_at IS NOT NULL
         AND expires_at <= ?`
    )
    .all(now) as Array<Record<string, unknown>>;

  let processed = 0;
  for (const ent of due) {
    const ok = chargeSubscriptionPeriod(core, ent);
    if (!ok) {
      expireEntitlement(core, String(ent.id));
    }
    processed += 1;
  }
  return processed;
}

export function startMarketplaceBillingScheduler(): void {
  if (billingTask) return;
  billingTask = cron.schedule("0 * * * *", () => {
    try {
      const n = sweepSubscriptionEntitlements();
      if (n > 0) {
        console.log(`[marketplace-billing] processed ${n} subscription entitlements`);
      }
    } catch (err) {
      console.error("[marketplace-billing] sweep failed:", err);
    }
  });
}

export function stopMarketplaceBillingScheduler(): void {
  billingTask?.stop();
  billingTask = null;
}
