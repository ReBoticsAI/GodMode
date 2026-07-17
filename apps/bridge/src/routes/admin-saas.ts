import { Router } from "express";
import { config } from "../config.js";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import {
  listSaasCustomersForAdmin,
  setUserAccessDisabled,
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

  return router;
}
