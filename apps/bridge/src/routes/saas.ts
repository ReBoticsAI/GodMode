import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getCloudDb } from "../core-db.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import {
  attachAuthContext,
  requireAuth,
} from "../services/auth/middleware.js";
import {
  createSaasBillingPortalSession,
  createSaasCheckoutSession,
  getSaasPaywallPublicConfig,
  handleSaasStripeWebhook,
  resolveEntitlementForCheckoutSession,
} from "../services/saas-billing.js";
import {
  approveSellerLinkDevice,
  completeSellerGithubRedirect,
  completeSellerLinkRedirect,
  completeSellerStripeRedirect,
  denySellerLinkDevice,
  exchangeSellerLinkCode,
  getSellerGithubRedirectSession,
  getSellerLinkRedirectSession,
  getSellerStripeRedirectSession,
  pollSellerLinkDevice,
  resolveSellerLinkBearer,
  revokeSellerLinkBearer,
  sellerLinkCloudUserHint,
  startSellerGithubRedirect,
  startSellerLinkDevice,
  startSellerLinkRedirect,
  startSellerStripeRedirect,
} from "../services/seller-link.js";
import { beginGithubIntegrationConnect } from "../services/github-integration.js";
import {
  acceptMarketplaceTos,
  getSellerPayoutSnapshot,
} from "../services/marketplace-commerce.js";
import {
  refreshStripeConnectStatus,
  startStripeConnectOnboarding,
} from "../services/marketplace-payments.js";
import { getPublicSubscriptionForUser, getSellerEntitlementPayload } from "../services/saas-subscriptions.js";

function sellerLinkErrStatus(err: unknown): number {
  if (err && typeof err === "object" && "status" in err) {
    const status = Number((err as { status: number }).status);
    if (Number.isFinite(status)) return status;
  }
  return 500;
}

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
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }
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
        email,
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

  router.get(
    "/seller-entitlement",
    requireSaas,
    (req, res) => {
      const linkUser = resolveSellerLinkBearer(req.headers.authorization);
      if (linkUser) {
        const entitlement = getSellerEntitlementPayload(linkUser.id);
        res.json({
          sellerActive: entitlement.sellerActive,
          planId: entitlement.planId,
          source: entitlement.source,
          cloudUserHint: sellerLinkCloudUserHint(linkUser.id),
          githubConnected: entitlement.githubConnected,
          githubLogin: entitlement.githubLogin,
          tosAccepted: entitlement.tosAccepted,
          stripePayoutReady: entitlement.stripePayoutReady,
        });
        return;
      }
      attachAuthContext(req, res, () => {
        requireAuth(req, res, () => {
          const entitlement = getSellerEntitlementPayload(req.user!.id);
          res.json({
            sellerActive: entitlement.sellerActive,
            planId: entitlement.planId,
            source: entitlement.source,
            githubConnected: entitlement.githubConnected,
            githubLogin: entitlement.githubLogin,
            tosAccepted: entitlement.tosAccepted,
            stripePayoutReady: entitlement.stripePayoutReady,
          });
        });
      });
    }
  );

  /** Local Bridge starts a device-code Seller link (no Cloud session). */
  router.post("/seller-link/device", requireSaas, limiter, (_req, res) => {
    try {
      res.json(startSellerLinkDevice());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to start seller link",
      });
    }
  });

  /** Local Bridge starts browser redirect bind (primary UX #706). */
  router.post("/seller-link/redirect", requireSaas, limiter, (req, res) => {
    const returnUrl =
      typeof req.body?.return_url === "string"
        ? req.body.return_url
        : typeof req.body?.returnUrl === "string"
          ? req.body.returnUrl
          : "";
    try {
      res.json(startSellerLinkRedirect(returnUrl));
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Failed to start seller link redirect",
      });
    }
  });

  /** Public: inspect a pending redirect session (Cloud connect page). */
  router.get("/seller-link/redirect", requireSaas, limiter, (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    try {
      res.json(getSellerLinkRedirectSession(state));
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Seller link session lookup failed",
      });
    }
  });

  /**
   * Cloud user finishes bind after auth (+ optional Seller checkout).
   * Returns Local redirect URL with one-time exchange code.
   */
  router.post(
    "/seller-link/redirect/complete",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      const state =
        typeof req.body?.state === "string"
          ? req.body.state
          : typeof req.query.state === "string"
            ? req.query.state
            : "";
      try {
        const entitlement = getSellerEntitlementPayload(req.user!.id);
        if (!entitlement.sellerActive) {
          res.status(403).json({
            error: "GodMode Seller seat is not active. Complete Seller checkout first.",
            sellerActive: false,
          });
          return;
        }
        const result = completeSellerLinkRedirect(req.user!.id, state);
        res.json({
          ok: true,
          redirectUrl: result.redirectUrl,
          sellerActive: true,
        });
      } catch (err) {
        res.status(sellerLinkErrStatus(err)).json({
          error: err instanceof Error ? err.message : "Complete seller link failed",
        });
      }
    }
  );

  /** Local Bridge starts Seller GitHub connect redirect (#711). */
  router.post("/seller-link/github-redirect", requireSaas, limiter, (req, res) => {
    const returnUrl =
      typeof req.body?.return_url === "string"
        ? req.body.return_url
        : typeof req.body?.returnUrl === "string"
          ? req.body.returnUrl
          : "";
    try {
      res.json(startSellerGithubRedirect(returnUrl));
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Failed to start Seller GitHub redirect",
      });
    }
  });

  router.get("/seller-link/github-redirect", requireSaas, limiter, (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    try {
      res.json(getSellerGithubRedirectSession(state));
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Seller GitHub session lookup failed",
      });
    }
  });

  /** Cloud Seller GitHub OAuth start without a workspace (#711 complimentary Seller). */
  router.post(
    "/seller-link/github-connect",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      const returnPath =
        typeof req.body?.returnPath === "string"
          ? req.body.returnPath
          : typeof req.body?.return_path === "string"
            ? req.body.return_path
            : undefined;
      try {
        const entitlement = getSellerEntitlementPayload(req.user!.id);
        if (!entitlement.sellerActive) {
          res.status(403).json({
            error: "GodMode Seller seat is not active.",
            sellerActive: false,
          });
          return;
        }
        res.json(beginGithubIntegrationConnect(req.user!.id, { returnPath }));
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : "Failed to start Seller GitHub connect",
        });
      }
    }
  );

  router.post(
    "/seller-link/github-redirect/complete",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      const state =
        typeof req.body?.state === "string"
          ? req.body.state
          : typeof req.query.state === "string"
            ? req.query.state
            : "";
      try {
        const entitlement = getSellerEntitlementPayload(req.user!.id);
        if (!entitlement.sellerActive) {
          res.status(403).json({
            error: "GodMode Seller seat is not active.",
            sellerActive: false,
          });
          return;
        }
        const result = completeSellerGithubRedirect(req.user!.id, state);
        res.json({ ok: true, redirectUrl: result.redirectUrl, sellerActive: true });
      } catch (err) {
        res.status(sellerLinkErrStatus(err)).json({
          error: err instanceof Error ? err.message : "Complete Seller GitHub failed",
        });
      }
    }
  );

  /** Local Bridge starts Seller Stripe Connect redirect (#709). */
  router.post("/seller-link/stripe-redirect", requireSaas, limiter, (req, res) => {
    const returnUrl =
      typeof req.body?.return_url === "string"
        ? req.body.return_url
        : typeof req.body?.returnUrl === "string"
          ? req.body.returnUrl
          : "";
    try {
      res.json(startSellerStripeRedirect(returnUrl));
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Failed to start Seller Stripe redirect",
      });
    }
  });

  router.get("/seller-link/stripe-redirect", requireSaas, limiter, (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    try {
      res.json(getSellerStripeRedirectSession(state));
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Seller Stripe session lookup failed",
      });
    }
  });

  /** Cloud Seller Stripe Connect start without a workspace (#709 complimentary Seller). */
  router.post(
    "/seller-link/stripe-connect",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    async (req, res) => {
      const state =
        typeof req.body?.state === "string"
          ? req.body.state
          : typeof req.query.state === "string"
            ? req.query.state
            : "";
      try {
        const entitlement = getSellerEntitlementPayload(req.user!.id);
        if (!entitlement.sellerActive) {
          res.status(403).json({
            error: "GodMode Seller seat is not active.",
            sellerActive: false,
          });
          return;
        }
        const userId = req.user!.id;
        const core = getCloudDb();
        acceptMarketplaceTos(core, userId);
        const origin = config.web.publicUrl.replace(/\/$/, "");
        const returnPath = state
          ? `/seller-link/stripe?state=${encodeURIComponent(state)}&stripe_connect=return`
          : `/seller-link/stripe?stripe_connect=return`;
        const refreshPath = state
          ? `/seller-link/stripe?state=${encodeURIComponent(state)}&stripe_connect=refresh`
          : `/seller-link/stripe?stripe_connect=refresh`;
        const result = await startStripeConnectOnboarding(core, {
          userId,
          returnUrl: `${origin}${returnPath}`,
          refreshUrl: `${origin}${refreshPath}`,
        });
        res.json(result);
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : "Failed to start Seller Stripe connect",
        });
      }
    }
  );

  router.post(
    "/seller-link/stripe-refresh",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    async (req, res) => {
      try {
        const entitlement = getSellerEntitlementPayload(req.user!.id);
        if (!entitlement.sellerActive) {
          res.status(403).json({
            error: "GodMode Seller seat is not active.",
            sellerActive: false,
          });
          return;
        }
        const userId = req.user!.id;
        const core = getCloudDb();
        const payout = getSellerPayoutSnapshot(core, userId);
        const accountId = String(payout.stripeConnectAccountId ?? "").trim();
        if (accountId.startsWith("acct_")) {
          await refreshStripeConnectStatus(core, userId);
        }
        res.json({
          ...getSellerEntitlementPayload(userId),
          ...getSellerPayoutSnapshot(core, userId),
        });
      } catch (err) {
        res.status(sellerLinkErrStatus(err)).json({
          error: err instanceof Error ? err.message : "Seller Stripe refresh failed",
        });
      }
    }
  );

  router.post(
    "/seller-link/stripe-redirect/complete",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      const state =
        typeof req.body?.state === "string"
          ? req.body.state
          : typeof req.query.state === "string"
            ? req.query.state
            : "";
      try {
        const entitlement = getSellerEntitlementPayload(req.user!.id);
        if (!entitlement.sellerActive) {
          res.status(403).json({
            error: "GodMode Seller seat is not active.",
            sellerActive: false,
          });
          return;
        }
        const result = completeSellerStripeRedirect(req.user!.id, state);
        res.json({ ok: true, redirectUrl: result.redirectUrl, sellerActive: true });
      } catch (err) {
        res.status(sellerLinkErrStatus(err)).json({
          error: err instanceof Error ? err.message : "Complete Seller Stripe failed",
        });
      }
    }
  );

  /** Local Bridge exchanges one-time code for gsl_ token. */
  router.post("/seller-link/exchange", requireSaas, limiter, (req, res) => {
    const code =
      typeof req.body?.code === "string"
        ? req.body.code
        : typeof req.body?.exchange_code === "string"
          ? req.body.exchange_code
          : typeof req.body?.exchangeCode === "string"
            ? req.body.exchangeCode
            : "";
    try {
      const result = exchangeSellerLinkCode(code);
      res.json({
        status: "complete",
        access_token: result.accessToken,
        token_type: result.tokenType,
      });
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Exchange failed",
      });
    }
  });

  /** Local Bridge polls until the Cloud user approves. */
  router.post("/seller-link/token", requireSaas, limiter, (req, res) => {
    const deviceCode =
      typeof req.body?.device_code === "string"
        ? req.body.device_code
        : typeof req.body?.deviceCode === "string"
          ? req.body.deviceCode
          : "";
    try {
      const result = pollSellerLinkDevice(deviceCode);
      if (result.status === "complete") {
        res.json({
          status: "complete",
          access_token: result.accessToken,
          token_type: result.tokenType,
        });
        return;
      }
      res.json({ status: result.status });
    } catch (err) {
      res.status(sellerLinkErrStatus(err)).json({
        error: err instanceof Error ? err.message : "Poll failed",
      });
    }
  });

  /** Cloud user approves a pending Local link code. */
  router.post(
    "/seller-link/approve",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      const userCode =
        typeof req.body?.user_code === "string"
          ? req.body.user_code
          : typeof req.body?.userCode === "string"
            ? req.body.userCode
            : "";
      try {
        const result = approveSellerLinkDevice(req.user!.id, userCode);
        res.json({ ok: true, ...result });
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : "Approve failed",
        });
      }
    }
  );

  router.post(
    "/seller-link/deny",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      const userCode =
        typeof req.body?.user_code === "string"
          ? req.body.user_code
          : typeof req.body?.userCode === "string"
            ? req.body.userCode
            : "";
      try {
        denySellerLinkDevice(req.user!.id, userCode);
        res.json({ ok: true });
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : "Deny failed",
        });
      }
    }
  );

  /** Local Bridge revokes its stored seller-link token. */
  router.delete("/seller-link/token", requireSaas, limiter, (req, res) => {
    const revoked = revokeSellerLinkBearer(req.headers.authorization);
    if (!revoked) {
      res.status(401).json({ error: "Invalid or already revoked seller link token" });
      return;
    }
    res.json({ ok: true });
  });

  router.get(
    "/subscription",
    requireSaas,
    attachAuthContext,
    requireAuth,
    (req, res) => {
      const sub = getPublicSubscriptionForUser(req.user!.id);
      res.json({ subscription: sub });
    }
  );

  router.post(
    "/portal",
    requireSaas,
    attachAuthContext,
    requireAuth,
    limiter,
    async (req, res) => {
      const publicBase = config.web.publicUrl.replace(/\/$/, "");
      const returnUrl =
        typeof req.body?.returnUrl === "string" &&
        req.body.returnUrl.startsWith(publicBase)
          ? req.body.returnUrl
          : `${publicBase}/settings/platform`;
      try {
        const session = await createSaasBillingPortalSession({
          userId: req.user!.id,
          returnUrl,
        });
        res.json(session);
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : "Portal failed",
        });
      }
    }
  );

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
