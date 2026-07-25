/**
 * Pluggable vector top-K retrieval (#69 track D).
 * SQLite BLOBs remain source of truth; ANN is an optional in-memory accelerator.
 */
import { config } from "../../config.js";
import { cosineSimilarity } from "./embedding-client.js";
import { HnswIndex, type HnswItem } from "./hnsw-index.js";

export type VectorHit = { id: string; score: number };
export type VectorDoc = { id: string; vec: Float32Array };

type CacheEntry = {
  fingerprint: string;
  index: HnswIndex;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();
const dirty = new Set<string>();

export function invalidateAnnIndex(key: string): void {
  dirty.add(key);
  cache.delete(key);
}

export function invalidateAnnIndexPrefix(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      dirty.add(key);
    }
  }
}

/** Debounced soft invalidate used by write paths. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleAnnInvalidate(key: string, ms = 500): void {
  const prev = debounceTimers.get(key);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    key,
    setTimeout(() => {
      if (key.endsWith(":") || key.endsWith("*")) {
        const prefix = key.replace(/\*$/, "");
        invalidateAnnIndexPrefix(prefix);
      } else {
        invalidateAnnIndex(key);
      }
      debounceTimers.delete(key);
    }, ms)
  );
}

export function clearAnnCaches(): void {
  cache.clear();
  dirty.clear();
}

function fingerprint(docs: VectorDoc[]): string {
  // Size + first/last ids + dim is enough to detect rebuild need cheaply.
  if (docs.length === 0) return "0";
  const first = docs[0]!;
  const last = docs[docs.length - 1]!;
  return `${docs.length}:${first.id}:${last.id}:${first.vec.length}`;
}

function bruteForceTopK(
  docs: VectorDoc[],
  query: Float32Array,
  limit: number
): VectorHit[] {
  const scored: VectorHit[] = [];
  for (const d of docs) {
    scored.push({ id: d.id, score: cosineSimilarity(query, d.vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function wantHnsw(n: number): boolean {
  if (!config.embeddings.annEnabled) return false;
  if (config.embeddings.annBackend !== "hnsw") return false;
  return n >= config.embeddings.annMinRows;
}

/**
 * Top-K by cosine. Uses in-memory HNSW when enabled and corpus is large enough;
 * otherwise brute-force scan (identical to pre-#69 behavior).
 */
export function searchVectors(
  key: string,
  docs: VectorDoc[],
  query: Float32Array,
  limit: number
): VectorHit[] {
  const k = Math.max(1, limit);
  if (docs.length === 0) return [];
  if (!wantHnsw(docs.length)) {
    return bruteForceTopK(docs, query, k);
  }

  const fp = fingerprint(docs);
  let entry = cache.get(key);
  if (!entry || entry.fingerprint !== fp || dirty.has(key)) {
    const index = new HnswIndex();
    index.build(docs.map((d): HnswItem => ({ id: d.id, vec: d.vec })));
    entry = { fingerprint: fp, index, builtAt: Date.now() };
    cache.set(key, entry);
    dirty.delete(key);
  }

  const ef = Math.max(k * 2, 64);
  return entry.index.search(query, k, ef);
}

/** Exported for unit tests: always build HNSW regardless of config gates. */
export function searchVectorsHnswOnly(
  docs: VectorDoc[],
  query: Float32Array,
  limit: number
): VectorHit[] {
  const index = new HnswIndex();
  index.build(docs.map((d) => ({ id: d.id, vec: d.vec })));
  return index.search(query, limit, Math.max(limit * 2, 64));
}

export function searchVectorsBruteOnly(
  docs: VectorDoc[],
  query: Float32Array,
  limit: number
): VectorHit[] {
  return bruteForceTopK(docs, query, limit);
}
