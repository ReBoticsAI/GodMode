import type { AppDatabase } from "../db.js";
import type { EmbeddingClient } from "./embeddings/embedding-client.js";
import { blobToVector, cosineSimilarity } from "./embeddings/embedding-client.js";
import { buildCapabilityDocs, type CapabilityKind } from "./capability-index.js";

const RRF_K = 60;

export interface CapabilityMatch {
  kind: CapabilityKind;
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  pairsWith: string;
  score: number;
}

interface CapabilityRow {
  kind: string;
  id: string;
  agent_id: string;
  name: string;
  description: string;
  when_to_use: string;
  pairs_with: string;
  text: string;
  embedding: Buffer | null;
}

function bm25CapabilitySearch(
  db: AppDatabase,
  query: string,
  agentId: string,
  limit: number
): Array<{ key: string; rank: number }> {
  try {
    const rows = db
      .prepare(
        `SELECT kind, id, agent_id, bm25(ai_capability_fts) AS rank
         FROM ai_capability_fts
         WHERE ai_capability_fts MATCH ? AND agent_id = ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query.replace(/[^\w\s]/g, " ").trim() || query, agentId, limit) as Array<{
      kind: string;
      id: string;
      agent_id: string;
      rank: number;
    }>;
    return rows.map((r, i) => ({
      key: `${r.kind}:${r.id}`,
      rank: i + 1,
    }));
  } catch {
    return [];
  }
}

function vectorCapabilitySearch(
  db: AppDatabase,
  queryVec: Float32Array,
  agentId: string,
  limit: number
): Array<{ key: string; rank: number; score: number }> {
  const rows = db
    .prepare(
      `SELECT kind, id, agent_id, embedding FROM ai_capability_embeddings
       WHERE agent_id = ? AND embedding IS NOT NULL`
    )
    .all(agentId) as Array<{ kind: string; id: string; agent_id: string; embedding: Buffer | null }>;

  const scored = rows
    .map((r) => {
      const vec = blobToVector(r.embedding);
      if (!vec) return null;
      return {
        key: `${r.kind}:${r.id}`,
        score: cosineSimilarity(queryVec, vec),
      };
    })
    .filter((x): x is { key: string; score: number } => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

function reciprocalRankFusion(
  lists: Array<Array<{ key: string; rank: number }>>,
  topK: number
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      scores.set(item.key, (scores.get(item.key) ?? 0) + 1 / (RRF_K + item.rank));
    }
  }
  return new Map(
    [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
  );
}

function lexicalFallback(
  db: AppDatabase,
  query: string,
  agentId: string,
  topK: number
): CapabilityMatch[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  const docs = buildCapabilityDocs(db, agentId);
  const scored = docs
    .map((doc) => {
      const hay = doc.text.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      if (hay.includes(q)) score += 3;
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored.map(({ doc, score }) => ({
    kind: doc.kind,
    id: doc.id,
    name: doc.name,
    description: doc.description,
    whenToUse: doc.whenToUse,
    pairsWith: doc.pairsWith,
    score,
  }));
}

function rowToMatch(row: CapabilityRow, score: number): CapabilityMatch {
  return {
    kind: row.kind as CapabilityKind,
    id: row.id,
    name: row.name,
    description: row.description,
    whenToUse: row.when_to_use,
    pairsWith: row.pairs_with,
    score,
  };
}

export async function getCapabilityMatches(
  db: AppDatabase,
  embedder: EmbeddingClient | undefined,
  query: string,
  opts: { agentId?: string; topK?: number } = {}
): Promise<CapabilityMatch[]> {
  const agentId = opts.agentId ?? "intelligence";
  const topK = opts.topK ?? 12;
  if (!query.trim()) return [];

  const rowByKey = new Map<string, CapabilityRow>();
  const rows = db
    .prepare(
      `SELECT kind, id, agent_id, name, description, when_to_use, pairs_with, text, embedding
       FROM ai_capability_embeddings WHERE agent_id = ?`
    )
    .all(agentId) as CapabilityRow[];
  for (const r of rows) rowByKey.set(`${r.kind}:${r.id}`, r);

  if (rows.length === 0) {
    return lexicalFallback(db, query, agentId, topK);
  }

  const bm25 = bm25CapabilitySearch(db, query, agentId, topK * 2);
  let vector: Array<{ key: string; rank: number }> = [];
  if (embedder?.isReady()) {
    const queryVec = await embedder.embed(query);
    if (queryVec) {
      vector = vectorCapabilitySearch(db, queryVec, agentId, topK * 2);
    }
  }

  const fused =
    bm25.length > 0 || vector.length > 0
      ? reciprocalRankFusion([bm25, vector], topK)
      : null;

  if (!fused || fused.size === 0) {
    return lexicalFallback(db, query, agentId, topK);
  }

  return [...fused.entries()].map(([key, score]) => {
    const row = rowByKey.get(key);
    if (!row) {
      const [kind, id] = key.split(":");
      return {
        kind: kind as CapabilityKind,
        id,
        name: id,
        description: "",
        whenToUse: "",
        pairsWith: "",
        score,
      };
    }
    return rowToMatch(row, score);
  });
}

export async function getCapabilitiesText(
  db: AppDatabase,
  embedder: EmbeddingClient | undefined,
  query: string,
  opts: { agentId?: string; topK?: number } = {}
): Promise<string> {
  const matches = await getCapabilityMatches(db, embedder, query, opts);
  if (matches.length === 0) return "";
  const lines = ["--- Relevant capabilities (tools, skills, workflows) ---"];
  for (const m of matches) {
    const score = m.score.toFixed(2);
    const pairs = m.pairsWith ? ` Pairs with: ${m.pairsWith}.` : "";
    const when = m.whenToUse ? ` Use when: ${m.whenToUse}.` : "";
    lines.push(
      `[${m.kind}] ${m.name} (${score}): ${m.description || m.id}.${when}${pairs}`
    );
  }
  lines.push(
    "Prefer run_workflow / use_skill when a matching workflow or skill appears above instead of improvising long tool chains."
  );
  return lines.join("\n");
}
