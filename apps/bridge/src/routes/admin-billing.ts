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

  router.put("/", (req, res) => {
    const { secretKey, publishableKey, creditsPerUsd } = req.body ?? {};
    const cfg = setPlatformBillingKeys({
      secretKey: typeof secretKey === "string" ? secretKey : undefined,
      publishableKey: typeof publishableKey === "string" ? publishableKey : undefined,
      creditsPerUsd:
        creditsPerUsd != null && Number.isFinite(Number(creditsPerUsd))
          ? Number(creditsPerUsd)
          : undefined,
    });
    res.json(cfg);
  });

  router.post("/test", async (_req, res) => {
    const result = await testStripeConnection();
    res.status(result.ok ? 200 : 400).json(result);
  });

  return router;
}
