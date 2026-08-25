import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config.js";
import { getCloudDb } from "../core-db.js";
import { getReqTenantDb } from "../services/auth/middleware.js";
import { requireAuth, resolveTenant, attachAuthContext } from "../services/auth/middleware.js";
import {
  isMarketplaceHubAuthority,
  proxyToCloudHub,
} from "../services/marketplace-hub-client.js";
import { getPublicBillingConfig } from "../services/platform-billing.js";
import {
  exportEntity,
  importEntity,
  type PortableBundle,
} from "../services/portability.js";
import type {
  DeliveryMode,
  MarketplaceListingKind,
  PricingModel,
} from "../core-db.js";
import {
  cancelEntitlement,
  listEntitlementsForBuyer,
} from "../services/entitlements.js";
import {
  createInferenceEndpoint,
  listInferenceEndpoints,
} from "../services/inference-service.js";
import { claimOwnedCommunityCatalogListings } from "../services/marketplace-listings.js";
import { fetchCommunityCatalog, installCatalogEntry } from "../services/marketplace-catalog.js";
import {
  fetchCloudGuestCheckoutStatus,
  fetchCloudGuestDelivery,
  startCloudGuestCheckout,
} from "../services/marketplace-cloud-checkout-client.js";
import {
  fetchRemoteCommunityShelf,
  mergePublicListings,
} from "../services/marketplace-community-shelf.js";
import { githubProjectsStatus } from "../services/github-integration.js";
import { getUserDb } from "../user-registry.js";
import {
  COMMUNITY_VERIFIED_TIER_SQL,
  MARKETPLACE_LISTING_SELLER_JOINS,
  MarketplaceCommerceError,
} from "../services/marketplace-commerce.js";

export const LISTING_COLS = `id, seller_user_id, seller_tenant_id, kind, resource_id,
  title, description, price_credits, price_cents, currency, seller_kind,
  catalog_entry_id, visibility, status, delivery_mode, pricing_model,
  price_period, meter_unit, meter_rate, license, inference_endpoint_id,
  created_at, updated_at`;

/** Listing columns with table alias `ml` plus Community verified tier (#313). */
export const LISTING_COLS_JOINED = `ml.id, ml.seller_user_id, ml.seller_tenant_id, ml.kind, ml.resource_id,
  ml.title, ml.description, ml.price_credits, ml.price_cents, ml.currency, ml.seller_kind,
  ml.catalog_entry_id, ml.visibility, ml.status, ml.delivery_mode, ml.pricing_model,
  ml.price_period, ml.meter_unit, ml.meter_rate, ml.license, ml.inference_endpoint_id,
  ml.created_at, ml.updated_at,
  sa.public_handle AS seller_public_handle,
  (${COMMUNITY_VERIFIED_TIER_SQL}) AS verified_tier,
  CASE WHEN (${COMMUNITY_VERIFIED_TIER_SQL}) > 0 THEN 1 ELSE 0 END AS verified_publisher,
  CASE WHEN sa.stripe_connect_account_id IS NOT NULL
    OR sa.paypal_merchant_id IS NOT NULL
    OR sa.metamask_address IS NOT NULL THEN 1 ELSE 0 END AS payout_ready`;

/** Build the public Community browse query. Defaults to seller_kind=user. */
export function buildPublicListingsSql(opts: {
  kind?: string;
  sellerKind?: string;
}): { sql: string; params: unknown[] } {
  let sql = `SELECT ${LISTING_COLS_JOINED}
             FROM marketplace_listings ml
             ${MARKETPLACE_LISTING_SELLER_JOINS}
             WHERE ml.status='active' AND ml.visibility='public' AND ml.kind != 'plugin'
               AND NOT (ml.catalog_entry_id IS NOT NULL AND COALESCE(ml.delivery_mode,'clone')='clone')`
  const params: unknown[] = [];
  const sellerKind = opts.sellerKind?.trim() || "user";
  if (sellerKind !== "all") {
    sql += ` AND ml.seller_kind=?`;
    params.push(sellerKind);
  }
  if (opts.kind) {
    sql += ` AND ml.kind=?`;
    params.push(opts.kind);
  }
  sql += ` ORDER BY ml.created_at DESC LIMIT 100`;
  return { sql, params };
}

function sellerListingsSql(): string {
  return `SELECT ${LISTING_COLS_JOINED}
         FROM marketplace_listings ml
         ${MARKETPLACE_LISTING_SELLER_JOINS}
         WHERE ml.seller_user_id=?
         ORDER BY ml.created_at DESC`;
}

function sendRouteError(
  res: Response,
  err: unknown,
  fallback: string,
  status = 500
): void {
  const message =
    err instanceof Error && err.message.trim() ? err.message.trim() : fallback;
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
}

async function proxyMarketplaceToHub(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (isMarketplaceHubAuthority()) {
    next();
    return;
  }
  try {
    const hubRes = await proxyToCloudHub(req.originalUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: String(req.headers.cookie ?? ""),
      },
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : JSON.stringify(req.body ?? {}),
      tenantId: req.tenantId,
    });
    const text = await hubRes.text();
    res
      .status(hubRes.status)
      .type(hubRes.headers.get("content-type") ?? "application/json")
      .send(text);
  } catch (err) {
    res.status(503).json({
      error: err instanceof Error ? err.message : "Official hub unavailable",
    });
  }
}

export function createMarketplaceRouter(): Router {
  const router = Router();

  router.use(attachAuthContext, requireAuth, resolveTenant, proxyMarketplaceToHub);

  router.get("/billing/config", (_req, res) => {
    res.json(getPublicBillingConfig());
  });

  router.get("/listings", async (req, res) => {
    try {
      const core = getCloudDb();
      const q =
        typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const kind =
        typeof req.query.kind === "string" ? req.query.kind : undefined;
      const sellerKind =
        typeof req.query.seller_kind === "string" ? req.query.seller_kind : undefined;
      const { sql, params } = buildPublicListingsSql({ kind, sellerKind });
      let rows = core.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const remote = await fetchRemoteCommunityShelf();
      if (remote?.listings.length && (sellerKind ?? "user") !== "official") {
        rows = mergePublicListings(rows, remote.listings);
      }
      if (q) {
        rows = rows.filter(
          (r) =>
            String(r.title ?? "").toLowerCase().includes(q) ||
            String(r.description ?? "").toLowerCase().includes(q)
        );
      }
      if (kind) {
        rows = rows.filter((r) => String(r.kind ?? "") === kind);
      }
      res.json({ listings: rows });
    } catch (err) {
      sendRouteError(res, err, "Failed to load marketplace listings");
    }
  });

  router.get("/my/listings", async (req, res) => {
    try {
      const core = getCloudDb();
      const userId = req.user!.id;
      let githubLogin: string | null = null;
      try {
        githubLogin = githubProjectsStatus(getUserDb(userId), userId).login;
      } catch {
        githubLogin = null;
      }
      let catalogOrphans: Array<{
        id: string;
        title: string;
        author: string;
        priceCents: number;
      }> = [];
      try {
        const { entries } = await fetchCommunityCatalog(core);
        catalogOrphans = claimOwnedCommunityCatalogListings(core, getReqTenantDb(req), {
          sellerUserId: userId,
          sellerTenantId: req.tenantId!,
          githubLogin,
          entries,
        });
      } catch (err) {
        console.warn("[marketplace] community catalog claim skipped:", err);
      }
      const rows = core
        .prepare(sellerListingsSql())
        .all(userId) as Array<Record<string, unknown>>;
      res.json({ listings: rows, catalogOrphans, githubLogin });
    } catch (err) {
      sendRouteError(res, err, "Failed to load seller listings");
    }
  });

  router.get("/entitlements", (req, res) => {
    const core = getCloudDb();
    res.json({
      entitlements: listEntitlementsForBuyer(core, req.user!.id, req.tenantId!),
    });
  });

  router.get("/wallet", (req, res) => {
    res.json({ balance: 0, ledger: [], deprecated: "Credits removed; use Marketplace catalog install" });
  });

  router.get("/inference/endpoints", (req, res) => {
    res.json({ endpoints: listInferenceEndpoints(getCloudDb(), req.user!.id) });
  });

  router.post("/cloud-checkout", async (req, res) => {
    if (config.isSaas) {
      res.status(404).json({ error: "Use Cloud Stripe checkout on this host" });
      return;
    }
    try {
      const listingId = String(req.body?.listingId ?? req.body?.listing_id ?? "").trim();
      const result = await startCloudGuestCheckout({
        listingId,
        successUrl: String(req.body?.successUrl ?? req.body?.success_url ?? ""),
        cancelUrl: String(req.body?.cancelUrl ?? req.body?.cancel_url ?? ""),
        email: typeof req.body?.email === "string" ? req.body.email : undefined,
        tosAccepted: req.body?.tosAccepted === true || req.body?.tos_accepted === true,
      });
      res.json(result);
    } catch (err) {
      const status = err instanceof MarketplaceCommerceError ? err.status : 500;
      sendRouteError(res, err, "Cloud checkout failed", status);
    }
  });

  router.post("/cloud-checkout/complete", async (req, res) => {
    if (config.isSaas) {
      res.status(404).json({ error: "Use Cloud Stripe checkout on this host" });
      return;
    }
    const sessionId = String(req.body?.sessionId ?? req.body?.session_id ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    try {
      const status = await fetchCloudGuestCheckoutStatus(sessionId);
      if (!status.paid) {
        res.status(402).json({ error: "Payment is not complete" });
        return;
      }
      const delivery = await fetchCloudGuestDelivery(sessionId);
      const tenantDb = getReqTenantDb(req);
      if (delivery.catalogEntryId) {
        const installed = await installCatalogEntry(getCloudDb(), tenantDb, {
          userId: req.user!.id,
          tenantId: req.tenantId!,
          entryId: delivery.catalogEntryId,
          paymentVerified: true,
        });
        res.json({ ok: true, deliveryKind: delivery.deliveryKind, install: installed });
        return;
      }
      if (delivery.bundle) {
        const imported = importEntity(tenantDb, delivery.bundle as PortableBundle);
        res.json({ ok: true, deliveryKind: "clone", import: imported });
        return;
      }
      res.status(409).json({
        error: "Paid session has no catalog pin or clone snapshot to install on this machine",
      });
    } catch (err) {
      const status = err instanceof MarketplaceCommerceError ? err.status : 500;
      sendRouteError(res, err, "Cloud delivery failed", status);
    }
  });

  return router;
}
