import type { AppDatabase } from "../db.js";
import type { EmbeddingClient } from "./embeddings/embedding-client.js";
import { blobToVector, cosineSimilarity } from "./embeddings/embedding-client.js";

const DEFAULT_AGENT_ID = "intelligence";
const RRF_K = 60;

/** Active memories whose validity window includes "now" (UTC). */
function validitySql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(
    (${p}valid_from IS NULL OR ${p}valid_from <= datetime('now'))
    AND (${p}valid_until IS NULL OR ${p}valid_until > datetime('now'))
  )`;
}

function getMemoriesTextRecency(
  db: AppDatabase,
  chatId: string | undefined,
  agentId: string
): string {
  const agentClause =
    agentId === DEFAULT_AGENT_ID ? `(agent_id = ? OR agent_id IS NULL)` : `agent_id = ?`;
  const rows = db
    .prepare(
      `SELECT text FROM ai_memories
       WHERE enabled = 1 AND status = 'active'
         AND (scope = 'global' OR (scope = 'chat' AND chat_id IS ?))
         AND ${agentClause}
         AND ${validitySql()}
       ORDER BY created_at DESC LIMIT 12`
    )
    .all(chatId ?? null, agentId) as Array<{ text: string }>;
  if (rows.length === 0) return "";
  return ["--- Recent memories ---", ...rows.map((r) => `- ${r.text}`)].join("\n");
}

export function syncMemoryToFts(db: AppDatabase, memoryId: string, text: string): void {
  try {
    db.prepare(`DELETE FROM ai_memories_fts WHERE memory_id = ?`).run(memoryId);
    db.prepare(`INSERT INTO ai_memories_fts (memory_id, text) VALUES (?, ?)`).run(memoryId, text);
  } catch {
    /* fts table may not exist yet */
  }
}

export function backfillMemoryFts(db: AppDatabase): number {
  let n = 0;
  const rows = db
    .prepare(`SELECT id, text FROM ai_memories WHERE enabled = 1 AND status = 'active'`)
    .all() as Array<{ id: string; text: string }>;
  for (const r of rows) {
    syncMemoryToFts(db, r.id, r.text);
    n++;
  }
  return n;
}

function bm25Search(
  db: AppDatabase,
  query: string,
  agentId: string,
  chatId: string | null,
  limit: number
): Array<{ memoryId: string; text: string; rank: number }> {
  try {
    const agentClause =
      agentId === DEFAULT_AGENT_ID
        ? `(m.agent_id = ? OR m.agent_id IS NULL)`
        : `m.agent_id = ?`;
    const rows = db
      .prepare(
        `SELECT f.memory_id AS memory_id, m.text AS text, bm25(ai_memories_fts) AS rank
         FROM ai_memories_fts f
         INNER JOIN ai_memories m ON m.id = f.memory_id
         WHERE ai_memories_fts MATCH ?
           AND m.enabled = 1 AND m.status = 'active'
           AND (m.scope = 'global' OR (m.scope = 'chat' AND m.chat_id IS ?))
           AND ${agentClause}
           AND ${validitySql("m")}
         ORDER BY rank
         LIMIT ?`
      )
      .all(
        query.replace(/[^\w\s]/g, " ").trim() || query,
        chatId,
        agentId,
        limit
      ) as Array<{ memory_id: string; text: string; rank: number }>;
    return rows.map((r, i) => ({
      memoryId: r.memory_id,
      text: r.text,
      rank: i + 1,
    }));
  } catch {
    return [];
  }
}

function vectorSearch(
  db: AppDatabase,
  queryVec: Float32Array,
  agentId: string,
  chatId: string | null,
  limit: number
): Array<{ memoryId: string; text: string; rank: number }> {
  const agentClause =
    agentId === "intelligence" ? `(agent_id = ? OR agent_id IS NULL)` : `agent_id = ?`;
  const rows = db
    .prepare(
      `SELECT id, text, embedding FROM ai_memories
       WHERE enabled = 1 AND status = 'active'
         AND (scope = 'global' OR (scope = 'chat' AND chat_id IS ?))
         AND ${agentClause}
         AND ${validitySql()}
         AND embedding IS NOT NULL`
    )
    .all(chatId, agentId) as Array<{ id: string; text: string; embedding: Buffer | null }>;

  const scored = rows
    .map((r) => {
      const vec = blobToVector(r.embedding);
      if (!vec) return null;
      return { memoryId: r.id, text: r.text, score: cosineSimilarity(queryVec, vec) };
    })
    .filter((x): x is { memoryId: string; text: string; score: number } => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s, i) => ({ memoryId: s.memoryId, text: s.text, rank: i + 1 }));
}

function reciprocalRankFusion(
  lists: Array<Array<{ memoryId: string; text?: string; rank: number }>>,
  topK: number
): string[] {
  const scores = new Map<string, { score: number; text?: string }>();
  for (const list of lists) {
    for (const item of list) {
      const cur = scores.get(item.memoryId) ?? { score: 0, text: item.text };
      cur.score += 1 / (RRF_K + item.rank);
      if (item.text) cur.text = item.text;
      scores.set(item.memoryId, cur);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK)
    .map(([id]) => id);
}

function renderMemoryList(texts: string[]): string {
  if (texts.length === 0) return "";
  return ["--- Relevant memories ---", ...texts.map((t) => `- ${t}`)].join("\n");
}

export async function getHybridMemoriesText(
  db: AppDatabase,
  embedder: EmbeddingClient | undefined,
  query: string,
  opts: { chatId?: string; agentId?: string; topK?: number } = {}
): Promise<string> {
  const agentId = opts.agentId ?? "intelligence";
  const topK = opts.topK ?? 12;
  const chatId = opts.chatId ?? null;
  const recencyFallback = () => getMemoriesTextRecency(db, opts.chatId, agentId);

  if (!query.trim()) return recencyFallback();

  const textById = new Map<string, string>();
  const rows = db
    .prepare(
      `SELECT id, text FROM ai_memories
       WHERE enabled = 1 AND status = 'active' AND ${validitySql()}`
    )
    .all() as Array<{ id: string; text: string }>;
  for (const r of rows) textById.set(r.id, r.text);

  const bm25 = bm25Search(db, query, agentId, chatId, topK * 2);

  let vector: Array<{ memoryId: string; text: string; rank: number }> = [];
  if (embedder?.isReady()) {
    const queryVec = await embedder.embed(query);
    if (queryVec) {
      vector = vectorSearch(db, queryVec, agentId, chatId, topK * 2);
    }
  }

  const fusedIds =
    bm25.length > 0 || vector.length > 0
      ? reciprocalRankFusion([bm25, vector], topK)
      : [];

  if (fusedIds.length === 0) return recencyFallback();

  const texts = fusedIds
    .map((id) => {
      const fromBm25 = bm25.find((b) => b.memoryId === id)?.text;
      return fromBm25 ?? textById.get(id);
    })
    .filter((t): t is string => Boolean(t));
  return renderMemoryList(texts);
}
