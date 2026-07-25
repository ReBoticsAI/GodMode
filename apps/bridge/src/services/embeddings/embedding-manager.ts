import { config } from "../../config.js";
import type { AppDatabase } from "../../db.js";
import { getCoreDb, listAllTenantIds } from "../../core-db.js";
import { getTenantDb } from "../../tenant-registry.js";
import { CpuLlamaServer, type CpuServerStatus } from "./cpu-llama-server.js";
import { EmbeddingClient } from "./embedding-client.js";
import { backfillMemoryEmbeddings } from "./memory-embeddings.js";
import { backfillWikiFts } from "../wiki-rag.js";
import { EmbedQueueWorker } from "./embed-queue-worker.js";
import {
  codeProfileUsesSeparateServer,
  embedProfileModelId,
  listEmbedProfileIds,
  resolveEmbedProfile,
  type EmbedProfileId,
} from "./profiles.js";

export interface EmbedProfileStatus {
  id: EmbedProfileId;
  label: string;
  consumers: string[];
  modelId: string;
  modelPath: string;
  port: number;
  pooling: string;
  dim: number | null;
  ready: boolean;
  separateServer: boolean;
  server: CpuServerStatus;
}

export interface EmbeddingEngineStatus {
  enabled: boolean;
  /** True only when the persisted override (ai_settings.embeddingsEnabled) is set. */
  enabledOverride: boolean | null;
  /** Primary / memory embedder (back-compat). */
  embedder: CpuServerStatus;
  profiles: EmbedProfileStatus[];
}

/** Persisted runtime override key for the master enable flag. */
const SETTING_ENABLED = "embeddingsEnabled";
/** Legacy key (formerly shared with the removed curator engine). */
const LEGACY_SETTING_ENABLED = "curatorEnabled";

/**
 * Lifecycle owner for CPU embedder llama-server(s) powering semantic RAG.
 * Profiles: `memory` (default) and `code` (may share the same server).
 */
export class EmbeddingManager {
  private readonly memoryServer: CpuLlamaServer;
  private readonly codeServer: CpuLlamaServer | null;
  private readonly memoryClient: EmbeddingClient;
  private readonly codeClient: EmbeddingClient;
  private readonly embedQueueWorker: EmbedQueueWorker;

  constructor(private readonly db: AppDatabase) {
    const memory = resolveEmbedProfile("memory");
    this.memoryServer = new CpuLlamaServer({
      role: "embedder-memory",
      modelPath: memory.modelPath,
      port: memory.port,
      ctxSize: memory.ctxSize,
      threads: config.embeddings.threads,
      extraArgs: ["--embeddings", "--pooling", memory.pooling],
    });
    this.memoryClient = new EmbeddingClient(this.memoryServer, "memory");

    if (codeProfileUsesSeparateServer()) {
      const code = resolveEmbedProfile("code");
      this.codeServer = new CpuLlamaServer({
        role: "embedder-code",
        modelPath: code.modelPath,
        port: code.port,
        ctxSize: code.ctxSize,
        threads: config.embeddings.threads,
        extraArgs: ["--embeddings", "--pooling", code.pooling],
      });
      this.codeClient = new EmbeddingClient(this.codeServer, "code");
    } else {
      this.codeServer = null;
      this.codeClient = this.memoryClient;
    }
    this.embedQueueWorker = new EmbedQueueWorker(this, this.db);
  }

  get enabled(): boolean {
    const override = this.readEnabledOverride();
    return override ?? config.embeddings.enabled;
  }

  private readEnabledOverride(): boolean | null {
    try {
      const row = this.db
        .prepare("SELECT value FROM ai_settings WHERE key = ?")
        .get(SETTING_ENABLED) as { value: string } | undefined;
      if (row) return row.value === "true" || row.value === "1";
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

  /** Default memory client (back-compat for wiki/memory/capability callers). */
  getEmbeddingClient(profile: EmbedProfileId = "memory"): EmbeddingClient {
    return profile === "code" ? this.codeClient : this.memoryClient;
  }

  isEmbedderReady(profile: EmbedProfileId = "memory"): boolean {
    return this.getEmbeddingClient(profile).isReady();
  }

  getStatus(): EmbeddingEngineStatus {
    const separate = codeProfileUsesSeparateServer();
    const profiles: EmbedProfileStatus[] = listEmbedProfileIds().map((id) => {
      const cfg = resolveEmbedProfile(id);
      const client = this.getEmbeddingClient(id);
      const server =
        id === "code" && this.codeServer
          ? this.codeServer.getStatus()
          : this.memoryServer.getStatus();
      return {
        id,
        label: cfg.label,
        consumers: cfg.consumers,
        modelId: embedProfileModelId(cfg),
        modelPath: cfg.modelPath,
        port: cfg.port,
        pooling: cfg.pooling,
        dim: client.getLastDim(),
        ready: client.isReady(),
        separateServer: id === "code" ? separate : false,
        server,
      };
    });
    return {
      enabled: this.enabled,
      enabledOverride: this.readEnabledOverride(),
      embedder: this.memoryServer.getStatus(),
      profiles,
    };
  }

  async start(): Promise<EmbeddingEngineStatus> {
    await this.memoryServer.start();
    if (this.codeServer) {
      await this.codeServer.start();
    }
    if (this.memoryServer.isReady()) {
      void this.backfillAllTenants();
    }
    if (this.codeClient.isReady()) {
      void this.softBackfillCodeIndexes();
    }
    this.embedQueueWorker.start();
    return this.getStatus();
  }

  private async backfillAllTenants(): Promise<void> {
    const client = this.memoryClient;
    const dbs = this.listTenantDbs();
    for (const { tenantId, db } of dbs) {
      try {
        await backfillMemoryEmbeddings(db, client, { tenantId: tenantId || null });
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

  /** Non-blocking code-index warm for coding roots (does not block chat). */
  private async softBackfillCodeIndexes(): Promise<void> {
    const { syncCodeIndex } = await import("../coding/code-index.js");
    const embedder = this.codeClient;
    for (const { tenantId, db } of this.listTenantDbs()) {
      try {
        await syncCodeIndex(db, {
          tenantId: tenantId || null,
          embedder,
          maxFiles: 400,
        });
      } catch (err) {
        console.warn(
          "[embeddings] code index soft backfill failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  async ensureTenantBackfill(tenantId: string | undefined): Promise<void> {
    if (!this.enabled || !this.memoryServer.isReady()) return;
    try {
      const db = tenantId ? getTenantDb(tenantId) : this.db;
      await backfillMemoryEmbeddings(db, this.memoryClient, {
        maxRows: 200,
        tenantId: tenantId ?? null,
      });
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
    this.embedQueueWorker.stop();
    if (this.codeServer) await this.codeServer.stop();
    await this.memoryServer.stop();
    return this.getStatus();
  }

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
