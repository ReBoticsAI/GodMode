import { Router } from "express";
import { config } from "../config.js";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import {
  grantComplimentaryAccess,
  listSaasCustomersForAdmin,
  revokeComplimentaryAccess,
  setUserAccessDisabled,
  subscriptionGrantsAccess,
  userHasActiveComplimentaryAccess,
} from "../services/saas-subscriptions.js";
import { syncMissingSaasSubscriptionsFromStripe } from "../services/saas-billing.js";

export function createAdminSaasRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.use((_req, res, next) => {
    if (!config.isSaas) {
      res.status(404).json({ error: "SaaS admin is not enabled on this installation" });
      return;
    }
    next();
  });

  router.get("/customers", async (_req, res) => {
    try {
      await syncMissingSaasSubscriptionsFromStripe();
    } catch {
      /* list still useful without Stripe sync */
    }
    res.json({ customers: listSaasCustomersForAdmin() });
  });

  router.post("/customers/:userId/access", (req, res) => {
    const userId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    const disabled = Boolean(req.body?.disabled);
    if (userId === req.user!.id && disabled) {
      res.status(400).json({ error: "You cannot disable your own account" });
      return;
    }
    const user = setUserAccessDisabled(userId, disabled);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      userId: user.id,
      accessDisabled: Boolean(user.access_disabled),
    });
  });

  /**
   * Grant or revoke complimentary Cloud access (not platform admin).
   * Body: `{ grant: boolean, expiresAt?: string | null }`
   * Revoke leaves the account able to log in credentials-wise but
   * `assertSaasUserMayAccess` returns 403 until they subscribe.
   */
  router.post("/customers/:userId/complimentary", (req, res) => {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    if (typeof req.body?.grant !== "boolean") {
      res.status(400).json({ error: "grant boolean required" });
      return;
    }

    try {
      const sub = req.body.grant
        ? grantComplimentaryAccess(userId, {
            expiresAt:
              req.body.expiresAt === undefined ? undefined : req.body.expiresAt,
          })
        : revokeComplimentaryAccess(userId);
      res.json({
        userId,
        grant: req.body.grant,
        complimentaryAccess: userHasActiveComplimentaryAccess(userId),
        accessGranted: subscriptionGrantsAccess(sub),
        planId: sub.plan_id,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
      });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: unknown }).status)
          : 500;
      const message = err instanceof Error ? err.message : "Update failed";
      if (status >= 400 && status < 500) {
        res.status(status).json({ error: message });
        return;
      }
      console.error("[admin-saas] complimentary", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
