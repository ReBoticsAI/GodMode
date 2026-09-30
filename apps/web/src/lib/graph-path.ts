export type GraphPathEdge = { source: string; target: string };

export const GRAPH_YOU_NODE_ID = "hub:you";

/**
 * Node ids from You to `targetId`, parent first.
 * Architecture edges point parent (source) to child (target).
 * If You is not an ancestor, the result is You then the target.
 */
export function pathFromYou(
  edges: readonly GraphPathEdge[],
  targetId: string,
  youId = GRAPH_YOU_NODE_ID
): string[] {
  if (!targetId) return [youId];
  if (targetId === youId) return [youId];
  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    if (!parentOf.has(edge.target)) parentOf.set(edge.target, edge.source);
  }
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = targetId;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    if (current === youId) break;
    current = parentOf.get(current);
  }
  if (chain[chain.length - 1] === youId) return chain.reverse();

  // Some owners point at Hub instead of Hub pointing at them (Intelligence).
  // Walk the shortest undirected link so You, Hub, and that node all light up.
  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const edge of edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  const prev = new Map<string, string>();
  const queue = [youId];
  const visited = new Set<string>([youId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) break;
    for (const next of neighbors.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);
      queue.push(next);
    }
  }
  if (!visited.has(targetId)) return [youId, targetId];
  const path: string[] = [];
  let step: string | undefined = targetId;
  while (step) {
    path.push(step);
    if (step === youId) break;
    step = prev.get(step);
  }
  return path.reverse();
}
