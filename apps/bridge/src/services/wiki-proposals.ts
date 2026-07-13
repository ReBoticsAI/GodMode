import { v4 as uuidv4 } from "uuid";
import { getCoreDb, type CoreDatabase } from "../core-db.js";
import { createPage, updatePage, type WikiScope } from "./wiki-service.js";
import { indexWikiPage, removeWikiPageFromIndex } from "./wiki-rag.js";
import type { EmbeddingClient } from "./embeddings/embedding-client.js";

export type WikiProposalAction = "create" | "update";
export type WikiProposalStatus = "pending" | "approved" | "rejected";

export interface WikiPageProposal {
  id: string;
  tenant_id: string;
  action: WikiProposalAction;
  space: string | null;
  slug: string | null;
  title: string;
  body_markdown: string;
  target_page_id: string | null;
  status: WikiProposalStatus;
  reason: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export function listWikiProposals(
  opts: { tenantId?: string; status?: WikiProposalStatus | "all" } = {},
  db: CoreDatabase = getCoreDb()
): WikiPageProposal[] {
  const status = opts.status ?? "pending";
  if (opts.tenantId && status !== "all") {
    return db
      .prepare(
        `SELECT * FROM wiki_page_proposals
         WHERE tenant_id = ? AND status = ?
         ORDER BY created_at DESC LIMIT 200`
      )
      .all(opts.tenantId, status) as WikiPageProposal[];
  }
  if (opts.tenantId) {
    return db
      .prepare(
        `SELECT * FROM wiki_page_proposals WHERE tenant_id = ?
         ORDER BY created_at DESC LIMIT 200`
      )
      .all(opts.tenantId) as WikiPageProposal[];
  }
  if (status !== "all") {
    return db
      .prepare(
        `SELECT * FROM wiki_page_proposals WHERE status = ?
         ORDER BY created_at DESC LIMIT 200`
      )
      .all(status) as WikiPageProposal[];
  }
  return db
    .prepare(`SELECT * FROM wiki_page_proposals ORDER BY created_at DESC LIMIT 200`)
    .all() as WikiPageProposal[];
}

export function createWikiProposal(
  input: {
    tenantId: string;
    action: WikiProposalAction;
    title: string;
    bodyMarkdown: string;
    space?: string | null;
    slug?: string | null;
    targetPageId?: string | null;
    reason?: string | null;
    source?: string;
  },
  db: CoreDatabase = getCoreDb()
): WikiPageProposal {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO wiki_page_proposals
       (id, tenant_id, action, space, slug, title, body_markdown, target_page_id, reason, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.tenantId,
    input.action,
    input.space ?? null,
    input.slug ?? null,
    input.title.trim(),
    input.bodyMarkdown,
    input.targetPageId ?? null,
    input.reason ?? null,
    input.source ?? "synthesize"
  );
  return db
    .prepare(`SELECT * FROM wiki_page_proposals WHERE id = ?`)
    .get(id) as WikiPageProposal;
}

export function rejectWikiProposal(
  id: string,
  db: CoreDatabase = getCoreDb()
): boolean {
  const r = db
    .prepare(
      `UPDATE wiki_page_proposals SET status = 'rejected', updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    )
    .run(id);
  return r.changes > 0;
}

export function approveWikiProposal(
  id: string,
  opts: {
    authorUserId: string;
    scope: WikiScope;
    embedder?: EmbeddingClient | null;
  },
  db: CoreDatabase = getCoreDb()
): { ok: boolean; pageId?: string; error?: string } {
  const row = db
    .prepare(`SELECT * FROM wiki_page_proposals WHERE id = ?`)
    .get(id) as WikiPageProposal | undefined;
  if (!row) return { ok: false, error: "Proposal not found" };
  if (row.status !== "pending") return { ok: false, error: "Proposal is not pending" };

  try {
    let pageId: string;
    if (row.action === "create") {
      const page = createPage(
        {
          tenantId: row.tenant_id,
          authorUserId: opts.authorUserId,
          title: row.title,
          bodyMarkdown: row.body_markdown,
          space: row.space,
          slug: row.slug ?? undefined,
          visibility: "internal",
        },
        db
      );
      pageId = page.id;
      indexWikiPage(db, opts.embedder, page);
    } else {
      const targetId = row.target_page_id;
      if (!targetId) return { ok: false, error: "Update proposal missing target_page_id" };
      const page = updatePage(
        targetId,
        {
          title: row.title,
          bodyMarkdown: row.body_markdown,
          space: row.space,
        },
        opts.scope,
        db
      );
      pageId = page.id;
      indexWikiPage(db, opts.embedder, page);
    }
    db.prepare(
      `UPDATE wiki_page_proposals SET status = 'approved', updated_at = datetime('now') WHERE id = ?`
    ).run(id);
    return { ok: true, pageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Used when deleting a page that had proposals pending. */
export function cascadeWikiProposalCleanup(
  pageId: string,
  db: CoreDatabase = getCoreDb()
): void {
  try {
    db.prepare(
      `UPDATE wiki_page_proposals SET status = 'rejected', updated_at = datetime('now')
       WHERE target_page_id = ? AND status = 'pending'`
    ).run(pageId);
  } catch {
    /* optional */
  }
  removeWikiPageFromIndex(db, pageId);
}
