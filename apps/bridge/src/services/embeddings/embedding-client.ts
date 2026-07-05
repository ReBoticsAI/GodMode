import type { CpuLlamaServer } from "./cpu-llama-server.js";

/**
 * Thin client over an embedder llama-server (`--embeddings`). Returns
 * L2-normalized Float32 vectors so cosine similarity reduces to a dot product.
 * Every call is best-effort: a `null` return means "embedder unavailable" and
 * the caller should fall back to non-semantic behavior.
 */
export class EmbeddingClient {
  constructor(private readonly server: CpuLlamaServer) {}

  isReady(): boolean {
    return this.server.isReady();
  }

  /** Embed a single string; returns an L2-normalized vector or null on failure. */
  async embed(text: string): Promise<Float32Array | null> {
    const out = await this.embedBatch([text]);
    return out?.[0] ?? null;
  }

  /** Embed many strings in one request. Returns null if the embedder is down. */
  async embedBatch(texts: string[]): Promise<Float32Array[] | null> {
    const clean = texts.map((t) => (t ?? "").trim()).filter(Boolean);
    if (clean.length === 0) return [];
    if (!this.server.isReady()) return null;
    try {
      const res = await fetch(`${this.server.getBaseUrl()}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "embedder", input: clean }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: Array<{ embedding: number[]; index?: number }>;
      };
      const data = json.data;
      if (!Array.isArray(data) || data.length === 0) return null;
      // Preserve request order via the returned `index` when present.
      const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return ordered.map((d) => l2normalize(Float32Array.from(d.embedding)));
    } catch {
      return null;
    }
  }
}

/** In-place-equivalent L2 normalization; returns a new Float32Array. */
export function l2normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (norm <= 1e-12) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/**
 * Cosine similarity. With L2-normalized inputs this is just the dot product,
 * but we stay correct even if one side is not normalized.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Serialize a Float32 vector to a SQLite BLOB (little-endian f32). */
export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Parse a SQLite BLOB back into a Float32Array (returns null on bad length). */
export function blobToVector(blob: Buffer | Uint8Array | null): Float32Array | null {
  if (!blob || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  // Copy into an aligned ArrayBuffer so Float32Array construction is safe.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}
