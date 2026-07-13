import type { CoreDatabase } from "../core-db.js";
import {
  blobToVector,
  cosineSimilarity,
  vectorToBlob,
  type EmbeddingClient,
} from "./embeddings/embedding-client.js";

const RRF_K = 60;

export function syncWikiPageToFts(
  db: CoreDatabase,
  pageId: string,
  title: string,
  body: string
): void {
  try {
    db.prepare(`DELETE FROM wiki_pages_fts WHERE page_id = ?`).run(pageId);
    db.prepare(
      `INSERT INTO wiki_pages_fts (page_id, title, body) VALUES (?, ?, ?)`
    ).run(pageId, title, body);
  } catch {
    /* fts may not exist yet */
  }
}

export function removeWikiPageFromIndex(db: CoreDatabase, pageId: string): void {
  try {
    db.prepare(`DELETE FROM wiki_pages_fts WHERE page_id = ?`).run(pageId);
  } catch {
    /* optional */
  }
  try {
    db.prepare(
      `UPDATE wiki_pages SET embedding = NULL, embedding_dim = NULL WHERE id = ?`
    ).run(pageId);
  } catch {
    /* optional */
  }
}

/** FTS sync + optional async embed for a wiki page. */
export function indexWikiPage(
  db: CoreDatabase,
  embedder: EmbeddingClient | null | undefined,
  page: { id: string; title: string; body_markdown: string }
): void {
  const text = `${page.title}\n${page.body_markdown ?? ""}`.trim();
  syncWikiPageToFts(db, page.id, page.title, page.body_markdown ?? "");
  if (embedder?.isReady() && text) {
    void embedAndStoreWikiPage(db, embedder, page.id, text);
  }
}

export async function embedAndStoreWikiPage(
  db: CoreDatabase,
  embedder: EmbeddingClient,
  pageId: string,
  text: string
): Promise<boolean> {
  if (!embedder.isReady() || !text.trim()) return false;
  try {
    const vec = await embedder.embed(text);
    if (!vec) return false;
    db.prepare(
      `UPDATE wiki_pages SET embedding = ?, embedding_dim = ? WHERE id = ?`
    ).run(vectorToBlob(vec), vec.length, pageId);
    return true;
  } catch {
    return false;
  }
}

export function backfillWikiFts(db: CoreDatabase): number {
  let n = 0;
  try {
    const rows = db
      .prepare(`SELECT id, title, body_markdown FROM wiki_pages`)
      .all() as Array<{ id: string; title: string; body_markdown: string }>;
    for (const r of rows) {
      syncWikiPageToFts(db, r.id, r.title, r.body_markdown ?? "");
      n++;
    }
  } catch {
    return 0;
  }
  return n;
}

export interface WikiRagScope {
  tenantIds: string[];
}

/**
 * Hybrid BM25 + vector wiki retrieval for chat prompt injection.
 * Honors external pages + internal pages for member tenants.
 */
export async function getHybridWikiText(
  db: CoreDatabase,
  embedder: EmbeddingClient | undefined,
  query: string,
  opts: {
    tenantIds: string[];
    topK?: number;
    maxChars?: number;
  }
): Promise<string> {
  const topK = opts.topK ?? 4;
  const maxChars = opts.maxChars ?? 2400;
  const q = query.trim();
  if (!q || opts.tenantIds.length === 0) {
    return recentWikiSnippets(db, opts.tenantIds, topK, maxChars);
  }

  const textById = new Map<string, { title: string; slug: string; snippet: string }>();
  const visible = listVisibleWikiRows(db, opts.tenantIds);
  for (const r of visible) {
    textById.set(r.id, {
      title: r.title,
      slug: r.slug,
      snippet: snippetFor(r.title, r.body_markdown),
    });
  }
  if (textById.size === 0) return "";

  const bm25 = bm25Wiki(db, q, opts.tenantIds, topK * 2);
  let vector: Array<{ pageId: string; rank: number }> = [];
  if (embedder?.isReady()) {
    const queryVec = await embedder.embed(q);
    if (queryVec) {
      vector = vectorWiki(visible, queryVec, topK * 2);
    }
  }

  const fused = reciprocalRankFusion(
    [bm25.map((r) => ({ id: r.pageId, rank: r.rank })), vector.map((r) => ({ id: r.pageId, rank: r.rank }))],
    topK
  );

  if (fused.length === 0) {
    return recentWikiSnippets(db, opts.tenantIds, topK, maxChars);
  }

  const lines: string[] = ["--- Relevant wiki ---"];
  let chars = lines[0].length;
  for (const id of fused) {
    const meta = textById.get(id);
    if (!meta) continue;
    const line = `- [${meta.slug}] ${meta.title}: ${meta.snippet}`;
    if (chars + line.length > maxChars) break;
    lines.push(line);
    chars += line.length;
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function listVisibleWikiRows(
  db: CoreDatabase,
  tenantIds: string[]
): Array<{
  id: string;
  title: string;
  slug: string;
  body_markdown: string;
  embedding: Buffer | null;
}> {
  const placeholders = tenantIds.map(() => "?").join(",");
  try {
    return db
      .prepare(
        `SELECT id, title, slug, body_markdown, embedding FROM wiki_pages
         WHERE visibility = 'external'
            OR (visibility = 'internal' AND tenant_id IN (${placeholders}))
         ORDER BY updated_at DESC LIMIT 800`
      )
      .all(...tenantIds) as Array<{
      id: string;
      title: string;
      slug: string;
      body_markdown: string;
      embedding: Buffer | null;
    }>;
  } catch {
    return [];
  }
}

function bm25Wiki(
  db: CoreDatabase,
  query: string,
  tenantIds: string[],
  limit: number
): Array<{ pageId: string; rank: number }> {
  const placeholders = tenantIds.map(() => "?").join(",");
  try {
    const match = query.replace(/[^\w\s]/g, " ").trim() || query;
    const rows = db
      .prepare(
        `SELECT f.page_id AS page_id, bm25(wiki_pages_fts) AS rank
         FROM wiki_pages_fts f
         INNER JOIN wiki_pages p ON p.id = f.page_id
         WHERE wiki_pages_fts MATCH ?
           AND (p.visibility = 'external'
                OR (p.visibility = 'internal' AND p.tenant_id IN (${placeholders})))
         ORDER BY rank
         LIMIT ?`
      )
      .all(match, ...tenantIds, limit) as Array<{ page_id: string; rank: number }>;
    return rows.map((r, i) => ({ pageId: r.page_id, rank: i + 1 }));
  } catch {
    return [];
  }
}

function vectorWiki(
  rows: Array<{ id: string; embedding: Buffer | null }>,
  queryVec: Float32Array,
  limit: number
): Array<{ pageId: string; rank: number }> {
  const scored = rows
    .map((r) => {
      const vec = blobToVector(r.embedding);
      if (!vec) return null;
      return { pageId: r.id, score: cosineSimilarity(queryVec, vec) };
    })
    .filter((x): x is { pageId: string; score: number } => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((s, i) => ({ pageId: s.pageId, rank: i + 1 }));
}

function reciprocalRankFusion(
  lists: Array<Array<{ id: string; rank: number }>>,
  topK: number
): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (RRF_K + item.rank));
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => id);
}

function snippetFor(title: string, body: string, max = 180): string {
  const plain = (body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[#>*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const src = plain || title;
  return src.length > max ? `${src.slice(0, max)}…` : src;
}

function recentWikiSnippets(
  db: CoreDatabase,
  tenantIds: string[],
  topK: number,
  maxChars: number
): string {
  if (!tenantIds.length) return "";
  const rows = listVisibleWikiRows(db, tenantIds).slice(0, topK);
  if (!rows.length) return "";
  const lines: string[] = ["--- Recent wiki ---"];
  let chars = lines[0].length;
  for (const r of rows) {
    const line = `- [${r.slug}] ${r.title}: ${snippetFor(r.title, r.body_markdown)}`;
    if (chars + line.length > maxChars) break;
    lines.push(line);
    chars += line.length;
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
