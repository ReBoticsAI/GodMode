import type { AppDatabase } from "../../db.js";
import { config } from "../../config.js";
import type { EmbeddingClient } from "../embeddings/embedding-client.js";
import { globFiles, grepSearch, resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";
import {
  getCodeIndexStats,
  searchCodeChunks,
  syncCodeIndex,
  type CodeIndexStats,
} from "./code-index.js";

export interface CodebaseSearchResult {
  path: string;
  line: number;
  snippet: string;
  score: number;
  source?: "vector" | "grep" | "hybrid" | "glob";
  symbol?: string;
  kind?: string;
}

export type CodeIndexSearchStatus =
  | "ready"
  | "pending"
  | "unavailable"
  | "skipped";

export interface CodebaseSearchIndexInfo {
  status: CodeIndexSearchStatus;
  filesScanned?: number;
  chunksTotal?: number;
  chunksEmbedded?: number;
  fingerprint?: string;
  /** True when this call ran (or short-circuited) a sync against the coding root. */
  synced?: boolean;
}

export type CodebaseSearchFallbackReason =
  | "embedder_unavailable"
  | "vector_error"
  | "no_embeddings"
  | null;

export interface CodebaseSearchResponse {
  query: string;
  results: CodebaseSearchResult[];
  mode: "hybrid" | "grep" | "vector";
  /** Keywords used for the grep side after NL stopword stripping. */
  keywords: string[];
  index: CodebaseSearchIndexInfo;
  fallbackReason: CodebaseSearchFallbackReason;
  /** Human-readable guidance for agents; especially when results are empty. */
  note?: string;
}

/** Common NL filler that should not drive ripgrep patterns. */
const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "where",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "when",
  "why",
  "this",
  "that",
  "these",
  "those",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "from",
  "by",
  "and",
  "or",
  "but",
  "not",
  "no",
  "with",
  "as",
  "it",
  "its",
  "into",
  "about",
  "handled",
  "handle",
  "handling",
  "implemented",
  "implement",
  "implementation",
  "code",
  "file",
  "files",
  "function",
  "functions",
  "class",
  "method",
  "methods",
  "please",
  "find",
  "show",
  "me",
  "can",
  "you",
  "does",
  "do",
  "did",
  "should",
  "there",
  "here",
  "any",
  "some",
  "all",
  "our",
  "my",
  "we",
  "i",
  "looking",
  "look",
  "locate",
  "search",
  "tell",
]);

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/**
 * Pull useful literal terms from a natural-language or identifier query.
 * Keeps camelCase / snake_case tokens intact; drops stopwords.
 */
export function extractSearchKeywords(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Exact-looking identifier: keep as a single term.
  if (/^[A-Za-z_][\w.]*$/.test(trimmed) && !SEARCH_STOPWORDS.has(trimmed.toLowerCase())) {
    return [trimmed];
  }

  const tokens =
    trimmed.match(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|[A-Za-z]{2,}/g) ??
    [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const lower = raw.toLowerCase();
    if (SEARCH_STOPWORDS.has(lower)) continue;
    if (raw.length < 2) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(raw);
    if (out.length >= 8) break;
  }
  return out;
}

function rrfFuse(
  rankedLists: CodebaseSearchResult[][],
  k = 60
): CodebaseSearchResult[] {
  const scores = new Map<string, { hit: CodebaseSearchResult; score: number }>();
  for (const list of rankedLists) {
    list.forEach((hit, idx) => {
      const key = `${hit.path}:${hit.line}`;
      const add = 1 / (k + idx + 1);
      const prev = scores.get(key);
      if (prev) {
        prev.score += add;
        if (hit.source === "vector" || prev.hit.source === "vector") {
          prev.hit.source = "hybrid";
        }
        if ((hit.snippet?.length ?? 0) > (prev.hit.snippet?.length ?? 0)) {
          prev.hit.snippet = hit.snippet;
        }
        if (hit.symbol && !prev.hit.symbol) prev.hit.symbol = hit.symbol;
      } else {
        scores.set(key, { hit: { ...hit }, score: add });
      }
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ hit, score }) => ({ ...hit, score }));
}

async function grepRanked(opts: {
  query: string;
  keywords: string[];
  path?: string;
  glob?: string;
  limit: number;
  tenantId?: string | null;
  root?: string;
}): Promise<CodebaseSearchResult[]> {
  const terms =
    opts.keywords.length > 0
      ? opts.keywords.map((t) => t.toLowerCase())
      : opts.query
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 1);

  const looksLikeRegex = /[\\^$.*+?()[\]{}|]/.test(opts.query);
  let pattern = opts.query;
  if (!looksLikeRegex && terms.length === 1) {
    pattern = escapeRegex(terms[0]);
  } else if (!looksLikeRegex && terms.length > 1) {
    // OR across NL keywords so "auth token validation" can hit any term;
    // multi-term path/snippet scoring still prefers richer matches.
    pattern = terms.map(escapeRegex).join("|");
  }

  const grep = await grepSearch({
    pattern,
    path: opts.path,
    glob: opts.glob,
    caseInsensitive: true,
    tenantId: opts.tenantId,
    root: opts.root,
  });
  const raw = grep.output === "(no matches)" ? "" : grep.output;
  const scored: CodebaseSearchResult[] = [];

  for (const line of raw.split(/\n/).filter(Boolean)) {
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, filePath, lineNum, snippet] = m;
    const lowerPath = filePath.toLowerCase();
    if (lowerPath.includes("node_modules")) continue;
    let score = 1;
    for (const t of terms) {
      if (lowerPath.includes(t)) score += 3;
      if (snippet.toLowerCase().includes(t)) score += 2;
    }
    if (lowerPath.includes("test")) score -= 0.5;
    scored.push({
      path: filePath,
      line: Number(lineNum),
      snippet: snippet.trim().slice(0, 200),
      score,
      source: "grep",
    });
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const deduped: CodebaseSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of scored) {
    const key = `${r.path}:${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
    if (deduped.length >= opts.limit) break;
  }

  if (deduped.length === 0 && terms.length === 1) {
    const glob = globFiles({
      pattern: `**/*${terms[0]}*`,
      cwd: opts.path ?? ".",
      tenantId: opts.tenantId,
    });
    for (const p of glob.matches.slice(0, opts.limit)) {
      deduped.push({
        path: p,
        line: 1,
        snippet: `(path match) ${p}`,
        score: 2,
        source: "glob",
      });
    }
  }

  return deduped;
}

function indexInfoFromStats(
  stats: CodeIndexStats | null,
  status: CodeIndexSearchStatus,
  synced?: boolean
): CodebaseSearchIndexInfo {
  if (!stats) {
    return { status, synced: synced ?? false };
  }
  return {
    status,
    filesScanned: stats.filesScanned,
    chunksTotal: stats.chunksTotal,
    chunksEmbedded: stats.chunksEmbedded,
    fingerprint: stats.fingerprint,
    synced: synced ?? false,
  };
}

function buildNote(opts: {
  results: CodebaseSearchResult[];
  mode: "hybrid" | "grep" | "vector";
  keywords: string[];
  fallbackReason: CodebaseSearchFallbackReason;
  index: CodebaseSearchIndexInfo;
}): string | undefined {
  const kw = opts.keywords.length ? opts.keywords.join(", ") : "(full query)";
  if (opts.results.length === 0) {
    if (opts.fallbackReason === "embedder_unavailable") {
      return `Soft-failed to grep (code embedder unavailable). No matches for ${kw}. Empty results do not prove the symbol is absent; try grep with an exact identifier or glob a path.`;
    }
    if (opts.fallbackReason === "vector_error") {
      return `Soft-failed to grep (vector search error). No matches for ${kw}. Empty results do not prove the symbol is absent; try grep with an exact identifier.`;
    }
    if (opts.fallbackReason === "no_embeddings") {
      return `Index has chunks but no embeddings yet (pending). Grep found nothing for ${kw}. Retry after the code index finishes embedding, or grep an exact symbol.`;
    }
    return `No matches for ${kw}. Try a more specific symbol name, path prefix, or glob.`;
  }
  if (opts.mode === "grep" && opts.fallbackReason) {
    if (opts.fallbackReason === "embedder_unavailable") {
      return "Grep-only mode: code embedder unavailable. Soft-failed from semantic search.";
    }
    if (opts.fallbackReason === "no_embeddings") {
      return "Grep-only mode: code index has no embeddings yet (pending). Soft-failed from semantic search.";
    }
    if (opts.fallbackReason === "vector_error") {
      return "Grep-only mode after vector error. Soft-failed from semantic search.";
    }
  }
  if (opts.index.status === "pending" && opts.mode !== "hybrid") {
    return "Code index embeddings are still pending; results may improve after the next sync.";
  }
  return undefined;
}

/**
 * Hybrid codebase search: vector code chunks (when indexed) + ripgrep ranking.
 * Soft-fails to grep-only when the embedder / index is unavailable, and always
 * surfaces index status so empty results are not read as "nothing exists".
 */
export async function codebaseSearch(opts: {
  query: string;
  path?: string;
  glob?: string;
  limit?: number;
  tenantId?: string | null;
  /** Override coding root (tests / explicit workspace). */
  root?: string;
  db?: AppDatabase | null;
  embedder?: EmbeddingClient | null;
}): Promise<CodebaseSearchResponse> {
  const query = String(opts.query ?? "").trim();
  if (!query) throw new Error("query required");
  const limit = Math.min(Math.max(Number(opts.limit ?? 25), 1), 50);
  const rootOpts: FsRootOpts = { tenantId: opts.tenantId, root: opts.root };
  const rootPath = resolveCodingRoot(rootOpts);
  const keywords = extractSearchKeywords(query);

  const grepPromise = grepRanked({
    query,
    keywords,
    path: opts.path,
    glob: opts.glob,
    limit,
    tenantId: opts.tenantId,
    root: opts.root,
  });

  let vectorHits: CodebaseSearchResult[] = [];
  let fallbackReason: CodebaseSearchFallbackReason = null;
  let index: CodebaseSearchIndexInfo = { status: "skipped", synced: false };
  let synced = false;

  const embedderReady = Boolean(opts.embedder?.isReady());
  if (!opts.db || !embedderReady) {
    fallbackReason = "embedder_unavailable";
    index = { status: "unavailable", synced: false };
    if (opts.db) {
      const stats = getCodeIndexStats(opts.db, rootPath);
      index = indexInfoFromStats(stats, "unavailable", false);
    }
  } else {
    try {
      const sync = await syncCodeIndex(opts.db, {
        tenantId: opts.tenantId,
        root: opts.root,
        embedder: opts.embedder,
        maxFiles: 800,
      });
      synced = true;
      const stats =
        getCodeIndexStats(opts.db, rootPath) ??
        ({
          rootId: sync.rootId,
          rootPath: sync.rootPath,
          fingerprint: sync.fingerprint,
          filesScanned: sync.filesScanned,
          chunksTotal: 0,
          chunksEmbedded: sync.embedded,
          updatedAt: null,
        } satisfies CodeIndexStats);

      if (stats.chunksEmbedded <= 0) {
        fallbackReason = "no_embeddings";
        index = indexInfoFromStats(stats, "pending", synced);
      } else {
        index = indexInfoFromStats(stats, "ready", synced);
        const queryVec = await opts.embedder!.embed(query, { profile: "code" });
        if (queryVec) {
          const prefix = opts.path
            ? opts.path.replace(/\\/g, "/").replace(/^\.\//, "")
            : undefined;
          vectorHits = searchCodeChunks(opts.db, {
            rootPath,
            queryVec,
            pathPrefix: prefix,
            limit: config.embeddings.codeRagTopK,
          }).map((h) => ({
            path: h.path,
            line: h.startLine,
            snippet: h.snippet,
            score: h.score,
            source: "vector" as const,
            symbol: h.symbol,
            kind: h.kind,
          }));
        } else {
          fallbackReason = "vector_error";
          index = { ...index, status: "pending" };
        }
      }
    } catch {
      vectorHits = [];
      fallbackReason = "vector_error";
      const stats = opts.db ? getCodeIndexStats(opts.db, rootPath) : null;
      index = indexInfoFromStats(stats, stats ? "pending" : "unavailable", synced);
    }
  }

  const grepHits = await grepPromise;
  let mode: "hybrid" | "grep" | "vector";
  let results: CodebaseSearchResult[];
  if (vectorHits.length === 0) {
    mode = "grep";
    results = grepHits.slice(0, limit);
    // Keep soft-fail reason when vectors were skipped; empty vector hits with a
    // ready index is normal grep-complement (not a soft-fail).
  } else if (grepHits.length === 0) {
    mode = "vector";
    results = vectorHits.slice(0, limit);
    fallbackReason = null;
  } else {
    mode = "hybrid";
    results = rrfFuse([vectorHits, grepHits]).slice(0, limit);
    fallbackReason = null;
  }

  const note = buildNote({ results, mode, keywords, fallbackReason, index });
  return {
    query,
    results,
    mode,
    keywords,
    index,
    fallbackReason,
    ...(note ? { note } : {}),
  };
}
