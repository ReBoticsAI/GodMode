import { v4 as uuidv4 } from "uuid";
import type {
  CoreDatabase,
  DeliveryMode,
  MarketplaceListingKind,
  PricingModel,
} from "../core-db.js";
import type { AppDatabase } from "../db.js";
import { exportEntity, importEntity, type PortableBundle } from "./portability.js";

export interface PublishMarketplaceListingInput {
  sellerUserId: string;
  sellerTenantId: string;
  kind: MarketplaceListingKind;
  resourceId?: string;
  title?: string;
  description?: string;
  priceCredits?: number;
  deliveryMode?: DeliveryMode;
  pricingModel?: PricingModel;
  pricePeriod?: string;
  meterUnit?: string;
  meterRate?: number;
  license?: string;
  inferenceEndpointId?: string;
  bundleChildren?: PortableBundle[];
}

export function publishMarketplaceListing(
  core: CoreDatabase,
  tenantDb: AppDatabase,
  input: PublishMarketplaceListingInput
): Record<string, unknown> {
  const delivery = input.deliveryMode ?? "clone";
  const pricing = input.pricingModel ?? "one_time";
  let bundleJson = "{}";
  let title = input.title ?? input.kind;
  let endpointId = input.inferenceEndpointId ?? null;

  if (input.kind === "inference") {
    endpointId ??= input.resourceId ?? null;
    if (!endpointId) throw new Error("inferenceEndpointId required for inference listings");
    const endpoint = core
      .prepare(
        `SELECT name FROM inference_endpoints
         WHERE id=? AND owner_user_id=? AND owner_tenant_id=? AND status='active'`
      )
      .get(endpointId, input.sellerUserId, input.sellerTenantId) as
      | { name: string }
      | undefined;
    if (!endpoint) throw Object.assign(new Error("Inference endpoint not found"), { status: 404 });
    title = input.title ?? endpoint.name;
  } else if (input.kind === "bundle") {
    if (!input.bundleChildren?.length) throw new Error("bundleChildren required for bundle listings");
    bundleJson = JSON.stringify({ title, children: input.bundleChildren });
  } else if (delivery === "clone") {
    if (!input.resourceId) throw new Error("resourceId required for clone listings");
    const bundle = exportEntity(tenantDb, input.kind, input.resourceId);
    title = input.title ?? bundle.title;
    bundleJson = JSON.stringify(bundle);
  } else if (!input.resourceId) {
    throw new Error("resourceId required for live listings");
  }

  const id = uuidv4();
  core.prepare(
    `INSERT INTO marketplace_listings
       (id, seller_user_id, seller_tenant_id, kind, resource_id, title, description,
        price_credits, bundle_json, visibility, status, delivery_mode, pricing_model,
        price_period, meter_unit, meter_rate, license, inference_endpoint_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', 'active', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sellerUserId,
    input.sellerTenantId,
    input.kind,
    input.resourceId ?? endpointId ?? id,
    title,
    input.description ?? null,
    Number(input.priceCredits ?? 0),
    bundleJson,
    delivery,
    pricing,
    input.pricePeriod ?? null,
    input.meterUnit ?? null,
    input.meterRate ?? null,
    input.license ?? null,
    endpointId
  );
  return core.prepare("SELECT * FROM marketplace_listings WHERE id=?").get(id) as Record<
    string,
    unknown
  >;
}

export function archiveMarketplaceListing(
  core: CoreDatabase,
  input: { listingId: string; sellerUserId: string; sellerTenantId: string }
): Record<string, unknown> {
  const changed = core
    .prepare(
      `UPDATE marketplace_listings
       SET status='archived', updated_at=datetime('now')
       WHERE id=? AND seller_user_id=? AND seller_tenant_id=? AND status='active'`
    )
    .run(input.listingId, input.sellerUserId, input.sellerTenantId);
  if (!changed.changes) {
    throw Object.assign(new Error("Listing not found"), { status: 404 });
  }
  return core.prepare("SELECT * FROM marketplace_listings WHERE id=?").get(input.listingId) as Record<
    string,
    unknown
  >;
}

export function acquireCloneListing(
  databases: { core: CoreDatabase; buyerTenant: AppDatabase },
  input: {
    listingId: string;
    buyerUserId: string;
    buyerTenantId: string;
    idempotencyKey: string;
  },
  options: CloneAcquisitionOptions = {}
): Record<string, unknown> {
  const { core, buyerTenant } = databases;
  if (!input.idempotencyKey.trim()) throw new Error("idempotencyKey required");
  ensureCloneAcquisitionStorage(core, buyerTenant);

  options.fail?.("before_operation_registered");
  let operation = core
    .prepare(
      `SELECT * FROM marketplace_acquisition_operations
       WHERE buyer_tenant_id=? AND buyer_user_id=? AND idempotency_key=?`
    )
    .get(input.buyerTenantId, input.buyerUserId, input.idempotencyKey) as
    | CloneAcquisitionOperation
    | undefined;

  if (operation) {
    if (operation.listing_id !== input.listingId) {
      throw Object.assign(new Error("Idempotency key reused for a different listing"), {
        status: 409,
      });
    }
  } else {
    const listing = core
      .prepare(
        `SELECT * FROM marketplace_listings
         WHERE id=? AND status='active' AND visibility='public'`
      )
      .get(input.listingId) as Record<string, unknown> | undefined;
    if (!listing) throw Object.assign(new Error("Listing not found"), { status: 404 });
    if (String(listing.delivery_mode ?? "clone") === "live") {
      throw new Error("Live listings must be acquired as entitlements");
    }
    const operationId = uuidv4();
    core.transaction(() => {
      core.prepare(
        `INSERT INTO marketplace_acquisition_operations
         (id, idempotency_key, listing_id, buyer_user_id, buyer_tenant_id,
          listing_bundle_json, listing_title, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'registered')`
      ).run(
        operationId,
        input.idempotencyKey,
        input.listingId,
        input.buyerUserId,
        input.buyerTenantId,
        String(listing.bundle_json),
        String(listing.title)
      );
      recordCoreAcquisitionStep(core, operationId, "operation_registered", {
        listingId: input.listingId,
      });
    })();
    operation = getCloneAcquisitionOperation(core, operationId);
  }
  options.fail?.("after_operation_registered");

  let imported = buyerTenant
    .prepare(
      `SELECT imported_kind, imported_id FROM marketplace_acquisition_imports
       WHERE operation_id=? AND buyer_tenant_id=?`
    )
    .get(operation.id, input.buyerTenantId) as
    | { imported_kind: string; imported_id: string }
    | undefined;
  if (!imported) {
    options.fail?.("before_tenant_imported");
    const bundle = parseListingBundle(
      operation.listing_bundle_json,
      operation.listing_id,
      operation.listing_title
    );
    const result = buyerTenant.transaction(() => {
      const importedEntity = importEntity(buyerTenant, bundle);
      buyerTenant.prepare(
        `INSERT INTO marketplace_acquisition_imports
         (operation_id, buyer_tenant_id, listing_id, imported_kind, imported_id)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        operation!.id,
        input.buyerTenantId,
        input.listingId,
        importedEntity.kind,
        importedEntity.newId
      );
      recordTenantAcquisitionStep(buyerTenant, operation!.id, input.buyerTenantId, {
        kind: importedEntity.kind,
        newId: importedEntity.newId,
      });
      return {
        imported_kind: importedEntity.kind,
        imported_id: importedEntity.newId,
      };
    })();
    imported = result;
  }
  options.fail?.("after_tenant_imported");

  if (operation.status === "registered") {
    core.transaction(() => {
      core.prepare(
        `UPDATE marketplace_acquisition_operations
         SET status='tenant_imported', imported_kind=?, imported_id=?,
             updated_at=datetime('now')
         WHERE id=? AND status='registered'`
      ).run(imported!.imported_kind, imported!.imported_id, operation!.id);
      recordCoreAcquisitionStep(core, operation!.id, "tenant_imported", {
        kind: imported!.imported_kind,
        newId: imported!.imported_id,
      });
    })();
    operation = getCloneAcquisitionOperation(core, operation.id);
  }

  options.fail?.("before_purchase_recorded");
  if (operation.status === "tenant_imported") {
    const purchaseId = operation.id;
    core.transaction(() => {
      core.prepare(
        `INSERT OR IGNORE INTO marketplace_purchases
         (id, listing_id, buyer_user_id, buyer_tenant_id, price_credits)
         VALUES (?, ?, ?, ?, 0)`
      ).run(
        purchaseId,
        operation!.listing_id,
        operation!.buyer_user_id,
        operation!.buyer_tenant_id
      );
      core.prepare(
        `UPDATE marketplace_acquisition_operations
         SET status='purchase_recorded', purchase_id=?, updated_at=datetime('now')
         WHERE id=? AND status='tenant_imported'`
      ).run(purchaseId, operation!.id);
      recordCoreAcquisitionStep(core, operation!.id, "purchase_recorded", {
        purchaseId,
      });
    })();
    operation = getCloneAcquisitionOperation(core, operation.id);
  }
  options.fail?.("after_purchase_recorded");

  options.fail?.("before_completed");
  if (operation.status === "purchase_recorded") {
    core.transaction(() => {
      core.prepare(
        `UPDATE marketplace_acquisition_operations
         SET status='completed', completed_at=datetime('now'), updated_at=datetime('now')
         WHERE id=? AND status='purchase_recorded'`
      ).run(operation!.id);
      recordCoreAcquisitionStep(core, operation!.id, "completed", {
        purchaseId: operation!.purchase_id,
      });
    })();
    operation = getCloneAcquisitionOperation(core, operation.id);
  }
  options.fail?.("after_completed");

  return {
    ok: true,
    mode: "clone",
    operationId: operation.id,
    status: operation.status,
    purchaseId: operation.purchase_id,
    import: {
      kind: imported.imported_kind,
      newId: imported.imported_id,
    },
  };
}

export type CloneAcquisitionFailurePoint =
  | "before_operation_registered"
  | "after_operation_registered"
  | "before_tenant_imported"
  | "after_tenant_imported"
  | "before_purchase_recorded"
  | "after_purchase_recorded"
  | "before_completed"
  | "after_completed";

export interface CloneAcquisitionOptions {
  /** Test-only crash boundary hook; production callers leave this unset. */
  fail?: (point: CloneAcquisitionFailurePoint) => void;
}

interface CloneAcquisitionOperation {
  id: string;
  idempotency_key: string;
  listing_id: string;
  buyer_user_id: string;
  buyer_tenant_id: string;
  listing_bundle_json: string;
  listing_title: string;
  status: "registered" | "tenant_imported" | "purchase_recorded" | "completed";
  imported_kind: string | null;
  imported_id: string | null;
  purchase_id: string | null;
}

function ensureCloneAcquisitionStorage(
  core: CoreDatabase,
  buyerTenant: AppDatabase
): void {
  core.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_operations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      buyer_tenant_id TEXT NOT NULL,
      listing_bundle_json TEXT NOT NULL,
      listing_title TEXT NOT NULL,
      status TEXT NOT NULL,
      imported_kind TEXT,
      imported_id TEXT,
      purchase_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      UNIQUE (buyer_tenant_id, buyer_user_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_steps (
      operation_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (operation_id, step_name)
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_audit (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      owner_database TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_outbox (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  buyerTenant.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_imports (
      operation_id TEXT PRIMARY KEY,
      buyer_tenant_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      imported_kind TEXT NOT NULL,
      imported_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_audit (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      owner_database TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_outbox (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getCloneAcquisitionOperation(
  core: CoreDatabase,
  operationId: string
): CloneAcquisitionOperation {
  const operation = core
    .prepare(`SELECT * FROM marketplace_acquisition_operations WHERE id=?`)
    .get(operationId) as CloneAcquisitionOperation | undefined;
  if (!operation) throw new Error(`Acquisition operation not found: ${operationId}`);
  return operation;
}

function parseListingBundle(
  bundleJson: string,
  listingId: string,
  listingTitle: string
): PortableBundle {
  const parsed = JSON.parse(bundleJson) as PortableBundle | { children?: PortableBundle[] };
  return "version" in parsed && parsed.version === 1
    ? parsed
    : {
        version: 1,
        kind: "bundle",
        exportedAt: new Date().toISOString(),
        sourceId: listingId,
        title: listingTitle,
        data: { children: (parsed as { children?: PortableBundle[] }).children ?? [] },
      };
}

function recordCoreAcquisitionStep(
  core: CoreDatabase,
  operationId: string,
  step: string,
  payload: Record<string, unknown>
): void {
  const operation = getCloneAcquisitionOperation(core, operationId);
  const payloadJson = JSON.stringify(payload);
  core.prepare(
    `INSERT OR IGNORE INTO marketplace_acquisition_steps
     (operation_id, step_name, payload_json) VALUES (?, ?, ?)`
  ).run(operationId, step, payloadJson);
  core.prepare(
    `INSERT OR IGNORE INTO marketplace_acquisition_audit
     (id, operation_id, owner_database, tenant_id, action, payload_json)
     VALUES (?, ?, 'core', ?, ?, ?)`
  ).run(`${operationId}:core:${step}`, operationId, operation.buyer_tenant_id, step, payloadJson);
  core.prepare(
    `INSERT OR IGNORE INTO marketplace_acquisition_outbox
     (id, operation_id, tenant_id, event_type, payload_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    `${operationId}:core:${step}`,
    operationId,
    operation.buyer_tenant_id,
    `marketplace.acquisition.${step}`,
    payloadJson
  );
}

function recordTenantAcquisitionStep(
  buyerTenant: AppDatabase,
  operationId: string,
  buyerTenantId: string,
  payload: Record<string, unknown>
): void {
  const payloadJson = JSON.stringify(payload);
  buyerTenant.prepare(
    `INSERT OR IGNORE INTO marketplace_acquisition_audit
     (id, operation_id, owner_database, tenant_id, action, payload_json)
     VALUES (?, ?, 'tenant', ?, 'tenant_imported', ?)`
  ).run(`${operationId}:tenant:tenant_imported`, operationId, buyerTenantId, payloadJson);
  buyerTenant.prepare(
    `INSERT OR IGNORE INTO marketplace_acquisition_outbox
     (id, operation_id, tenant_id, event_type, payload_json)
     VALUES (?, ?, ?, 'marketplace.acquisition.tenant_imported', ?)`
  ).run(`${operationId}:tenant:tenant_imported`, operationId, buyerTenantId, payloadJson);
}
