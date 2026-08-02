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
            if (existing && existing.verified_publisher === 0) return 0;
            return 1;
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
      priceCents: existing ? Number(existing.price_cents ?? 0) : Number(entry.priceCents ?? 0),
      currency: existing?.currency ?? entry.currency ?? "usd",
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
