import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import {
  createSaasCheckoutSession,
  getSaasPaywallPublicConfig,
  handleSaasStripeWebhook,
  resolveEntitlementForCheckoutSession,
} from "../services/saas-billing.js";

function requireSaas(_req: Request, res: Response, next: () => void): void {
  if (!config.isSaas) {
    res.status(404).json({ error: "SaaS paywall is not enabled on this installation" });
    return;
  }
  next();
}

export function createSaasRouter(): Router {
  const router = Router();
  const limiter = rateLimit({ windowMs: 60_000, max: 30, message: "Too many requests" });

  router.get("/paywall", requireSaas, (_req, res) => {
    res.json(getSaasPaywallPublicConfig());
  });

  router.post("/checkout", requireSaas, limiter, async (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const plan =
      typeof req.body?.plan === "string"
        ? req.body.plan.trim()
        : typeof req.body?.priceId === "string"
          ? req.body.priceId.trim()
          : "";
    const publicBase = config.web.publicUrl.replace(/\/$/, "");
    const successUrl =
      typeof req.body?.successUrl === "string" && req.body.successUrl.startsWith(publicBase)
        ? req.body.successUrl
        : `${publicBase}/?saas_checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      typeof req.body?.cancelUrl === "string" && req.body.cancelUrl.startsWith(publicBase)
        ? req.body.cancelUrl
        : `${publicBase}/?saas_checkout=cancel`;

    try {
      const session = await createSaasCheckoutSession({
        email: email || undefined,
        plan: plan || undefined,
        successUrl,
        cancelUrl,
      });
      res.json(session);
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status)
          : 500;
      res.status(Number.isFinite(status) ? status : 500).json({
        error: err instanceof Error ? err.message : "Checkout failed",
      });
    }
  });

  router.get("/checkout/status", requireSaas, limiter, async (req, res) => {
    const sessionId =
      typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
    if (!sessionId) {
      res.status(400).json({ error: "session_id required" });
      return;
    }
    try {
      const entitlement = await resolveEntitlementForCheckoutSession(sessionId);
      if (!entitlement) {
        res.status(404).json({ error: "Checkout not complete or payment not found" });
        return;
      }
      res.json({
        paid: entitlement.status === "pending" || entitlement.status === "consumed",
        email: entitlement.email,
        status: entitlement.status,
        sessionId: entitlement.stripe_session_id,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to resolve checkout",
      });
    }
  });

  return router;
}

export function saasStripeWebhookHandler(req: Request, res: Response): void {
  if (!config.isSaas) {
    res.status(404).json({ error: "SaaS paywall is not enabled on this installation" });
    return;
  }
  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : "", "utf8");
  const result = handleSaasStripeWebhook(raw, req.get("stripe-signature") ?? undefined);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ received: true });
}
