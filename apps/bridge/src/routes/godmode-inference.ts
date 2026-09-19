import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../services/auth/middleware.js";
import {
  createGodModeInferenceCheckoutSession,
  getGodModeInferencePublicConfig,
  getGodModeInferenceUserStatus,
  handleGodModeInferenceStripeWebhook,
  getAdminGodModeInferenceHealth,
} from "../services/godmode-inference-billing.js";
import { config } from "../config.js";

export function createGodModeInferenceRouter(): Router {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json(getGodModeInferencePublicConfig());
  });

  router.get("/status", requireAuth, (req, res) => {
    const user = req.user!;
    res.json(getGodModeInferenceUserStatus(user.id));
  });

  router.post("/checkout", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const planId =
        typeof req.body?.planId === "string" ? req.body.planId.trim() : "pack";
      const webBase = config.web.publicUrl.replace(/\/$/, "");
      const successUrl =
        typeof req.body?.successUrl === "string" && req.body.successUrl.trim()
          ? req.body.successUrl.trim()
          : `${webBase}/platform-vault?vault=inference&sub=godmode&paid=1`;
      const cancelUrl =
        typeof req.body?.cancelUrl === "string" && req.body.cancelUrl.trim()
          ? req.body.cancelUrl.trim()
          : `${webBase}/platform-vault?vault=inference&sub=godmode`;
      const session = await createGodModeInferenceCheckoutSession({
        userId: user.id,
        email: user.email,
        planId,
        successUrl,
        cancelUrl,
      });
      res.json(session);
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 500
          : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Checkout failed",
      });
    }
  });

  router.get("/admin/health", requireAuth, (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    res.json(getAdminGodModeInferenceHealth());
  });

  return router;
}

/** Raw-body Stripe webhook (mount before express.json). */
export function godModeInferenceStripeWebhookHandler(
  req: Request,
  res: Response
): void {
  const raw =
    (req as Request & { rawBody?: Buffer }).rawBody ??
    (Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? "")));
  const sig = req.headers["stripe-signature"];
  const result = handleGodModeInferenceStripeWebhook(
    raw,
    typeof sig === "string" ? sig : undefined
  );
  if (!result.ok) {
    res.status(result.status ?? 400).json({ error: result.detail ?? "Webhook failed" });
    return;
  }
  res.json({ received: true, detail: result.detail });
}
