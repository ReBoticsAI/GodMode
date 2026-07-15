import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import {
  getPlatformBillingConfig,
  setPlatformBillingKeys,
  testStripeConnection,
} from "../services/platform-billing.js";

export function createAdminBillingRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/", (_req, res) => {
    res.json(getPlatformBillingConfig());
  });

  return router;
}
