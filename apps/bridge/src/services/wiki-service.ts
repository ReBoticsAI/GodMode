import { v4 as uuidv4 } from "uuid";
import {
  getCloudDb,
  type CoreDatabase,
  type CoreWikiPage,
  type WikiVisibility,
} from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { findBacklinksForPage, type WikiBacklink } from "../lib/wiki-links.js";
import {
  cascadeWikiProposalCleanup,
} from "./wiki-proposals.js";
import { indexWikiPage, removeWikiPageFromIndex } from "./wiki-rag.js";
import type { EmbeddingClient } from "./embeddings/embedding-client.js";
import { assertDeleteAllowed } from "./authority/delete-authority.js";

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

/** Workspace DB for a tenant (runs wiki Cloud→Workspace migrate on open). */
export function wikiDbForTenant(tenantId: string): CoreDatabase {
  return getTenantDb(tenantId) as CoreDatabase;
}

export function listWikiTenantIds(): string[] {
  return (
    getCloudDb()
      .prepare(`SELECT id FROM tenants`)
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
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

function queryPagesOnDb(
  db: CoreDatabase,
  where: string[],
  params: unknown[]
): CoreWikiPage[] {
  return db
    .prepare(
      `SELECT * FROM wiki_pages WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC LIMIT 500`
    )
    .all(...params) as CoreWikiPage[];
}

/**
 * Pages visible to the requester: external pages across workspaces, plus
 * internal pages owned by a tenant the requester is a member of.
 */
export function listPages(
  scope: WikiScope,
  opts: { visibility?: WikiVisibility; space?: string; q?: string } = {}
): CoreWikiPage[] {
  const seen = new Set<string>();
  const pages: CoreWikiPage[] = [];

  const pushAll = (rows: CoreWikiPage[]) => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      pages.push(row);
    }
  };

  for (const tenantId of scope.tenantIds) {
    const db = wikiDbForTenant(tenantId);
    const w = [`tenant_id = ?`];
    const p: unknown[] = [tenantId];
    if (opts.visibility) {
      w.push(`visibility = ?`);
      p.push(opts.visibility);
    }
    if (opts.space) {
      w.push(`space = ?`);
      p.push(opts.space);
    }
    if (opts.q) {
      w.push(`(title LIKE ? OR body_markdown LIKE ?)`);
      p.push(`%${opts.q}%`, `%${opts.q}%`);
    }
    pushAll(queryPagesOnDb(db, w, p));
  }

  // Global external pages from workspaces the user may not belong to.
  if (!opts.visibility || opts.visibility === "external") {
    for (const tenantId of listWikiTenantIds()) {
      if (scope.tenantIds.includes(tenantId)) continue;
      const db = wikiDbForTenant(tenantId);
      const w = [`visibility = 'external'`];
      const p: unknown[] = [];
      if (opts.space) {
        w.push(`space = ?`);
        p.push(opts.space);
      }
      if (opts.q) {
        w.push(`(title LIKE ? OR body_markdown LIKE ?)`);
        p.push(`%${opts.q}%`, `%${opts.q}%`);
      }
      pushAll(queryPagesOnDb(db, w, p));
    }
  }

  return pages.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 500);
}

export function getPageById(id: string, db?: CoreDatabase): CoreWikiPage | null {
  if (db) {
    return (
      (db.prepare(`SELECT * FROM wiki_pages WHERE id = ?`).get(id) as
        | CoreWikiPage
        | undefined) ?? null
    );
  }
  for (const tenantId of listWikiTenantIds()) {
    const row = getPageById(id, wikiDbForTenant(tenantId));
    if (row) return row;
  }
  return null;
}

/** Resolve a page by slug for an authenticated requester (membership-checked). */
export function getPageBySlug(slug: string, scope: WikiScope): CoreWikiPage {
  let external: CoreWikiPage | undefined;
  let internal: CoreWikiPage | undefined;
  for (const tenantId of listWikiTenantIds()) {
    const db = wikiDbForTenant(tenantId);
    const rows = db
      .prepare(`SELECT * FROM wiki_pages WHERE slug = ?`)
      .all(slug) as CoreWikiPage[];
    for (const row of rows) {
      if (row.visibility === "external" && !external) external = row;
      if (
        row.visibility === "internal" &&
        scope.tenantIds.includes(row.tenant_id) &&
        !internal
      ) {
        internal = row;
      }
    }
  }
  if (external) return external;
  if (internal) return internal;
  throw new WikiError("Page not found", 404);
}

/** External-only resolver for the unauthenticated public read path. */
export function getPublicPageBySlug(slug: string): CoreWikiPage {
  for (const tenantId of listWikiTenantIds()) {
    const page = wikiDbForTenant(tenantId)
      .prepare(
        `SELECT * FROM wiki_pages WHERE slug = ? AND visibility = 'external'`
      )
      .get(slug) as CoreWikiPage | undefined;
    if (page) return page;
  }
  throw new WikiError("Page not found", 404);
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
  db: CoreDatabase = wikiDbForTenant(input.tenantId)
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
  db?: CoreDatabase
): CoreWikiPage {
  const page = db ? getPageById(id, db) : getPageById(id);
  if (!page) throw new WikiError("Page not found", 404);
  if (!scope.tenantIds.includes(page.tenant_id)) {
    throw new WikiError("Only the owner tenant can edit this page", 403);
  }
  const workspace = db ?? wikiDbForTenant(page.tenant_id);
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
    sets.push("visibility = ?", "slug = ?");
    values.push(
      patch.visibility,
      uniqueSlug(workspace, patch.visibility, page.slug, page.tenant_id)
    );
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    workspace
      .prepare(`UPDATE wiki_pages SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values, id);
    captureRevision(workspace, getPageById(id, workspace)!);
  }
  const updated = getPageById(id, workspace)!;
  indexWikiPage(workspace, wikiEmbedder, updated);
  return updated;
}

export function deletePage(id: string, scope: WikiScope, db?: CoreDatabase): void {
  const page = db ? getPageById(id, db) : getPageById(id);
  if (!page) throw new WikiError("Page not found", 404);
  if (!scope.tenantIds.includes(page.tenant_id)) {
    throw new WikiError("Only the owner tenant can delete this page", 403);
  }
  assertDeleteAllowed({
    tenantId: page.tenant_id,
    action: "delete_wiki_page",
  });
  const workspace = db ?? wikiDbForTenant(page.tenant_id);
  cascadeWikiProposalCleanup(id, workspace);
  removeWikiPageFromIndex(workspace, id);
  workspace.prepare(`DELETE FROM wiki_pages WHERE id = ?`).run(id);
}

export function getBacklinksForPage(
  pageId: string,
  scope: WikiScope
): WikiBacklink[] {
  const page = getPageById(pageId);
  if (!page) throw new WikiError("Page not found", 404);
  const visible = listPages(scope, {});
  if (!visible.some((p) => p.id === pageId)) {
    throw new WikiError("Page not found", 404);
  }
  return findBacklinksForPage(pageId, visible);
}
