/**
 * In-process embed queue worker (#69 track C).
 * Polls core embed_queue with tenant fairness; rate-limits shared embed HTTP.
 */
import { config } from "../../config.js";
import { getTenantDb } from "../../tenant-registry.js";
import type { AppDatabase } from "../../db.js";
import { RateLimiter } from "../../lib/rate-limit.js";
import { vectorToBlob } from "./embedding-client.js";
import type { EmbeddingManager } from "./embedding-manager.js";
import {
  claimNextEmbedJob,
  completeEmbedJob,
  failEmbedJob,
  recoverStaleEmbedJobs,
  type EmbedQueueJob,
} from "./embed-queue.js";
import { scheduleAnnInvalidate } from "./vector-retrieval.js";

export class EmbedQueueWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly embeddings: EmbeddingManager,
    private readonly operatorDb: AppDatabase
  ) {
    this.limiter = new RateLimiter(
      Math.max(1, config.embeddings.queueRps),
      10_000
    );
  }

  start(): void {
    if (this.timer) return;
    if (!config.embeddings.queueEnabled) return;
    const pollMs = Math.max(200, config.embeddings.queuePollMs);
    this.timer = setInterval(() => void this.tick(), pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const recovered = recoverStaleEmbedJobs();
    if (recovered > 0) {
      console.warn(`[embed-queue] recovered ${recovered} stale running job(s)`);
    }

    const job = claimNextEmbedJob();
    if (!job) return;

    this.running = true;
    try {
      await this.limiter.acquire();
      const ok = await this.runJob(job);
      if (ok) completeEmbedJob(job.id);
      else failEmbedJob(job.id, "embedder unavailable or empty vector");
    } catch (err) {
      failEmbedJob(
        job.id,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      this.running = false;
    }
  }

  private resolveDb(tenantId: string): AppDatabase {
    if (tenantId) {
      try {
        return getTenantDb(tenantId);
      } catch {
        return this.operatorDb;
      }
    }
    return this.operatorDb;
  }

  private async runJob(job: EmbedQueueJob): Promise<boolean> {
    let payload: { text?: string; modelId?: string };
    try {
      payload = JSON.parse(job.payload_json) as {
        text?: string;
        modelId?: string;
      };
    } catch {
      return false;
    }
    const text = (payload.text ?? "").trim();
    if (!text) return false;

    const profile = job.profile === "code" ? "code" : "memory";
    const client = this.embeddings.getEmbeddingClient(profile);
    if (!client.isReady()) return false;

    const vec = await client.embed(text, { profile });
    if (!vec) return false;

    if (job.target_kind === "wiki") {
      const { getCoreDb } = await import("../../core-db.js");
      getCoreDb()
        .prepare(
          `UPDATE wiki_pages SET embedding = ?, embedding_dim = ? WHERE id = ?`
        )
        .run(vectorToBlob(vec), vec.length, job.target_id);
      scheduleAnnInvalidate("wiki:");
      return true;
    }

    const db = this.resolveDb(job.tenant_id);
    if (job.target_kind === "memory") {
      db.prepare(
        `UPDATE ai_memories SET embedding = ?, embedding_dim = ? WHERE id = ?`
      ).run(vectorToBlob(vec), vec.length, job.target_id);
      scheduleAnnInvalidate("memory:");
      return true;
    }

    if (job.target_kind === "code_chunk") {
      const modelId = payload.modelId ?? "";
      db.prepare(
        `UPDATE code_chunks
         SET embedding = ?, embedding_dim = ?, model_id = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(vectorToBlob(vec), vec.length, modelId, job.target_id);
      scheduleAnnInvalidate("code:");
      return true;
    }

    return false;
  }
}
