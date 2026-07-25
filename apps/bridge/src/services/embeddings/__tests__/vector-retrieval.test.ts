/**
 * HNSW vs brute-force agreement (#69 track D).
 */
import { describe, expect, it } from "vitest";
import { l2normalize } from "../embedding-client.js";
import {
  clearAnnCaches,
  searchVectorsBruteOnly,
  searchVectorsHnswOnly,
} from "../vector-retrieval.js";

function randUnit(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    v[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return l2normalize(v);
}

describe("vector-retrieval HNSW", () => {
  it("returns the same top-1 neighbor as brute force on a small corpus", () => {
    clearAnnCaches();
    const dim = 32;
    const docs = Array.from({ length: 80 }, (_, i) => ({
      id: `d${i}`,
      vec: randUnit(dim, 1000 + i),
    }));
    const query = randUnit(dim, 42);
    const brute = searchVectorsBruteOnly(docs, query, 5);
    const hnsw = searchVectorsHnswOnly(docs, query, 5);
    expect(hnsw[0]?.id).toBe(brute[0]?.id);
    // Top-5 overlap should be high on this toy set
    const bruteSet = new Set(brute.map((h) => h.id));
    const overlap = hnsw.filter((h) => bruteSet.has(h.id)).length;
    expect(overlap).toBeGreaterThanOrEqual(3);
  });

  it("brute path is unchanged when ANN helpers are used for small k", () => {
    const docs = [
      { id: "a", vec: l2normalize(new Float32Array([1, 0, 0])) },
      { id: "b", vec: l2normalize(new Float32Array([0, 1, 0])) },
      { id: "c", vec: l2normalize(new Float32Array([0.9, 0.1, 0])) },
    ];
    const q = l2normalize(new Float32Array([1, 0, 0]));
    const hits = searchVectorsBruteOnly(docs, q, 2);
    expect(hits.map((h) => h.id)).toEqual(["a", "c"]);
  });
});
