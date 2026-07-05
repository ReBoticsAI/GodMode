import { Router, type Request, type Response, type NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
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

const LISTING_COLS = `id, seller_user_id, seller_tenant_id, kind, resource_id,
  title, description, price_credits, visibility, status,
  delivery_mode, pricing_model, price_period, meter_unit, meter_rate,
  license, inference_endpoint_id, created_at`;

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
    let sql = `SELECT ${LISTING_COLS}
               FROM marketplace_listings WHERE status='active' AND visibility='public'`;
    const params: unknown[] = [];
    if (kind) {
      sql += ` AND kind=?`;
      params.push(kind);
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
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

  router.post("/entitlements/:id/cancel", (req, res) => {
    try {
      cancelEntitlement(getCoreDb(), String(req.params.id), req.user!.id);
      res.json({ ok: true });
    } catch (err) {
      const status = err instanceof Error && "status" in err ? Number((err as { status: number }).status) : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : "Cancel failed" });
    }
  });

  router.get("/wallet", (req, res) => {
    res.json({ balance: 0, ledger: [], deprecated: "Credits removed; use Marketplace catalog install" });
  });

  router.post("/wallet/purchase", (_req, res) => {
    res.status(410).json({ error: "Marketplace credits removed; install packs from the catalog for free" });
  });

  router.post("/wallet/checkout", (_req, res) => {
    res.status(410).json({ error: "Marketplace credits removed; install packs from the catalog for free" });
  });

  router.get("/inference/endpoints", (req, res) => {
    res.json({ endpoints: listInferenceEndpoints(getCoreDb(), req.user!.id) });
  });

  router.post("/inference/endpoints", (req, res) => {
    const { name, baseModelPath, adapterIds, meterUnit, meterRate, capacityHint } =
      req.body ?? {};
    if (typeof name !== "string" || typeof baseModelPath !== "string") {
      res.status(400).json({ error: "name and baseModelPath required" });
      return;
    }
    const id = createInferenceEndpoint(getCoreDb(), {
      ownerTenantId: req.tenantId!,
      ownerUserId: req.user!.id,
      name,
      baseModelPath,
      adapterIds: Array.isArray(adapterIds) ? adapterIds.map(String) : undefined,
      meterUnit: typeof meterUnit === "string" ? meterUnit : undefined,
      meterRate: meterRate != null ? Number(meterRate) : undefined,
      capacityHint: capacityHint != null ? Number(capacityHint) : undefined,
    });
    res.status(201).json({ id });
  });

  router.post("/listings", (req, res) => {
    const {
      kind,
      resourceId,
      title,
      description,
      priceCredits,
      deliveryMode,
      pricingModel,
      pricePeriod,
      meterUnit,
      meterRate,
      license,
      inferenceEndpointId,
      bundleChildren,
    } = req.body ?? {};
    if (typeof kind !== "string") {
      res.status(400).json({ error: "kind required" });
      return;
    }
    const delivery = (deliveryMode ?? "clone") as DeliveryMode;
    const pricing = (pricingModel ?? "one_time") as PricingModel;
    const db = getReqTenantDb(req);
    const core = getCoreDb();
    let bundleJson = "{}";
    let listingTitle = typeof title === "string" ? title : kind;
    let endpointId =
      typeof inferenceEndpointId === "string" ? inferenceEndpointId : null;

    if (kind === "inference") {
      if (!endpointId && typeof resourceId === "string") {
        endpointId = resourceId;
      }
      if (!endpointId) {
        res.status(400).json({ error: "inferenceEndpointId required for inference listings" });
        return;
      }
      const ep = core
        .prepare(`SELECT name FROM inference_endpoints WHERE id=? AND owner_user_id=?`)
        .get(endpointId, req.user!.id) as { name: string } | undefined;
      if (!ep) {
        res.status(404).json({ error: "Inference endpoint not found" });
        return;
      }
      listingTitle = typeof title === "string" ? title : ep.name;
      bundleJson = "{}";
    } else if (kind === "bundle") {
      const children = Array.isArray(bundleChildren)
        ? (bundleChildren as PortableBundle[])
        : [];
      if (!children.length) {
        res.status(400).json({ error: "bundleChildren required for bundle listings" });
        return;
      }
      bundleJson = JSON.stringify({ title: listingTitle, children });
    } else if (delivery === "clone") {
      if (typeof resourceId !== "string") {
        res.status(400).json({ error: "resourceId required for clone listings" });
        return;
      }
      try {
        const bundle = exportEntity(db, kind as MarketplaceListingKind, resourceId);
        listingTitle = typeof title === "string" ? title : bundle.title;
        bundleJson = JSON.stringify(bundle);
      } catch (err) {
        res.status(404).json({ error: err instanceof Error ? err.message : "Export failed" });
        return;
      }
    } else if (typeof resourceId !== "string") {
      res.status(400).json({ error: "resourceId required for live listings" });
      return;
    }

    const id = uuidv4();
    core.prepare(
      `INSERT INTO marketplace_listings
         (id, seller_user_id, seller_tenant_id, kind, resource_id, title, description,
          price_credits, bundle_json, visibility, status,
          delivery_mode, pricing_model, price_period, meter_unit, meter_rate, license,
          inference_endpoint_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', 'active', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user!.id,
      req.tenantId!,
      kind,
      typeof resourceId === "string" ? resourceId : endpointId ?? id,
      listingTitle,
      typeof description === "string" ? description : null,
      Number(priceCredits ?? 0),
      bundleJson,
      delivery,
      pricing,
      typeof pricePeriod === "string" ? pricePeriod : null,
      typeof meterUnit === "string" ? meterUnit : null,
      meterRate != null ? Number(meterRate) : null,
      typeof license === "string" ? license : null,
      endpointId
    );
    res.status(201).json({ id });
  });

  router.post("/listings/:id/acquire", (req, res) => {
    const core = getCoreDb();
    const listing = core
      .prepare("SELECT * FROM marketplace_listings WHERE id=? AND status='active'")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!listing) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }
    const deliveryMode = String(listing.delivery_mode ?? "clone");
    const buyerDb = getReqTenantDb(req);

    try {
      if (deliveryMode === "live") {
        res.status(400).json({
          error: "Live listings use Shared grants, not marketplace acquire",
        });
        return;
      }

      const parsed = JSON.parse(String(listing.bundle_json)) as
        | PortableBundle
        | { children?: PortableBundle[] };
      const bundle: PortableBundle =
        "version" in parsed && parsed.version === 1
          ? parsed
          : {
              version: 1,
              kind: "bundle",
              exportedAt: new Date().toISOString(),
              sourceId: String(listing.id),
              title: String(listing.title),
              data: { children: (parsed as { children?: PortableBundle[] }).children ?? [] },
            };
      const result = importEntity(buyerDb, bundle);
      core.prepare(
        `INSERT INTO marketplace_purchases
           (id, listing_id, buyer_user_id, buyer_tenant_id, price_credits)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), listing.id, req.user!.id, req.tenantId!, 0);
      res.json({ ok: true, mode: "clone", import: result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Acquire failed" });
    }
  });

  router.post("/import", (req, res) => {
    const bundle = req.body?.bundle as PortableBundle | undefined;
    if (!bundle || bundle.version !== 1) {
      res.status(400).json({ error: "Invalid bundle" });
      return;
    }
    try {
      const result = importEntity(getReqTenantDb(req), bundle);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Import failed" });
    }
  });

  router.post("/export", (req, res) => {
    const { kind, resourceId } = req.body ?? {};
    if (typeof kind !== "string" || typeof resourceId !== "string") {
      res.status(400).json({ error: "kind and resourceId required" });
      return;
    }
    try {
      const bundle = exportEntity(
        getReqTenantDb(req),
        kind as MarketplaceListingKind,
        resourceId
      );
      res.json({ bundle });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Export failed" });
    }
  });

  return router;
}
