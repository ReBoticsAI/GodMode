/**
 * Minimal pure-TypeScript HNSW for L2-normalized float vectors (#69 track D).
 * Distance = 1 - dot (cosine). No native addons (Windows/OSS portable).
 */
export type HnswItem = { id: string; vec: Float32Array };

type Node = {
  id: string;
  vec: Float32Array;
  level: number;
  /** neighbors[level] = neighbor node indices */
  neighbors: number[][];
};

function dist(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return 1 - dot;
}

export class HnswIndex {
  private nodes: Node[] = [];
  private idToIdx = new Map<string, number>();
  private entryPoint = -1;
  private maxLevel = 0;

  constructor(
    private readonly M = 16,
    private readonly efConstruction = 64,
    private readonly ml = 1 / Math.log(16)
  ) {}

  get size(): number {
    return this.nodes.length;
  }

  clear(): void {
    this.nodes = [];
    this.idToIdx.clear();
    this.entryPoint = -1;
    this.maxLevel = 0;
  }

  build(items: HnswItem[]): void {
    this.clear();
    for (const item of items) this.add(item.id, item.vec);
  }

  add(id: string, vec: Float32Array): void {
    if (this.idToIdx.has(id)) return;
    const level = this.randomLevel();
    const idx = this.nodes.length;
    const neighbors: number[][] = [];
    for (let l = 0; l <= level; l++) neighbors.push([]);
    this.nodes.push({ id, vec, level, neighbors });
    this.idToIdx.set(id, idx);

    if (this.entryPoint < 0) {
      this.entryPoint = idx;
      this.maxLevel = level;
      return;
    }

    let ep = this.entryPoint;
    for (let l = this.maxLevel; l > level; l--) {
      ep = this.searchLayerClosest(vec, ep, l);
    }
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const candidates = this.searchLayer(vec, ep, this.efConstruction, l);
      const selected = this.selectNeighbors(vec, candidates, this.M);
      this.nodes[idx]!.neighbors[l] = selected;
      for (const nb of selected) {
        const nbNode = this.nodes[nb]!;
        while (nbNode.neighbors.length <= l) nbNode.neighbors.push([]);
        nbNode.neighbors[l]!.push(idx);
        if (nbNode.neighbors[l]!.length > this.M) {
          nbNode.neighbors[l] = this.selectNeighbors(
            nbNode.vec,
            nbNode.neighbors[l]!.map((i) => ({ idx: i, d: dist(nbNode.vec, this.nodes[i]!.vec) })),
            this.M
          );
        }
      }
      if (candidates.length) ep = candidates[0]!.idx;
    }
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = idx;
    }
  }

  search(query: Float32Array, k: number, ef = 64): Array<{ id: string; score: number }> {
    if (this.entryPoint < 0 || k <= 0) return [];
    let ep = this.entryPoint;
    for (let l = this.maxLevel; l > 0; l--) {
      ep = this.searchLayerClosest(query, ep, l);
    }
    const candidates = this.searchLayer(query, ep, Math.max(ef, k), 0);
    return candidates.slice(0, k).map((c) => ({
      id: this.nodes[c.idx]!.id,
      score: 1 - c.d,
    }));
  }

  private randomLevel(): number {
    let level = 0;
    while (Math.random() < Math.exp(-1 / this.ml) && level < 16) level++;
    return level;
  }

  private searchLayerClosest(query: Float32Array, ep: number, layer: number): number {
    let cur = ep;
    let curDist = dist(query, this.nodes[cur]!.vec);
    let changed = true;
    while (changed) {
      changed = false;
      const nbs = this.nodes[cur]!.neighbors[layer] ?? [];
      for (const nb of nbs) {
        const d = dist(query, this.nodes[nb]!.vec);
        if (d < curDist) {
          curDist = d;
          cur = nb;
          changed = true;
        }
      }
    }
    return cur;
  }

  private searchLayer(
    query: Float32Array,
    ep: number,
    ef: number,
    layer: number
  ): Array<{ idx: number; d: number }> {
    const visited = new Set<number>([ep]);
    const candidates: Array<{ idx: number; d: number }> = [
      { idx: ep, d: dist(query, this.nodes[ep]!.vec) },
    ];
    const w: Array<{ idx: number; d: number }> = [...candidates];

    while (candidates.length) {
      candidates.sort((a, b) => a.d - b.d);
      const current = candidates.shift()!;
      w.sort((a, b) => a.d - b.d);
      if (current.d > (w[w.length - 1]?.d ?? Infinity) && w.length >= ef) break;

      for (const nb of this.nodes[current.idx]!.neighbors[layer] ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        const d = dist(query, this.nodes[nb]!.vec);
        w.sort((a, b) => a.d - b.d);
        if (w.length < ef || d < w[w.length - 1]!.d) {
          candidates.push({ idx: nb, d });
          w.push({ idx: nb, d });
          if (w.length > ef) {
            w.sort((a, b) => a.d - b.d);
            w.pop();
          }
        }
      }
    }
    w.sort((a, b) => a.d - b.d);
    return w;
  }

  private selectNeighbors(
    _query: Float32Array,
    candidates: Array<{ idx: number; d: number }> | number[],
    M: number
  ): number[] {
    const list =
      typeof candidates[0] === "number"
        ? (candidates as number[]).map((idx) => ({
            idx,
            d: dist(_query, this.nodes[idx]!.vec),
          }))
        : (candidates as Array<{ idx: number; d: number }>);
    return [...list]
      .sort((a, b) => a.d - b.d)
      .slice(0, M)
      .map((c) => c.idx);
  }
}
