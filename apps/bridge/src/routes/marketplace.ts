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
import {
  acquireCloneListing,
  publishMarketplaceListing,
} from "../services/marketplace-listings.js";
import { fetchCommunityCatalog } from "../services/marketplace-catalog.js";
import { sellerOwnsCatalogEntry } from "../services/marketplace-listing-policy.js";
import { githubProjectsStatus } from "../services/github-integration.js";
import { getUserDb } from "../user-registry.js";
import { COMMUNITY_VERIFIED_TIER_SQL } from "../services/marketplace-commerce.js";

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
             LEFT JOIN marketplace_seller_accounts sa ON sa.user_id = ml.seller_user_id
             WHERE ml.status='active' AND ml.visibility='public' AND ml.kind != 'plugin'`;
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

  router.get("/listings", (req, res) => {
    const core = getCloudDb();
    const q =
      typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const kind =
      typeof req.query.kind === "string" ? req.query.kind : undefined;
    const sellerKind =
      typeof req.query.seller_kind === "string" ? req.query.seller_kind : undefined;
    const { sql, params } = buildPublicListingsSql({ kind, sellerKind });
    let rows = core.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.title ?? "").toLowerCase().includes(q) ||
          String(r.description ?? "").toLowerCase().includes(q)
      );
    }
    res.json({ listings: rows });
  });

  router.get("/my/listings", async (req, res) => {
    const core = getCloudDb();
    const userId = req.user!.id;
    const catalogOrphans: Array<{
      id: string;
      title: string;
      author: string;
      priceCents: number;
    }> = [];
    let githubLogin: string | null = null;
    try {
      githubLogin = githubProjectsStatus(getUserDb(userId), userId).login;
      const { entries } = await fetchCommunityCatalog(core);
      const claimed = new Set(
        (
          core
            .prepare(
              `SELECT catalog_entry_id FROM marketplace_listings
               WHERE seller_user_id=? AND catalog_entry_id IS NOT NULL AND status != 'archived'`
            )
            .all(userId) as Array<{ catalog_entry_id: string }>
        ).map((r) => r.catalog_entry_id)
      );
      const tenantDb = getReqTenantDb(req);
      for (const entry of entries) {
        if (claimed.has(entry.id)) continue;
        if (!sellerOwnsCatalogEntry(entry, githubLogin)) continue;
        try {
          publishMarketplaceListing(core, tenantDb, {
            sellerUserId: userId,
            sellerTenantId: req.tenantId!,
            kind: "plugin",
            catalogEntryId: entry.id,
            title: entry.title,
            description: entry.description,
            priceCents: Number(entry.priceCents ?? 0),
            sellerKind: "user",
          });
        } catch {
          catalogOrphans.push({
            id: entry.id,
            title: entry.title,
            author: entry.author,
            priceCents: Number(entry.priceCents ?? 0),
          });
        }
      }
    } catch {
      /* Community catalog is optional for the seller dashboard */
    }
    const rows = core
      .prepare(
        `SELECT ${LISTING_COLS_JOINED}
         FROM marketplace_listings ml
         LEFT JOIN marketplace_seller_accounts sa ON sa.user_id = ml.seller_user_id
         WHERE ml.seller_user_id=?
         ORDER BY ml.created_at DESC`
      )
      .all(userId) as Array<Record<string, unknown>>;
    res.json({ listings: rows, catalogOrphans, githubLogin });
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

  return router;
}
