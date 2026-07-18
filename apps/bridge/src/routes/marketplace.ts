import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config.js";
import { getCoreDb } from "../core-db.js";
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

export const LISTING_COLS = `id, seller_user_id, seller_tenant_id, kind, resource_id,
  title, description, price_credits, price_cents, currency, seller_kind,
  catalog_entry_id, visibility, status, delivery_mode, pricing_model,
  price_period, meter_unit, meter_rate, license, inference_endpoint_id,
  created_at, updated_at`;

/** Build the public Community browse query. Defaults to seller_kind=user. */
export function buildPublicListingsSql(opts: {
  kind?: string;
  sellerKind?: string;
}): { sql: string; params: unknown[] } {
  let sql = `SELECT ${LISTING_COLS}
             FROM marketplace_listings WHERE status='active' AND visibility='public'`;
  const params: unknown[] = [];
  const sellerKind = opts.sellerKind?.trim() || "user";
  if (sellerKind !== "all") {
    sql += ` AND seller_kind=?`;
    params.push(sellerKind);
  }
  if (opts.kind) {
    sql += ` AND kind=?`;
    params.push(opts.kind);
  }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
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
    const core = getCoreDb();
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

  router.get("/my/listings", (req, res) => {
    const core = getCoreDb();
    const rows = core
      .prepare(
        `SELECT ${LISTING_COLS}
         FROM marketplace_listings
         WHERE seller_user_id=? AND status='active'
         ORDER BY created_at DESC`
      )
      .all(req.user!.id) as Array<Record<string, unknown>>;
    res.json({ listings: rows });
  });

  router.get("/entitlements", (req, res) => {
    const core = getCoreDb();
    res.json({
      entitlements: listEntitlementsForBuyer(core, req.user!.id, req.tenantId!),
    });
  });

  router.get("/wallet", (req, res) => {
    res.json({ balance: 0, ledger: [], deprecated: "Credits removed; use Marketplace catalog install" });
  });

  router.get("/inference/endpoints", (req, res) => {
    res.json({ endpoints: listInferenceEndpoints(getCoreDb(), req.user!.id) });
  });

  return router;
}
