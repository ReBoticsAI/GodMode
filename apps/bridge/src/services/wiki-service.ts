import { v4 as uuidv4 } from "uuid";
import {
  getCoreDb,
  type CoreDatabase,
  type CoreWikiPage,
  type WikiVisibility,
} from "../core-db.js";
import { findBacklinksForPage, type WikiBacklink } from "../lib/wiki-links.js";
import {
  cascadeWikiProposalCleanup,
} from "./wiki-proposals.js";
import { indexWikiPage, removeWikiPageFromIndex } from "./wiki-rag.js";
import type { EmbeddingClient } from "./embeddings/embedding-client.js";

/** Optional embedder for index-on-write (set from routes/tools when ready). */
let wikiEmbedder: EmbeddingClient | null = null;

export function setWikiEmbedder(client: EmbeddingClient | null): void {
  wikiEmbedder = client;
}

export class WikiError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "WikiError";
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniqueSlug(
  db: CoreDatabase,
  visibility: WikiVisibility,
  base: string,
  tenantId?: string
): string {
  const root = slugify(base) || "page";
  let candidate = root;
  let n = 1;
  while (slugTaken(db, visibility, candidate, tenantId)) {
    candidate = `${root}-${++n}`;
  }
  return candidate;
}

function slugTaken(
  db: CoreDatabase,
  visibility: WikiVisibility,
  slug: string,
  tenantId?: string
): boolean {
  if (visibility === "internal" && tenantId) {
    return Boolean(
      db
        .prepare(
          `SELECT 1 FROM wiki_pages WHERE tenant_id = ? AND visibility = 'internal' AND slug = ?`
        )
        .get(tenantId, slug)
    );
  }
  return Boolean(
    db
      .prepare(`SELECT 1 FROM wiki_pages WHERE visibility = ? AND slug = ?`)
      .get(visibility, slug)
  );
}

export interface WikiScope {
  /** Tenants the requesting user belongs to (for internal visibility). */
  tenantIds: string[];
}

/**
 * Pages visible to the requester: all external pages, plus internal pages owned
 * by a tenant the requester is a member of.
 */
export function listPages(
  scope: WikiScope,
  opts: { visibility?: WikiVisibility; space?: string; q?: string } = {},
  db: CoreDatabase = getCoreDb()
): CoreWikiPage[] {
  const tenantPlaceholders = scope.tenantIds.map(() => "?").join(",");
  const internalClause = scope.tenantIds.length
    ? `(visibility = 'internal' AND tenant_id IN (${tenantPlaceholders}))`
    : "0";
  const where: string[] = [`(visibility = 'external' OR ${internalClause})`];
  const params: unknown[] = [...scope.tenantIds];
  if (opts.visibility) {
    where.push(`visibility = ?`);
    params.push(opts.visibility);
  }
  if (opts.space) {
    where.push(`space = ?`);
    params.push(opts.space);
  }
  if (opts.q) {
    where.push(`(title LIKE ? OR body_markdown LIKE ?)`);
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  return db
    .prepare(
      `SELECT * FROM wiki_pages WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC LIMIT 500`
    )
    .all(...params) as CoreWikiPage[];
}

export function getPageById(
  id: string,
  db: CoreDatabase = getCoreDb()
): CoreWikiPage | null {
  return (
    (db.prepare(`SELECT * FROM wiki_pages WHERE id = ?`).get(id) as
      | CoreWikiPage
      | undefined) ?? null
  );
}

/** Resolve a page by slug for an authenticated requester (membership-checked). */
export function getPageBySlug(
  slug: string,
  scope: WikiScope,
  db: CoreDatabase = getCoreDb()
): CoreWikiPage {
  const rows = db
    .prepare(`SELECT * FROM wiki_pages WHERE slug = ?`)
    .all(slug) as CoreWikiPage[];
  // External first (world-readable), else an internal page in the user's tenant.
  const external = rows.find((r) => r.visibility === "external");
  if (external) return external;
  const internal = rows.find(
    (r) => r.visibility === "internal" && scope.tenantIds.includes(r.tenant_id)
  );
  if (internal) return internal;
  throw new WikiError("Page not found", 404);
}

/** External-only resolver for the unauthenticated public read path. */
export function getPublicPageBySlug(
  slug: string,
  db: CoreDatabase = getCoreDb()
): CoreWikiPage {
  const page = db
    .prepare(`SELECT * FROM wiki_pages WHERE slug = ? AND visibility = 'external'`)
    .get(slug) as CoreWikiPage | undefined;
  if (!page) throw new WikiError("Page not found", 404);
  return page;
}

export interface CreatePageInput {
  tenantId: string;
  authorUserId: string;
  title: string;
  bodyMarkdown?: string;
  space?: string | null;
  visibility?: WikiVisibility;
  slug?: string;
}

function captureRevision(db: CoreDatabase, page: CoreWikiPage): void {
  db.prepare(
    `INSERT INTO wiki_revisions (id, page_id, title, body_markdown, author_user_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(uuidv4(), page.id, page.title, page.body_markdown, page.author_user_id);
}

export function createPage(
  input: CreatePageInput,
  db: CoreDatabase = getCoreDb()
): CoreWikiPage {
  const title = input.title.trim();
  if (!title) throw new WikiError("Title is required");
  const visibility: WikiVisibility =
    input.visibility === "external" ? "external" : "internal";
  const slug = uniqueSlug(db, visibility, input.slug || title, input.tenantId);
  const id = uuidv4();
  db.prepare(
    `INSERT INTO wiki_pages
       (id, tenant_id, space, slug, title, body_markdown, visibility, author_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.tenantId,
    input.space ?? null,
    slug,
    title,
    input.bodyMarkdown ?? "",
    visibility,
    input.authorUserId
  );
  const page = getPageById(id, db)!;
  captureRevision(db, page);
  indexWikiPage(db, wikiEmbedder, page);
  return page;
}

export function updatePage(
  id: string,
  patch: {
    title?: string;
    bodyMarkdown?: string;
    space?: string | null;
    visibility?: WikiVisibility;
  },
  scope: WikiScope,
  db: CoreDatabase = getCoreDb()
): CoreWikiPage {
  const page = getPageById(id, db);
  if (!page) throw new WikiError("Page not found", 404);
  if (!scope.tenantIds.includes(page.tenant_id)) {
    throw new WikiError("Only the owner tenant can edit this page", 403);
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title.trim());
  }
  if (patch.bodyMarkdown !== undefined) {
    sets.push("body_markdown = ?");
    values.push(patch.bodyMarkdown);
  }
  if (patch.space !== undefined) {
    sets.push("space = ?");
    values.push(patch.space);
  }
  if (patch.visibility && patch.visibility !== page.visibility) {
    // Moving across the visibility scope may require a fresh unique slug.
    sets.push("visibility = ?", "slug = ?");
    values.push(patch.visibility, uniqueSlug(db, patch.visibility, page.slug, page.tenant_id));
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE wiki_pages SET ${sets.join(", ")} WHERE id = ?`).run(
      ...values,
      id
    );
    captureRevision(db, getPageById(id, db)!);
  }
  const updated = getPageById(id, db)!;
  indexWikiPage(db, wikiEmbedder, updated);
  return updated;
}

export function deletePage(
  id: string,
  scope: WikiScope,
  db: CoreDatabase = getCoreDb()
): void {
  const page = getPageById(id, db);
  if (!page) throw new WikiError("Page not found", 404);
  if (!scope.tenantIds.includes(page.tenant_id)) {
    throw new WikiError("Only the owner tenant can delete this page", 403);
  }
  cascadeWikiProposalCleanup(id, db);
  removeWikiPageFromIndex(db, id);
  db.prepare(`DELETE FROM wiki_pages WHERE id = ?`).run(id);
}

export function getBacklinksForPage(
  pageId: string,
  scope: WikiScope,
  db: CoreDatabase = getCoreDb()
): WikiBacklink[] {
  const page = getPageById(pageId, db);
  if (!page) throw new WikiError("Page not found", 404);
  const visible = listPages(scope, {}, db);
  if (!visible.some((p) => p.id === pageId)) {
    throw new WikiError("Page not found", 404);
  }
  return findBacklinksForPage(pageId, visible);
}
