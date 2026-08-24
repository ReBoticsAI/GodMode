import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getCloudDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  auditOfficialCatalogPluginPins,
  buildPublicOfficialCatalog,
  listOfficialCatalogRows,
  syncOfficialCatalogFromPublicFeed,
  upsertOfficialCatalogEntry,
} from "../services/marketplace-official-catalog.js";
import {
  handleMarketplacePayPalWebhook,
  handleMarketplaceStripeWebhook,
} from "../services/marketplace-payments.js";
import {
  getPublicCommerceConfig,
  getPublicSellerStorefront,
  renderPublicSellerStorefrontHtml,
  MARKETPLACE_LISTING_SELLER_JOINS,
  COMMUNITY_VERIFIED_TIER_SQL,
  MarketplaceCommerceError,
} from "../services/marketplace-commerce.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import { fetchCommunityCatalog } from "../services/marketplace-catalog.js";
import {
  createGuestMarketplaceCheckout,
  guestCheckoutDelivery,
  guestCheckoutStatus,
} from "../services/marketplace-guest-checkout.js";

function requireSaasCommerce(_req: Request, res: Response): boolean {
  if (!config.isSaas) {
    res.status(404).json({ error: "Marketplace commerce is only available on GodMode Cloud" });
    return false;
  }
  return true;
}

/** Public + webhook routes for Marketplace commerce (protocol exceptions). */
export function createMarketplaceCommerceRouter(): Router {
  const router = Router();
  const guestLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: "Too many Marketplace checkout requests",
  });

  router.get("/commerce/config", (_req, res) => {
    res.json(getPublicCommerceConfig());
  });

  /** Unauthenticated Official catalog JSON for local/private-hub pulls. */
  router.get("/catalog/official/public", async (_req, res) => {
    try {
      if (!config.isSaas && !config.isHub) {
        // Still allow local hub/dev to serve curated rows when present.
      }
      const index = await buildPublicOfficialCatalog(getCloudDb());
      res.json(index);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load Official catalog",
      });
    }
  });

  /** Unauthenticated Community catalog + public listings for local/hub/desktop pulls. */
  router.get("/catalog/community/public", async (_req, res) => {
    try {
      const core = getCloudDb();
      const { url, entries } = await fetchCommunityCatalog(core);
      const listings = core
        .prepare(
          `SELECT ml.id, ml.seller_user_id, ml.kind, ml.resource_id, ml.title, ml.description,
                  ml.price_cents, ml.currency, ml.seller_kind, ml.catalog_entry_id,
                  ml.visibility, ml.status, ml.delivery_mode, ml.pricing_model,
                  ml.price_period, ml.meter_unit, ml.meter_rate, ml.license,
                  ml.inference_endpoint_id, ml.created_at, ml.updated_at,
                  (${COMMUNITY_VERIFIED_TIER_SQL}) AS verified_tier,
                  CASE WHEN (${COMMUNITY_VERIFIED_TIER_SQL}) > 0 THEN 1 ELSE 0 END AS verified_publisher,
                  CASE WHEN sa.stripe_connect_account_id IS NOT NULL
                    OR sa.paypal_merchant_id IS NOT NULL
                    OR sa.metamask_address IS NOT NULL THEN 1 ELSE 0 END AS payout_ready
           FROM marketplace_listings ml
           ${MARKETPLACE_LISTING_SELLER_JOINS}
           WHERE ml.status='active' AND ml.visibility='public' AND ml.kind != 'plugin'
             AND NOT (ml.catalog_entry_id IS NOT NULL AND COALESCE(ml.delivery_mode,'clone')='clone')
             AND ml.seller_kind='user'
           ORDER BY ml.created_at DESC LIMIT 100`
        )
        .all() as Array<Record<string, unknown>>;
      res.json({
        catalogUrl: url,
        entries,
        listings,
        version: 2,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load Community catalog",
      });
    }
  });

  /** Public seller storefront (JSON). Prefer Accept: text/html or /page for crawlable HTML. */
  router.get("/sellers/:handle/page", (req, res) => {
    try {
      const store = getPublicSellerStorefront(getCloudDb(), String(req.params.handle ?? ""));
      if (!store) {
        res.status(404).type("html").send("<!DOCTYPE html><title>Not found</title><h1>Seller not found</h1>");
        return;
      }
      res.status(200).type("html").send(renderPublicSellerStorefrontHtml(store));
    } catch (err) {
      res.status(502).type("html").send(
        `<!DOCTYPE html><title>Error</title><h1>${
          err instanceof Error ? err.message : "Failed to load seller"
        }</h1>`
      );
    }
  });

  router.get("/sellers/:handle", (req, res) => {
    try {
      const store = getPublicSellerStorefront(getCloudDb(), String(req.params.handle ?? ""));
      if (!store) {
        const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
        if (wantsHtml) {
          res.status(404).type("html").send("<!DOCTYPE html><title>Not found</title><h1>Seller not found</h1>");
          return;
        }
        res.status(404).json({ error: "Seller not found" });
        return;
      }
      const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
      if (wantsHtml) {
        res.status(200).type("html").send(renderPublicSellerStorefrontHtml(store));
        return;
      }
      res.json({
        handle: store.handle,
        storefrontUrl: store.storefrontUrl,
        listings: store.listings,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load seller storefront",
      });
    }
  });

  router.post("/checkout", guestLimiter, async (req, res) => {
    if (!requireSaasCommerce(req, res)) return;
    try {
      const listingId = String(req.body?.listingId ?? req.body?.listing_id ?? "").trim();
      const result = await createGuestMarketplaceCheckout(getCloudDb(), {
        listingId,
        successUrl: String(req.body?.successUrl ?? req.body?.success_url ?? ""),
        cancelUrl: String(req.body?.cancelUrl ?? req.body?.cancel_url ?? ""),
        buyerEmail: typeof req.body?.email === "string" ? req.body.email : undefined,
        tosAccepted: req.body?.tosAccepted === true || req.body?.tos_accepted === true,
      });
      res.json(result);
    } catch (err) {
      const status = err instanceof MarketplaceCommerceError ? err.status : 500;
      res.status(Number.isFinite(status) ? status : 500).json({
        error: err instanceof Error ? err.message : "Checkout failed",
      });
    }
  });

  router.get("/checkout/status", guestLimiter, (req, res) => {
    if (!requireSaasCommerce(req, res)) return;
    const sessionId =
      typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
    if (!sessionId) {
      res.status(400).json({ error: "session_id required" });
      return;
    }
    try {
      res.json(guestCheckoutStatus(getCloudDb(), sessionId));
    } catch (err) {
      const status = err instanceof MarketplaceCommerceError ? err.status : 500;
      res.status(Number.isFinite(status) ? status : 500).json({
        error: err instanceof Error ? err.message : "Checkout status failed",
      });
    }
  });

  router.get("/delivery", guestLimiter, (req, res) => {
    if (!requireSaasCommerce(req, res)) return;
    const sessionId =
      typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
    if (!sessionId) {
      res.status(400).json({ error: "session_id required" });
      return;
    }
    try {
      res.json(guestCheckoutDelivery(getCloudDb(), sessionId));
    } catch (err) {
      const status = err instanceof MarketplaceCommerceError ? err.status : 500;
      res.status(Number.isFinite(status) ? status : 500).json({
        error: err instanceof Error ? err.message : "Delivery lookup failed",
      });
    }
  });

  router.post("/paypal/capture", attachAuthContext, requireAuth, resolveTenant, async (req, res) => {
    if (!requireSaasCommerce(req, res)) return;
    try {
      const { capturePayPalOrder } = await import("../services/marketplace-payments.js");
      const paypalOrderId = String(req.body?.paypalOrderId ?? req.body?.paypal_order_id ?? "");
      if (!paypalOrderId) {
        res.status(400).json({ error: "paypalOrderId required" });
        return;
      }
      const order = await capturePayPalOrder(getCloudDb(), paypalOrderId);
      if (String(order.buyer_user_id) !== req.user!.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.json({ order });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "PayPal capture failed",
      });
    }
  });

  router.get(
    "/admin/official-catalog",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (req, res) => {
      if (!requireSaasCommerce(req, res)) return;
      if (!req.user?.isAdmin) {
        res.status(403).json({ error: "Admin required" });
        return;
      }
      const entries = listOfficialCatalogRows(getCloudDb());
      res.json({
        entries,
        pinAudit: auditOfficialCatalogPluginPins(entries),
      });
    }
  );

  router.post(
    "/admin/official-catalog",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (req, res) => {
      if (!requireSaasCommerce(req, res)) return;
      if (!req.user?.isAdmin) {
        res.status(403).json({ error: "Admin required" });
        return;
      }
      try {
        const body = req.body ?? {};
        const entryId = String(body.entryId ?? body.entry_id ?? "").trim();
        const title = String(body.title ?? "").trim();
        const installType = String(body.installType ?? body.install_type ?? "plugin");
        if (!entryId || !title) {
          res.status(400).json({ error: "entryId and title required" });
          return;
        }
        const row = upsertOfficialCatalogEntry(getCloudDb(), {
          entryId,
          title,
          description: body.description,
          version: body.version,
          author: body.author ?? "ReBotics",
          kind: body.kind,
          installType,
          tags: Array.isArray(body.tags) ? body.tags : undefined,
          bundlePath: body.bundlePath ?? body.bundle_path,
          pluginRepo: body.pluginRepo ?? body.plugin_repo,
          pluginRef: body.pluginRef ?? body.plugin_ref,
          pluginDigest: body.pluginDigest ?? body.plugin_digest,
          previewPath: body.previewPath ?? body.preview_path,
          priceCents: body.priceCents ?? body.price_cents,
          currency: body.currency,
          listingId: body.listingId ?? body.listing_id,
          status: body.status,
          sortOrder: body.sortOrder ?? body.sort_order,
          verifiedPublisher:
            typeof body.verifiedPublisher === "boolean"
              ? body.verifiedPublisher
              : typeof body.verified_publisher === "boolean"
                ? body.verified_publisher
                : body.verified_publisher === 0
                  ? false
                  : body.verified_publisher === 1
                    ? true
                    : undefined,
        });
        res.json({ entry: row });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to upsert Official entry",
        });
      }
    }
  );

  /** Import pinned rows from the free Official index; preserves Cloud prices. */
  router.post(
    "/admin/official-catalog/sync-from-public",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    async (req, res) => {
      if (!requireSaasCommerce(req, res)) return;
      if (!req.user?.isAdmin) {
        res.status(403).json({ error: "Admin required" });
        return;
      }
      try {
        const result = await syncOfficialCatalogFromPublicFeed(getCloudDb());
        res.json(result);
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Official catalog sync failed",
        });
      }
    }
  );

  return router;
}

export function marketplaceStripeWebhookHandler(req: Request, res: Response): void {
  if (!config.isSaas) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  const result = handleMarketplaceStripeWebhook(
    getCloudDb(),
    raw,
    req.get("stripe-signature") ?? undefined
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ received: true, orderId: result.orderId });
}

export function marketplacePayPalWebhookHandler(req: Request, res: Response): void {
  if (!config.isSaas) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body =
    typeof req.body === "object" && req.body && !Buffer.isBuffer(req.body)
      ? (req.body as Record<string, unknown>)
      : (JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "{}")) as Record<
          string,
          unknown
        >);
  const result = handleMarketplacePayPalWebhook(getCloudDb(), body);
  res.json({ received: true, orderId: result.orderId });
}
