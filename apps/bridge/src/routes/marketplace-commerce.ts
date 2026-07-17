import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  buildPublicOfficialCatalog,
  listOfficialCatalogRows,
  upsertOfficialCatalogEntry,
} from "../services/marketplace-official-catalog.js";
import {
  handleMarketplacePayPalWebhook,
  handleMarketplaceStripeWebhook,
} from "../services/marketplace-payments.js";
import { getPublicCommerceConfig } from "../services/marketplace-commerce.js";

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

  router.get("/commerce/config", (_req, res) => {
    res.json(getPublicCommerceConfig());
  });

  /** Unauthenticated Official catalog JSON for local/private-hub pulls. */
  router.get("/catalog/official/public", async (_req, res) => {
    try {
      if (!config.isSaas && !config.isHub) {
        // Still allow local hub/dev to serve curated rows when present.
      }
      const index = await buildPublicOfficialCatalog(getCoreDb());
      res.json(index);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load Official catalog",
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
      const order = await capturePayPalOrder(getCoreDb(), paypalOrderId);
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
      res.json({ entries: listOfficialCatalogRows(getCoreDb()) });
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
        const row = upsertOfficialCatalogEntry(getCoreDb(), {
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
          previewPath: body.previewPath ?? body.preview_path,
          priceCents: body.priceCents ?? body.price_cents,
          currency: body.currency,
          listingId: body.listingId ?? body.listing_id,
          status: body.status,
          sortOrder: body.sortOrder ?? body.sort_order,
        });
        res.json({ entry: row });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to upsert Official entry",
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
    getCoreDb(),
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
  const result = handleMarketplacePayPalWebhook(getCoreDb(), body);
  res.json({ received: true, orderId: result.orderId });
}
