import type { AppDatabase } from "../../db.js";
import { config } from "../../config.js";
import type { EmbeddingClient } from "../embeddings/embedding-client.js";
import { globFiles, grepSearch, resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";
import { searchCodeChunks, syncCodeIndex } from "./code-index.js";

export interface CodebaseSearchResult {
  path: string;
  line: number;
  snippet: string;
  score: number;
  source?: "vector" | "grep" | "hybrid" | "glob";
  symbol?: string;
  kind?: string;
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
  path?: string;
  glob?: string;
  limit: number;
  tenantId?: string | null;
  root?: string;
}): Promise<CodebaseSearchResult[]> {
  const terms = opts.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  let pattern = opts.query;
  if (terms.length > 1 && !/[\\^$.*+?()[\]{}|]/.test(opts.query)) {
    pattern = terms.map((t) => `(?=.*${t})`).join("") + ".+";
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
    for (const p of glob.files.slice(0, opts.limit)) {
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

/**
 * Hybrid codebase search: vector code chunks (when indexed) + ripgrep ranking.
 * Soft-fails to grep-only when the embedder / index is unavailable.
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
}): Promise<{
  query: string;
  results: CodebaseSearchResult[];
  mode: "hybrid" | "grep" | "vector";
}> {
  const query = String(opts.query ?? "").trim();
  if (!query) throw new Error("query required");
  const limit = Math.min(Math.max(Number(opts.limit ?? 25), 1), 50);
  const rootOpts: FsRootOpts = { tenantId: opts.tenantId, root: opts.root };
  const rootPath = resolveCodingRoot(rootOpts);

  const grepPromise = grepRanked({
    query,
    path: opts.path,
    glob: opts.glob,
    limit,
    tenantId: opts.tenantId,
    root: opts.root,
  });

  let vectorHits: CodebaseSearchResult[] = [];
  if (opts.db && opts.embedder?.isReady()) {
    try {
      await syncCodeIndex(opts.db, {
        tenantId: opts.tenantId,
        root: opts.root,
        embedder: opts.embedder,
        maxFiles: 800,
      });
      const queryVec = await opts.embedder.embed(query, { profile: "code" });
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
      }
    } catch {
      vectorHits = [];
    }
  }

  const grepHits = await grepPromise;
  if (vectorHits.length === 0) {
    return { query, results: grepHits.slice(0, limit), mode: "grep" };
  }
  if (grepHits.length === 0) {
    return { query, results: vectorHits.slice(0, limit), mode: "vector" };
  }
  const fused = rrfFuse([vectorHits, grepHits]).slice(0, limit);
  return { query, results: fused, mode: "hybrid" };
}
