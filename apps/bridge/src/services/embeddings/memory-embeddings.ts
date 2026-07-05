import type { AppDatabase } from "../../db.js";
import { vectorToBlob, type EmbeddingClient } from "./embedding-client.js";

/**
 * Embed a single memory's text and persist the vector. Best-effort: returns
 * false (without throwing) when the embedder is down or the call fails, so
 * callers on the write path never break.
 */
export async function embedAndStoreMemory(
  db: AppDatabase,
  embedder: EmbeddingClient,
  id: string,
  text: string
): Promise<boolean> {
  if (!embedder.isReady() || !text.trim()) return false;
  try {
    const vec = await embedder.embed(text);
    if (!vec) return false;
    db.prepare(
      `UPDATE ai_memories SET embedding = ?, embedding_dim = ? WHERE id = ?`
    ).run(vectorToBlob(vec), vec.length, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Backfill embeddings for memories that don't have one yet. Best-effort and
 * intended to run non-blocking on startup once the embedder is healthy.
 * Processes in small batches to avoid a long single request.
 */
export async function backfillMemoryEmbeddings(
  db: AppDatabase,
  embedder: EmbeddingClient,
  opts: { batchSize?: number; maxRows?: number } = {}
): Promise<number> {
  if (!embedder.isReady()) return 0;
  const batchSize = opts.batchSize ?? 32;
  const maxRows = opts.maxRows ?? 5000;
  let done = 0;
  try {
    const rows = db
      .prepare(
        `SELECT id, text FROM ai_memories
         WHERE embedding IS NULL AND text IS NOT NULL AND trim(text) <> ''
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(maxRows) as Array<{ id: string; text: string }>;
    if (rows.length === 0) return 0;

    const update = db.prepare(
      `UPDATE ai_memories SET embedding = ?, embedding_dim = ? WHERE id = ?`
    );

    for (let i = 0; i < rows.length; i += batchSize) {
      if (!embedder.isReady()) break;
      const batch = rows.slice(i, i + batchSize);
      const vectors = await embedder.embedBatch(batch.map((r) => r.text));
      if (!vectors || vectors.length !== batch.length) continue;
      const tx = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const vec = vectors[j];
          update.run(vectorToBlob(vec), vec.length, batch[j].id);
          done++;
        }
      });
      tx();
    }
  } catch (err) {
    console.warn(
      "[embeddings] memory embedding backfill failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
  if (done > 0) console.log(`[embeddings] backfilled ${done} memory embedding(s)`);
  return done;
}
