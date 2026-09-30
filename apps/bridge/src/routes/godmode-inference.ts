import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../services/auth/middleware.js";
import {
  createGodModeInferenceCheckoutSession,
  getGodModeInferencePublicConfig,
  getGodModeInferenceUserStatus,
  handleGodModeInferenceStripeWebhook,
  getAdminGodModeInferenceHealth,
  isGodModeInferencePackPlanId,
} from "../services/godmode-inference-billing.js";
import {
  defaultTrialBudgetUsd,
  listAdminGodModeInferenceGrants,
  patchGodModeInferenceGrantBudget,
  revokeAdminGodModeInferenceGrant,
  setDefaultTrialBudgetUsd,
  toAdminGodModeInferenceGrant,
  topUpGodModeInferenceGrant,
} from "../services/godmode-inference-grants.js";
import { config } from "../config.js";
import {
  assertInferenceCloudReturnUrl,
  claimDelegatedInferenceCheckout,
  claimInferenceCloudCheckout,
  inferenceCheckoutDelegatesToCloud,
  startDelegatedInferenceCheckout,
} from "../services/godmode-inference-cloud-checkout.js";

export function createGodModeInferenceRouter(): Router {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json(getGodModeInferencePublicConfig());
  });

  router.get("/status", requireAuth, (req, res) => {
    const user = req.user!;
    res.json(
      getGodModeInferenceUserStatus(user.id, {
        email: user.email,
        temporary: user.temporary,
      })
    );
  });

  router.post("/checkout", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const email = (user.email ?? "").trim().toLowerCase();
      const planId =
        typeof req.body?.planId === "string" ? req.body.planId.trim() : "pack_10";
      const webBase = config.web.publicUrl.replace(/\/$/, "");
      const successUrl =
        typeof req.body?.successUrl === "string" && req.body.successUrl.trim()
          ? req.body.successUrl.trim()
          : `${webBase}/platform-vault?vault=inference&sub=godmode&paid=1&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl =
        typeof req.body?.cancelUrl === "string" && req.body.cancelUrl.trim()
          ? req.body.cancelUrl.trim()
          : `${webBase}/platform-vault?vault=inference&sub=godmode`;
      if (inferenceCheckoutDelegatesToCloud()) {
        const session = await startDelegatedInferenceCheckout({
          planId,
          successUrl,
          cancelUrl,
          email:
            user.temporary || email.startsWith("visitor+") ? undefined : user.email,
        });
        res.json(session);
        return;
      }
      if (user.temporary || email.startsWith("visitor+")) {
        res.status(403).json({
          error: "Sign in with an account email before buying GodMode Inference",
        });
        return;
      }
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

  router.post("/checkout/complete", requireAuth, async (req, res) => {
    const sessionId = String(req.body?.sessionId ?? req.body?.session_id ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    try {
      const claimed = await claimDelegatedInferenceCheckout(sessionId);
      const grant = topUpGodModeInferenceGrant({
        userId: req.user!.id,
        kind: isGodModeInferencePackPlanId(claimed.planId) ? "pack" : "subscription",
        budgetUsd: claimed.budgetUsd,
        stripeSessionId: sessionId,
      });
      res.json({
        ok: true,
        remainingUsd: grant.budget_usd != null ? grant.budget_usd - grant.spent_usd : null,
      });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 500
          : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Could not apply Inference payment",
      });
    }
  });

  /** GodMode Cloud: create Stripe Checkout for a Local install. */
  router.post("/cloud-checkout", async (req, res) => {
    if (!config.isSaas) {
      res.status(404).json({ error: "Inference Cloud checkout runs on GodMode Cloud" });
      return;
    }
    try {
      const planId =
        typeof req.body?.planId === "string" ? req.body.planId.trim() : "pack_10";
      const successUrl = assertInferenceCloudReturnUrl(req.body?.successUrl, "success");
      const cancelUrl = assertInferenceCloudReturnUrl(req.body?.cancelUrl, "cancel");
      const email = typeof req.body?.email === "string" ? req.body.email : undefined;
      const session = await createGodModeInferenceCheckoutSession({
        email,
        planId,
        successUrl,
        cancelUrl,
        cloudClaim: true,
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

  router.post("/cloud-checkout/claim", (req, res) => {
    if (!config.isSaas) {
      res.status(404).json({ error: "Inference Cloud checkout runs on GodMode Cloud" });
      return;
    }
    const sessionId = String(req.body?.sessionId ?? req.body?.session_id ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    try {
      res.json(claimInferenceCloudCheckout(sessionId));
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 500
          : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Claim failed",
      });
    }
  });

  router.get("/admin/health", requireAuth, (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    res.json({
      ...getAdminGodModeInferenceHealth(),
      defaultTrialBudgetUsd: defaultTrialBudgetUsd(),
      deploymentSurface: config.isSaas ? "saas" : "local",
    });
  });

  router.get("/admin/grants", requireAuth, (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const limit = Number(req.query.limit);
    const status =
      typeof req.query.status === "string" ? req.query.status : null;
    res.json({
      grants: listAdminGodModeInferenceGrants({
        limit: Number.isFinite(limit) ? limit : 50,
        status,
      }),
      defaultTrialBudgetUsd: defaultTrialBudgetUsd(),
    });
  });

  /** Create complimentary Inference credit for a user (no Stripe). */
  router.post("/admin/grants", requireAuth, (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    try {
      const userId = String(req.body?.userId ?? req.body?.user_id ?? "").trim();
      if (!userId) {
        res.status(400).json({ error: "userId required" });
        return;
      }
      const budgetRaw = Number(req.body?.budgetUsd ?? req.body?.budget_usd ?? 5);
      if (!Number.isFinite(budgetRaw) || budgetRaw <= 0) {
        res.status(400).json({ error: "budgetUsd must be a positive number" });
        return;
      }
      const grant = topUpGodModeInferenceGrant({
        userId,
        kind: "pack",
        budgetUsd: budgetRaw,
      });
      res.status(201).json({ grant: toAdminGodModeInferenceGrant(grant) });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 500
          : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Grant failed",
      });
    }
  });

  router.patch("/admin/grants/:id", requireAuth, (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    try {
      const budgetRaw = req.body?.budgetUsd ?? req.body?.budget_usd;
      if (budgetRaw == null) {
        res.status(400).json({ error: "budgetUsd required" });
        return;
      }
      const updated = patchGodModeInferenceGrantBudget(
        String(req.params.id ?? ""),
        Number(budgetRaw)
      );
      if (!updated) {
        res.status(404).json({ error: "Grant not found" });
        return;
      }
      res.json({ grant: toAdminGodModeInferenceGrant(updated) });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 500
          : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Update failed",
      });
    }
  });

  router.post("/admin/grants/:id/revoke", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const updated = await revokeAdminGodModeInferenceGrant(
      String(req.params.id ?? "")
    );
    if (!updated) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    res.json({ grant: updated });
  });

  router.put("/admin/default-trial-budget", requireAuth, (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    try {
      const raw = req.body?.budgetUsd ?? req.body?.budget_usd;
      const next = setDefaultTrialBudgetUsd(Number(raw));
      res.json({ defaultTrialBudgetUsd: next });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status) || 500
          : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Update failed",
      });
    }
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
