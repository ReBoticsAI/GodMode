import { config } from "../config.js";
import type { CoreDatabase } from "../core-db.js";
import type { CatalogEntry, CatalogIndex } from "./marketplace-catalog.js";
import { fetchOfficialCatalog } from "./marketplace-catalog.js";

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
  preview_path: string | null;
  price_cents: number;
  currency: string;
  listing_id: string | null;
  status: string;
  sort_order: number;
  updated_at: string;
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

export function upsertOfficialCatalogEntry(
  core: CoreDatabase,
  entry: {
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
    previewPath?: string;
    priceCents?: number;
    currency?: string;
    listingId?: string | null;
    status?: string;
    sortOrder?: number;
  }
): OfficialCatalogRow {
  core
    .prepare(
      `INSERT INTO marketplace_official_catalog
         (entry_id, title, description, version, author, kind, install_type, tags_json,
          bundle_path, plugin_repo, plugin_ref, preview_path, price_cents, currency,
          listing_id, status, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
         preview_path=excluded.preview_path,
         price_cents=excluded.price_cents,
         currency=excluded.currency,
         listing_id=excluded.listing_id,
         status=excluded.status,
         sort_order=excluded.sort_order,
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
      entry.previewPath ?? null,
      Math.max(0, Math.floor(Number(entry.priceCents ?? 0))),
      (entry.currency ?? "usd").toLowerCase(),
      entry.listingId ?? null,
      entry.status ?? "active",
      entry.sortOrder ?? 0
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
  return {
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
    previewPath: row.preview_path ?? undefined,
    sourceCatalog,
    sourceName: "Official",
    priceCents: Number(row.price_cents ?? 0),
    currency: row.currency || "usd",
    listingId: row.listing_id ?? undefined,
  } as CatalogEntry & {
    priceCents: number;
    currency: string;
    listingId?: string;
  };
}

/**
 * Public Official catalog for SaaS and remote installs.
 * Prefer curated SaaS rows; fall back to GitHub/local free catalog with price_cents=0.
 */
export async function buildPublicOfficialCatalog(
  core: CoreDatabase
): Promise<CatalogIndex & { commerceHost?: string }> {
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

  const fallback = await fetchOfficialCatalog();
  return {
    ...fallback,
    version: Math.max(2, Number(fallback.version ?? 1)),
    entries: fallback.entries.map((e) => ({
      ...e,
      priceCents: 0,
      currency: "usd",
    })),
  };
}

export function listOfficialCatalogRows(core: CoreDatabase): OfficialCatalogRow[] {
  return core
    .prepare(
      `SELECT * FROM marketplace_official_catalog ORDER BY sort_order ASC, title ASC`
    )
    .all() as OfficialCatalogRow[];
}
