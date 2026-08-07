/**
 * Incremental code embedding index for coding roots (#69 track B).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppDatabase } from "../../db.js";
import {
  blobToVector,
  vectorToBlob,
  type EmbeddingClient,
} from "../embeddings/embedding-client.js";
import {
  embedProfileModelId,
  resolveEmbedProfile,
} from "../embeddings/profiles.js";
import { enqueueEmbedJob, isEmbedQueueEnabled } from "../embeddings/embed-queue.js";
import { scheduleAnnInvalidate, searchVectors } from "../embeddings/vector-retrieval.js";
import {
  chunkSourceFile,
  isIndexableSourcePath,
  type CodeChunkDraft,
} from "./code-chunker.js";
import { resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "out",
  ".turbo",
  ".cache",
  ".worktrees",
  "worktrees",
]);

const INDEX_LOCK = new Map<string, Promise<CodeIndexResult>>();

export interface CodeIndexResult {
  rootId: string;
  rootPath: string;
  filesScanned: number;
  chunksUpserted: number;
  chunksRemoved: number;
  embedded: number;
  fingerprint: string;
}

export interface CodeChunkHit {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol: string;
  kind: string;
  snippet: string;
  score: number;
}

function rootIdFor(rootPath: string): string {
  return createHash("sha256").update(rootPath).digest("hex").slice(0, 16);
}

/**
 * Collect indexable relative paths under absRoot.
 * Stops once `maxFiles` indexable files are found (does not walk the whole tree first).
 */
export function walkFiles(absRoot: string, maxFiles = Infinity): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) return;
      if (ent.name.startsWith(".") && ent.name !== ".cursor") continue;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name));
        continue;
      }
      if (!ent.isFile()) continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(absRoot, abs).replace(/\\/g, "/");
      if (isIndexableSourcePath(rel)) out.push(rel);
    }
  };
  walk(absRoot);
  return out.sort();
}

function fileFingerprint(absRoot: string, relPaths: string[]): string {
  const h = createHash("sha256");
  for (const rel of relPaths) {
    const abs = path.join(absRoot, rel);
    let mtime = "0";
    let size = "0";
    try {
      const st = fs.statSync(abs);
      mtime = String(st.mtimeMs);
      size = String(st.size);
    } catch {
      /* missing */
    }
    h.update(`${rel}|${mtime}|${size}\n`);
  }
  return h.digest("hex").slice(0, 24);
}

function ensureRoot(db: AppDatabase, rootPath: string): string {
  const id = rootIdFor(rootPath);
  db.prepare(
    `INSERT INTO code_index_roots (id, root_path, fingerprint, updated_at)
     VALUES (?, ?, '', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET root_path = excluded.root_path`
  ).run(id, rootPath);
  return id;
}

function chunkId(rootId: string, draft: CodeChunkDraft): string {
  return createHash("sha256")
    .update(
      `${rootId}|${draft.path}|${draft.kind}|${draft.symbol}|${draft.startLine}|${draft.contentHash}`
    )
    .digest("hex")
    .slice(0, 24);
}

/**
 * Sync code_chunks for a coding root. Best-effort embeds via the `code` profile.
 * Idempotent; skips full rewrite when fingerprint unchanged unless force.
 */
export async function syncCodeIndex(
  db: AppDatabase,
  opts: FsRootOpts & {
    embedder?: EmbeddingClient | null;
    force?: boolean;
    maxFiles?: number;
  } = {}
): Promise<CodeIndexResult> {
  const rootPath = path.resolve(resolveCodingRoot(opts));
  const lockKey = rootPath;
  const existing = INDEX_LOCK.get(lockKey);
  if (existing) return existing;

  const run = (async (): Promise<CodeIndexResult> => {
    const rootId = ensureRoot(db, rootPath);
    const maxFiles = opts.maxFiles ?? 4_000;
    const files = walkFiles(rootPath, maxFiles);
    const fingerprint = fileFingerprint(rootPath, files);
    const prev = db
      .prepare(`SELECT fingerprint FROM code_index_roots WHERE id = ?`)
      .get(rootId) as { fingerprint: string } | undefined;
    if (!opts.force && prev?.fingerprint === fingerprint) {
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS n,
                  SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS e
           FROM code_chunks WHERE root_id = ?`
        )
        .get(rootId) as { n: number; e: number };
      return {
        rootId,
        rootPath,
        filesScanned: files.length,
        chunksUpserted: 0,
        chunksRemoved: 0,
        embedded: Number(counts.e ?? 0),
        fingerprint,
      };
    }

    const keepIds = new Set<string>();
    let chunksUpserted = 0;
    const pendingEmbed: Array<{ id: string; text: string }> = [];
    const profile = resolveEmbedProfile("code");
    const modelId = embedProfileModelId(profile);

    let fileIndex = 0;
    for (const rel of files) {
      // Yield periodically so HTTP stays responsive during large syncs.
      if (fileIndex++ % 25 === 0) {
        await new Promise((r) => setImmediate(r));
      }
      const abs = path.join(rootPath, rel);
      let source = "";
      try {
        source = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      let drafts: CodeChunkDraft[] = [];
      try {
        drafts = await chunkSourceFile(rel, source);
      } catch {
        continue;
      }
      for (const draft of drafts) {
        const id = chunkId(rootId, draft);
        keepIds.add(id);
        const existingChunk = db
          .prepare(
            `SELECT content_hash, embedding FROM code_chunks WHERE id = ?`
          )
          .get(id) as
          | { content_hash: string; embedding: Buffer | null }
          | undefined;
        if (
          existingChunk &&
          existingChunk.content_hash === draft.contentHash &&
          existingChunk.embedding
        ) {
          continue;
        }
        db.prepare(
          `INSERT INTO code_chunks
           (id, root_id, path, language, kind, symbol, start_line, end_line,
            content_hash, text, embedding, embedding_dim, model_id, profile, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'code', datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             path=excluded.path, language=excluded.language, kind=excluded.kind,
             symbol=excluded.symbol, start_line=excluded.start_line,
             end_line=excluded.end_line, content_hash=excluded.content_hash,
             text=excluded.text, embedding=NULL, embedding_dim=NULL,
             model_id=excluded.model_id, updated_at=datetime('now')`
        ).run(
          id,
          rootId,
          draft.path,
          draft.language,
          draft.kind,
          draft.symbol,
          draft.startLine,
          draft.endLine,
          draft.contentHash,
          draft.text,
          modelId
        );
        chunksUpserted++;
        pendingEmbed.push({ id, text: draft.text });
      }
    }

    const stale = db
      .prepare(`SELECT id FROM code_chunks WHERE root_id = ?`)
      .all(rootId) as Array<{ id: string }>;
    let chunksRemoved = 0;
    for (const row of stale) {
      if (keepIds.has(row.id)) continue;
      db.prepare(`DELETE FROM code_chunks WHERE id = ?`).run(row.id);
      chunksRemoved++;
    }

    let embedded = 0;
    const embedder = opts.embedder;
    if (pendingEmbed.length) {
      if (isEmbedQueueEnabled()) {
        for (const item of pendingEmbed) {
          const jobId = enqueueEmbedJob({
            tenantId: opts.tenantId ?? "",
            profile: "code",
            lane: "backfill",
            targetKind: "code_chunk",
            targetId: item.id,
            text: item.text,
            extra: { modelId },
          });
          if (jobId) embedded++;
        }
      } else if (embedder?.isReady()) {
        const batchSize = 16;
        for (let i = 0; i < pendingEmbed.length; i += batchSize) {
          const batch = pendingEmbed.slice(i, i + batchSize);
          const vectors = await embedder.embedBatch(
            batch.map((b) => b.text),
            { profile: "code" }
          );
          if (!vectors) break;
          for (let j = 0; j < batch.length; j++) {
            const vec = vectors[j];
            if (!vec) continue;
            db.prepare(
              `UPDATE code_chunks
               SET embedding = ?, embedding_dim = ?, model_id = ?, updated_at = datetime('now')
               WHERE id = ?`
            ).run(vectorToBlob(vec), vec.length, modelId, batch[j].id);
            embedded++;
          }
        }
        if (embedded > 0) scheduleAnnInvalidate(`code:${rootId}`);
      }
    }

    db.prepare(
      `UPDATE code_index_roots SET fingerprint = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(fingerprint, rootId);

    return {
      rootId,
      rootPath,
      filesScanned: files.length,
      chunksUpserted,
      chunksRemoved,
      embedded,
      fingerprint,
    };
  })();

  INDEX_LOCK.set(lockKey, run);
  try {
    return await run;
  } finally {
    INDEX_LOCK.delete(lockKey);
  }
}

/** Brute-force cosine over embedded chunks for a root (optional path prefix). */
export function searchCodeChunks(
  db: AppDatabase,
  opts: {
    rootPath: string;
    queryVec: Float32Array;
    pathPrefix?: string;
    limit?: number;
  }
): CodeChunkHit[] {
  const rootId = rootIdFor(path.resolve(opts.rootPath));
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  let rows: Array<{
    id: string;
    path: string;
    start_line: number;
    end_line: number;
    symbol: string;
    kind: string;
    text: string;
    embedding: Buffer;
  }>;
  try {
    rows = db
      .prepare(
        `SELECT id, path, start_line, end_line, symbol, kind, text, embedding
         FROM code_chunks
         WHERE root_id = ? AND embedding IS NOT NULL`
      )
      .all(rootId) as typeof rows;
  } catch {
    return [];
  }

  const prefix = opts.pathPrefix?.replace(/\\/g, "/").replace(/^\.\//, "");
  const docs: Array<{
    id: string;
    vec: Float32Array;
    row: (typeof rows)[number];
  }> = [];
  for (const row of rows) {
    if (prefix && !row.path.replace(/\\/g, "/").startsWith(prefix)) continue;
    const vec = blobToVector(row.embedding);
    if (!vec) continue;
    docs.push({ id: row.id, vec, row });
  }
  const hits = searchVectors(`code:${rootId}`, docs, opts.queryVec, limit);
  const byId = new Map(docs.map((d) => [d.id, d.row]));
  return hits
    .map((h) => {
      const row = byId.get(h.id);
      if (!row) return null;
      return {
        id: row.id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        symbol: row.symbol,
        kind: row.kind,
        snippet: row.text.slice(0, 200).replace(/\s+/g, " ").trim(),
        score: h.score,
      };
    })
    .filter((x): x is CodeChunkHit => x != null);
}
