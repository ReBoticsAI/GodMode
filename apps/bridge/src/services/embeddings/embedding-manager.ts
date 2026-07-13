import { config } from "../../config.js";
import type { AppDatabase } from "../../db.js";
import { getCoreDb, listAllTenantIds } from "../../core-db.js";
import { getTenantDb } from "../../tenant-registry.js";
import { CpuLlamaServer, type CpuServerStatus } from "./cpu-llama-server.js";
import { EmbeddingClient } from "./embedding-client.js";
import { backfillMemoryEmbeddings } from "./memory-embeddings.js";
import { backfillWikiFts } from "../wiki-rag.js";

export interface EmbeddingEngineStatus {
  enabled: boolean;
  /** True only when the persisted override (ai_settings.embeddingsEnabled) is set. */
  enabledOverride: boolean | null;
  embedder: CpuServerStatus;
}

/** Persisted runtime override key for the master enable flag. */
const SETTING_ENABLED = "embeddingsEnabled";
/** Legacy key (formerly shared with the removed curator engine). */
const LEGACY_SETTING_ENABLED = "curatorEnabled";

/**
 * Lifecycle owner for the CPU embedder llama-server that powers semantic (RAG)
 * memory retrieval. Spawns/health-checks the embedder, auto-starts on boot when
 * enabled, and degrades gracefully: if the feature flag is off nothing spawns
 * and {@link isEmbedderReady} returns false so chat/RAG fall back to recency.
 */
export class EmbeddingManager {
  private readonly embedderServer: CpuLlamaServer;
  private readonly embeddingClient: EmbeddingClient;

  constructor(private readonly db: AppDatabase) {
    this.embedderServer = new CpuLlamaServer({
      role: "embedder",
      modelPath: config.embeddings.embedderModelPath,
      port: config.embeddings.embedderPort,
      ctxSize: config.embeddings.embedderCtxSize,
      threads: config.embeddings.threads,
      // EmbeddingGemma: mean pooling over the last hidden states.
      extraArgs: ["--embeddings", "--pooling", "mean"],
    });
    this.embeddingClient = new EmbeddingClient(this.embedderServer);
  }

  /**
   * Effective master flag: the persisted runtime override
   * (ai_settings.embeddingsEnabled) wins when present, otherwise the
   * env-derived config default. Lets the user flip the engine from the UI and
   * have it survive a bridge restart.
   */
  get enabled(): boolean {
    const override = this.readEnabledOverride();
    return override ?? config.embeddings.enabled;
  }

  /** The raw persisted override, or null when unset (config default applies). */
  private readEnabledOverride(): boolean | null {
    try {
      const row = this.db
        .prepare("SELECT value FROM ai_settings WHERE key = ?")
        .get(SETTING_ENABLED) as { value: string } | undefined;
      if (row) return row.value === "true" || row.value === "1";
      // Back-compat: honor a pre-existing enable flag from the old engine.
      const legacy = this.db
        .prepare("SELECT value FROM ai_settings WHERE key = ?")
        .get(LEGACY_SETTING_ENABLED) as { value: string } | undefined;
      if (legacy) return legacy.value === "true" || legacy.value === "1";
      return null;
    } catch {
      return null;
    }
  }

  private writeEnabledOverride(enabled: boolean): void {
    try {
      this.db
        .prepare(
          `INSERT INTO ai_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        )
        .run(SETTING_ENABLED, enabled ? "true" : "false");
    } catch (err) {
      console.warn(
        "[embeddings] failed to persist enable override:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Persist the master enable flag and reconcile the server: enabling starts
   * the embedder, disabling stops it. Returns the resulting status.
   */
  async setEnabled(enabled: boolean): Promise<EmbeddingEngineStatus> {
    this.writeEnabledOverride(enabled);
    try {
      if (enabled) {
        await this.start();
      } else {
        await this.stop();
      }
    } catch (err) {
      console.warn(
        "[embeddings] setEnabled reconcile failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
    return this.getStatus();
  }

  getEmbeddingClient(): EmbeddingClient {
    return this.embeddingClient;
  }

  isEmbedderReady(): boolean {
    return this.embedderServer.isReady();
  }

  getStatus(): EmbeddingEngineStatus {
    return {
      enabled: this.enabled,
      enabledOverride: this.readEnabledOverride(),
      embedder: this.embedderServer.getStatus(),
    };
  }

  /** Start the embedder server (idempotent). External attach when EMBEDDINGS_EXTERNAL. */
  async start(): Promise<EmbeddingEngineStatus> {
    await this.embedderServer.start();
    // Best-effort, non-blocking backfill across operator + every tenant workspace DB.
    if (this.embedderServer.isReady()) {
      void this.backfillAllTenants();
    }
    return this.getStatus();
  }

  /**
   * Embed missing memory vectors for the operator DB and each tenant workspace.
   * Also ensures wiki FTS rows exist on core (wiki embeddings backfill when ready).
   */
  private async backfillAllTenants(): Promise<void> {
    const client = this.embeddingClient;
    const dbs = this.listTenantDbs();
    for (const { db } of dbs) {
      try {
        await backfillMemoryEmbeddings(db, client);
      } catch (err) {
        console.warn(
          "[embeddings] tenant memory backfill failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    try {
      backfillWikiFts(getCoreDb());
    } catch {
      /* optional */
    }
  }

  /** Lazy backfill for the current work/engine tenant on first chat when enabled. */
  async ensureTenantBackfill(tenantId: string | undefined): Promise<void> {
    if (!this.enabled || !this.embedderServer.isReady()) return;
    try {
      const db = tenantId ? getTenantDb(tenantId) : this.db;
      await backfillMemoryEmbeddings(db, this.embeddingClient, { maxRows: 200 });
    } catch {
      /* best-effort */
    }
  }

  private listTenantDbs(): Array<{ tenantId: string; db: AppDatabase }> {
    const out: Array<{ tenantId: string; db: AppDatabase }> = [];
    try {
      for (const id of listAllTenantIds(getCoreDb())) {
        try {
          out.push({ tenantId: id, db: getTenantDb(id) });
        } catch {
          /* skip */
        }
      }
    } catch {
      /* core unavailable */
    }
    if (out.length === 0) out.push({ tenantId: "", db: this.db });
    return out;
  }

  async stop(): Promise<EmbeddingEngineStatus> {
    await this.embedderServer.stop();
    return this.getStatus();
  }

  /** Boot hook: launch the embedder only when both enabled and autoStart are set. */
  async maybeAutoStart(): Promise<void> {
    if (!this.enabled || !config.embeddings.autoStart) return;
    try {
      await this.start();
    } catch (err) {
      console.warn(
        "[embeddings] auto-start failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  shutdown(): void {
    void this.stop();
  }
}
