import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import type { CoreDatabase } from "../core-db.js";
import type { CatalogEntry, CatalogIndex } from "./marketplace-catalog.js";
import {
  fetchOfficialCatalog,
  withOfficialVerifiedPublisher,
} from "./marketplace-catalog.js";
import {
  assertPluginInstallPin,
  isFloatingPluginRef,
  normalizePluginRef,
} from "./marketplace-plugin-pin.js";

export type OfficialCatalogRow = {
  entry_id: string;
  title: string;
  description: string | null;
  version: string | null;
  author: string | null;
  kind: string | null;
  install_type: string;
  tags_json: string | null;
  bundle_path: string | null;
  plugin_repo: string | null;
  plugin_ref: string | null;
  plugin_digest: string | null;
  preview_path: string | null;
  price_cents: number;
  currency: string;
  listing_id: string | null;
  status: string;
  sort_order: number;
  updated_at: string;
  /** 1 = verified (default), 0 = not verified (#309). */
  verified_publisher?: number | null;
};

export type OfficialCatalogPinIssue = {
  entryId: string;
  title: string;
  status: string;
  installType: string;
  pluginRef: string | null;
  pluginDigest: string | null;
  issue: "missing_ref" | "floating_ref" | "invalid_digest";
  message: string;
};

type OfficialDefaultPrice = { priceCents: number; currency: string };

function officialDefaultPricesPath(): string {
  const override = process.env.GODMODE_OFFICIAL_DEFAULT_PRICES_PATH?.trim();
  if (override) return path.resolve(override);
  const fromRepo = path.join(
    config.repoRoot,
    "apps",
    "bridge",
    "data",
    "marketplace-official-default-prices.json"
  );
  if (fs.existsSync(fromRepo)) return fromRepo;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data/marketplace-official-default-prices.json");
}

let cachedOfficialDefaultPrices: Map<string, OfficialDefaultPrice> | null = null;

/** Cloud commerce defaults for Official SKUs (GitHub index carries pins only). */
export function loadOfficialCatalogDefaultPrices(): Map<string, OfficialDefaultPrice> {
  if (cachedOfficialDefaultPrices) return cachedOfficialDefaultPrices;
  const file = officialDefaultPricesPath();
  if (!fs.existsSync(file)) {
    cachedOfficialDefaultPrices = new Map();
    return cachedOfficialDefaultPrices;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
    string,
    { priceCents?: number; currency?: string }
  >;
  const map = new Map<string, OfficialDefaultPrice>();
  for (const [entryId, row] of Object.entries(raw)) {
    const priceCents = Math.max(0, Math.floor(Number(row?.priceCents ?? 0)));
    if (priceCents <= 0) continue;
    map.set(entryId, {
      priceCents,
      currency: String(row?.currency ?? "usd").toLowerCase(),
    });
  }
  cachedOfficialDefaultPrices = map;
  return map;
}

export function resolveOfficialCatalogDefaultPrice(
  entryId: string,
  fallbackCents = 0
): OfficialDefaultPrice | null {
  const fromFeed = Math.max(0, Math.floor(Number(fallbackCents ?? 0)));
  if (fromFeed > 0) {
    return { priceCents: fromFeed, currency: "usd" };
  }
  return loadOfficialCatalogDefaultPrices().get(entryId) ?? null;
}

export function applyOfficialCatalogDefaultPrices(core: CoreDatabase): number {
  const defaults = loadOfficialCatalogDefaultPrices();
  if (defaults.size === 0) return 0;
  let updated = 0;
  for (const [entryId, price] of defaults) {
    const result = core
      .prepare(
        `UPDATE marketplace_official_catalog
         SET price_cents=?, currency=?, updated_at=datetime('now')
         WHERE entry_id=? AND price_cents=0`
      )
      .run(price.priceCents, price.currency, entryId);
    updated += result.changes;
  }
  return updated;
}

function countActiveOfficialCatalogRows(core: CoreDatabase): number {
  const row = core
    .prepare(`SELECT COUNT(*) AS n FROM marketplace_official_catalog WHERE status='active'`)
    .get() as { n: number };
  return Number(row?.n ?? 0);
}

/**
 * SaaS: import pinned Official rows when the curated table is empty, then apply
 * default Cloud prices where price_cents is still zero.
 */
export async function ensureOfficialCatalogHydrated(core: CoreDatabase): Promise<{
  synced: boolean;
  defaultPricesApplied: number;
}> {
  if (!config.isSaas) {
    return { synced: false, defaultPricesApplied: 0 };
  }
  let synced = false;
  if (countActiveOfficialCatalogRows(core) === 0) {
    await syncOfficialCatalogFromPublicFeed(core);
    synced = true;
  }
  const defaultPricesApplied = applyOfficialCatalogDefaultPrices(core);
  return { synced, defaultPricesApplied };
}

export type OfficialCatalogUpsertInput = {
  entryId: string;
  title: string;
  description?: string;
  version?: string;
  author?: string;
  kind?: string;
  installType: string;
  tags?: string[];
  bundlePath?: string;
  pluginRepo?: string;
  pluginRef?: string;
  pluginDigest?: string;
  previewPath?: string;
  priceCents?: number;
  currency?: string;
  listingId?: string | null;
  status?: string;
  sortOrder?: number;
  /** Explicit false clears the Verified badge; omit/true keeps Official default (#309). */
  verifiedPublisher?: boolean;
};

export function getOfficialCatalogEntryPrice(
  core: CoreDatabase,
  entryId: string
): { priceCents: number; currency: string; listingId: string | null } | null {
  const row = core
    .prepare(
      `SELECT price_cents, currency, listing_id, status FROM marketplace_official_catalog WHERE entry_id=?`
    )
    .get(entryId) as
    | { price_cents: number; currency: string; listing_id: string | null; status: string }
    | undefined;
  if (!row || row.status !== "active") return null;
  return {
    priceCents: Number(row.price_cents ?? 0),
    currency: String(row.currency || "usd"),
    listingId: row.listing_id,
  };
}

/**
 * Active Official plugin rows must carry an immutable pluginRef (#292 / #177).
 * Inactive / draft rows may omit a pin while operators prepare the listing.
 */
export function assertOfficialCatalogPluginPinForUpsert(
  entry: OfficialCatalogUpsertInput
): void {
  const installType = String(entry.installType || "plugin").toLowerCase();
  const status = String(entry.status ?? "active").toLowerCase();
  if (installType !== "plugin" || status !== "active") return;

  assertPluginInstallPin(
    {
      id: entry.entryId,
      kind: entry.kind ?? "plugin",
      installType: "plugin",
      title: entry.title,
      description: entry.description ?? "",
      version: entry.version ?? "0.0.0",
      author: entry.author ?? "ReBotics",
      pluginRepo: entry.pluginRepo,
      pluginRef: entry.pluginRef,
      pluginDigest: entry.pluginDigest,
      sourceName: "Official",
    },
    "required"
  );
}

export function auditOfficialCatalogPluginPins(
  rows: OfficialCatalogRow[]
): OfficialCatalogPinIssue[] {
  const issues: OfficialCatalogPinIssue[] = [];
  for (const row of rows) {
    if (String(row.install_type).toLowerCase() !== "plugin") continue;
    if (String(row.status).toLowerCase() !== "active") continue;

    const ref = normalizePluginRef(row.plugin_ref);
    if (isFloatingPluginRef(ref)) {
      issues.push({
        entryId: row.entry_id,
        title: row.title,
        status: row.status,
        installType: row.install_type,
        pluginRef: row.plugin_ref,
        pluginDigest: row.plugin_digest,
        issue: ref ? "floating_ref" : "missing_ref",
        message: ref
          ? `Floating pluginRef "${ref}" is not allowed for active Official plugins (#177).`
          : `Active Official plugin "${row.entry_id}" is missing pluginRef (tag or commit).`,
      });
    }

    const digest = normalizePluginRef(row.plugin_digest);
    if (digest && !/^[0-9a-f]{7,40}$/i.test(digest)) {
      issues.push({
        entryId: row.entry_id,
        title: row.title,
        status: row.status,
        installType: row.install_type,
        pluginRef: row.plugin_ref,
        pluginDigest: row.plugin_digest,
        issue: "invalid_digest",
        message: `pluginDigest must be a hex commit sha (got "${digest}").`,
      });
    }
  }
  return issues;
}

export function upsertOfficialCatalogEntry(
  core: CoreDatabase,
  entry: OfficialCatalogUpsertInput
): OfficialCatalogRow {
  assertOfficialCatalogPluginPinForUpsert(entry);
  const verifiedPublisher =
    entry.verifiedPublisher === false
      ? 0
      : entry.verifiedPublisher === true
        ? 1
        : (() => {
            const existing = core
              .prepare(
                `SELECT verified_publisher FROM marketplace_official_catalog WHERE entry_id=?`
              )
              .get(entry.entryId) as { verified_publisher?: number | null } | undefined;
            if (existing && typeof existing.verified_publisher === "number") {
              return existing.verified_publisher ? 1 : 0;
            }
            // Official is ReBotics-curated (#315); Verified badges are for Community sellers.
            return 0;
          })();
  core
    .prepare(
      `INSERT INTO marketplace_official_catalog
         (entry_id, title, description, version, author, kind, install_type, tags_json,
          bundle_path, plugin_repo, plugin_ref, plugin_digest, preview_path, price_cents, currency,
          listing_id, status, sort_order, verified_publisher, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(entry_id) DO UPDATE SET
         title=excluded.title,
         description=excluded.description,
         version=excluded.version,
         author=excluded.author,
         kind=excluded.kind,
         install_type=excluded.install_type,
         tags_json=excluded.tags_json,
         bundle_path=excluded.bundle_path,
         plugin_repo=excluded.plugin_repo,
         plugin_ref=excluded.plugin_ref,
         plugin_digest=excluded.plugin_digest,
         preview_path=excluded.preview_path,
         price_cents=excluded.price_cents,
         currency=excluded.currency,
         listing_id=excluded.listing_id,
         status=excluded.status,
         sort_order=excluded.sort_order,
         verified_publisher=excluded.verified_publisher,
         updated_at=datetime('now')`
    )
    .run(
      entry.entryId,
      entry.title,
      entry.description ?? null,
      entry.version ?? null,
      entry.author ?? null,
      entry.kind ?? null,
      entry.installType,
      entry.tags ? JSON.stringify(entry.tags) : null,
      entry.bundlePath ?? null,
      entry.pluginRepo ?? null,
      entry.pluginRef ?? null,
      entry.pluginDigest ?? null,
      entry.previewPath ?? null,
      Math.max(0, Math.floor(Number(entry.priceCents ?? 0))),
      (entry.currency ?? "usd").toLowerCase(),
      entry.listingId ?? null,
      entry.status ?? "active",
      entry.sortOrder ?? 0,
      verifiedPublisher
    );
  return core
    .prepare(`SELECT * FROM marketplace_official_catalog WHERE entry_id=?`)
    .get(entry.entryId) as OfficialCatalogRow;
}

function rowToCatalogEntry(row: OfficialCatalogRow, sourceCatalog: string): CatalogEntry {
  let tags: string[] | undefined;
  if (row.tags_json) {
    try {
      tags = JSON.parse(row.tags_json) as string[];
    } catch {
      tags = undefined;
    }
  }
  return withOfficialVerifiedPublisher({
    id: row.entry_id,
    kind: row.kind ?? "plugin",
    installType: (row.install_type === "clone" ? "clone" : "plugin") as "clone" | "plugin",
    title: row.title,
    description: row.description ?? "",
    version: row.version ?? "0.0.0",
    author: row.author ?? "ReBotics",
    tags,
    bundlePath: row.bundle_path ?? undefined,
    pluginRepo: row.plugin_repo ?? undefined,
    pluginRef: row.plugin_ref ?? undefined,
    pluginDigest: row.plugin_digest ?? undefined,
    previewPath: row.preview_path ?? undefined,
    sourceCatalog,
    sourceName: "Official",
    priceCents: Number(row.price_cents ?? 0),
    currency: row.currency || "usd",
    listingId: row.listing_id ?? undefined,
    verifiedPublisher: row.verified_publisher === 0 ? false : true,
  });
}

/**
 * Public Official catalog for SaaS and remote installs.
 * Prefer curated SaaS rows; fall back to GitHub/local free catalog with price_cents=0.
 */
export async function buildPublicOfficialCatalog(
  core: CoreDatabase
): Promise<CatalogIndex & { commerceHost?: string }> {
  if (config.isSaas) {
    await ensureOfficialCatalogHydrated(core);
  }

  const rows = core
    .prepare(
      `SELECT * FROM marketplace_official_catalog
       WHERE status='active'
       ORDER BY sort_order ASC, title ASC`
    )
    .all() as OfficialCatalogRow[];

  const sourceCatalog = "saas-official";
  if (rows.length > 0) {
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      repoBase: config.marketplace.saasOfficialCatalogUrl || undefined,
      entries: rows.map((r) => rowToCatalogEntry(r, sourceCatalog)),
      commerceHost: config.isSaas ? "local" : undefined,
    };
  }

  if (config.isSaas) {
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      repoBase: config.marketplace.saasOfficialCatalogUrl || undefined,
      entries: [],
      commerceHost: "local",
    };
  }

  const fallback = await fetchOfficialCatalog();
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    repoBase: fallback.url,
    entries: fallback.entries.map((e) =>
      withOfficialVerifiedPublisher({
        ...e,
        priceCents: 0,
        currency: "usd",
      })
    ),
  };
}

export function listOfficialCatalogRows(core: CoreDatabase): OfficialCatalogRow[] {
  return core
    .prepare(
      `SELECT * FROM marketplace_official_catalog ORDER BY sort_order ASC, title ASC`
    )
    .all() as OfficialCatalogRow[];
}

/**
 * Import pinned plugin (and pack) rows from the free Official index into the
 * curated SaaS table. Preserves existing Cloud price_cents / listing_id / sort_order.
 */
export async function syncOfficialCatalogFromPublicFeed(core: CoreDatabase): Promise<{
  upserted: string[];
  skipped: Array<{ id: string; reason: string }>;
  pinAudit: OfficialCatalogPinIssue[];
  sourceUrl: string;
}> {
  const { url, entries } = await fetchOfficialCatalog();
  const upserted: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const entry of entries) {
    const installType = String(entry.installType || "plugin");
    if (installType === "plugin" && isFloatingPluginRef(entry.pluginRef)) {
      skipped.push({
        id: entry.id,
        reason: "floating or missing pluginRef (fail closed for Official plugins)",
      });
      continue;
    }

    const existing = core
      .prepare(`SELECT * FROM marketplace_official_catalog WHERE entry_id=?`)
      .get(entry.id) as OfficialCatalogRow | undefined;

    const defaultPrice = existing
      ? null
      : resolveOfficialCatalogDefaultPrice(entry.id, entry.priceCents ?? 0);
    upsertOfficialCatalogEntry(core, {
      entryId: entry.id,
      title: entry.title,
      description: entry.description,
      version: entry.version,
      author: entry.author,
      kind: entry.kind,
      installType,
      tags: entry.tags,
      bundlePath: entry.bundlePath,
      pluginRepo: entry.pluginRepo,
      pluginRef: entry.pluginRef,
      pluginDigest: entry.pluginDigest,
      previewPath: entry.previewPath,
      priceCents: existing
        ? Number(existing.price_cents ?? 0)
        : defaultPrice?.priceCents ?? Number(entry.priceCents ?? 0),
      currency:
        existing?.currency ?? defaultPrice?.currency ?? entry.currency ?? "usd",
      listingId: existing?.listing_id ?? entry.listingId ?? null,
      status: existing?.status ?? "active",
      sortOrder: existing?.sort_order ?? 0,
      verifiedPublisher:
        typeof entry.verifiedPublisher === "boolean"
          ? entry.verifiedPublisher
          : existing
            ? existing.verified_publisher !== 0
            : true,
    });
    upserted.push(entry.id);
  }

  return {
    upserted,
    skipped,
    pinAudit: auditOfficialCatalogPluginPins(listOfficialCatalogRows(core)),
    sourceUrl: url,
  };
}
