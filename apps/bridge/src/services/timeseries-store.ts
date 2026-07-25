/**
 * Platform analytics store (#140).
 * Thin wrapper around a persistent DuckDB file per tenant.
 * Not for market ticks (those belong in domain trading plugins).
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type TimeseriesDataset = string;

export type MetricRow = Record<string, string | number | boolean | null>;

export type AppendOpts = {
  tenantId?: string | null;
};

const FLUSH_INTERVAL_MS = Number(process.env.TS_FLUSH_INTERVAL_MS ?? 5000);
const FLUSH_ROW_THRESHOLD = Number(process.env.TS_FLUSH_ROWS ?? 200);
const DEFAULT_TENANT = "platform";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DuckConn = any;

let duckdbMod: DuckConn | null = null;

async function loadDuckDb(): Promise<DuckConn | null> {
  if (duckdbMod) return duckdbMod;
  try {
    const mod = await import("duckdb");
    duckdbMod = (mod as { default?: DuckConn }).default ?? mod;
    return duckdbMod;
  } catch (err) {
    console.warn(
      "[timeseries] DuckDB unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function timeseriesRoot(): string {
  return path.join(config.dataDir, "timeseries");
}

export function analyticsDbPath(tenantId: string = DEFAULT_TENANT): string {
  const tid = (tenantId || DEFAULT_TENANT).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(timeseriesRoot(), `tenant=${tid}`, "analytics.duckdb");
}

interface BufferBucket {
  tenantId: string;
  dataset: string;
  entity: string;
  rows: MetricRow[];
}

type TenantHandle = {
  db: DuckConn;
  conn: DuckConn;
};

/**
 * Service wrapper around persistent platform-analytics.duckdb files.
 * Dataset + entity are opaque labels (not trading symbols).
 */
export class TimeseriesStore {
  private buffers = new Map<string, BufferBucket>();
  private flushTimer: NodeJS.Timeout | null = null;
  private handles = new Map<string, TenantHandle>();
  private ready = false;

  async init(): Promise<void> {
    fs.mkdirSync(timeseriesRoot(), { recursive: true });
    const mod = await loadDuckDb();
    if (!mod) {
      console.warn("[timeseries] DuckDB unavailable — platform metrics disabled");
      return;
    }
    try {
      await this.openTenant(DEFAULT_TENANT);
      this.ready = true;
      console.log("[timeseries] platform analytics DuckDB ready");
    } catch (err) {
      console.warn(
        "[timeseries] DuckDB init failed:",
        err instanceof Error ? err.message : err
      );
    }
    this.flushTimer = setInterval(() => void this.flushAll(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  isReady(): boolean {
    return this.ready;
  }

  private async openTenant(tenantId: string): Promise<TenantHandle | null> {
    const tid = tenantId || DEFAULT_TENANT;
    const existing = this.handles.get(tid);
    if (existing) return existing;

    const mod = await loadDuckDb();
    if (!mod) return null;
    const Database = mod.Database;
    if (typeof Database !== "function") return null;

    const file = analyticsDbPath(tid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    // Prefer Database as connection surface; fall back to .connect() when present.
    const conn =
      typeof db.connect === "function" ? db.connect() : db;
    await this.run(conn, `
      CREATE TABLE IF NOT EXISTS metrics (
        dataset VARCHAR NOT NULL,
        entity VARCHAR NOT NULL,
        tenant_id VARCHAR NOT NULL,
        ts BIGINT NOT NULL,
        payload VARCHAR
      )
    `);
    try {
      await this.run(
        conn,
        `CREATE INDEX metrics_dataset_ts_idx ON metrics(dataset, ts)`
      );
    } catch {
      /* index may already exist */
    }
    try {
      await this.run(
        conn,
        `CREATE INDEX metrics_entity_ts_idx ON metrics(entity, ts)`
      );
    } catch {
      /* index may already exist */
    }
    const handle = { db, conn };
    this.handles.set(tid, handle);
    return handle;
  }

  private run(conn: DuckConn, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.run(sql, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private all(conn: DuckConn, sql: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      conn.all(sql, (err: Error | null, rows: unknown[] | undefined) => {
        if (err) reject(err);
        else resolve(rows ?? []);
      });
    });
  }

  private bucketKey(tenantId: string, dataset: string, entity: string): string {
    return `${tenantId}\0${dataset}\0${entity}`;
  }

  /**
   * Append a platform / plugin telemetry row.
   * @param entity opaque key (was historically named "symbol")
   */
  append(
    dataset: TimeseriesDataset,
    entity: string,
    row: MetricRow,
    opts: AppendOpts = {}
  ): void {
    if (!this.ready) return;
    const tenantId = opts.tenantId || DEFAULT_TENANT;
    const key = this.bucketKey(tenantId, dataset, entity);
    let bucket = this.buffers.get(key);
    if (!bucket) {
      bucket = { tenantId, dataset, entity, rows: [] };
      this.buffers.set(key, bucket);
    }
    bucket.rows.push({
      ...row,
      ts: row.ts ?? Date.now(),
    });
    if (bucket.rows.length >= FLUSH_ROW_THRESHOLD) {
      void this.flushKey(key);
    }
  }

  /** Prefer this name in new call sites (alias of append). */
  appendPlatformMetric(
    dataset: TimeseriesDataset,
    entity: string,
    row: MetricRow,
    opts: AppendOpts = {}
  ): void {
    this.append(dataset, entity, row, opts);
  }

  appendBatch(
    dataset: TimeseriesDataset,
    entity: string,
    rows: MetricRow[],
    opts: AppendOpts = {}
  ): void {
    for (const row of rows) this.append(dataset, entity, row, opts);
  }

  private async flushKey(key: string): Promise<void> {
    const bucket = this.buffers.get(key);
    if (!bucket || bucket.rows.length === 0) return;
    const rows = bucket.rows.splice(0, bucket.rows.length);
    const handle = await this.openTenant(bucket.tenantId);
    if (!handle) return;

    const values = rows
      .map((r) => {
        const ts = Number(r.ts ?? Date.now());
        const payload = JSON.stringify(r).replace(/'/g, "''");
        const ds = bucket.dataset.replace(/'/g, "''");
        const ent = bucket.entity.replace(/'/g, "''");
        const tid = bucket.tenantId.replace(/'/g, "''");
        return `('${ds}','${ent}','${tid}',${ts},'${payload}')`;
      })
      .join(",");

    try {
      await this.run(
        handle.conn,
        `INSERT INTO metrics (dataset, entity, tenant_id, ts, payload) VALUES ${values}`
      );
    } catch (err) {
      console.warn(
        "[timeseries] metrics insert failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  async flushAll(): Promise<void> {
    for (const key of [...this.buffers.keys()]) {
      await this.flushKey(key);
    }
  }

  async query(sql: string, opts: AppendOpts = {}): Promise<unknown[]> {
    const handle = await this.openTenant(opts.tenantId || DEFAULT_TENANT);
    if (!handle) return [];
    return this.all(handle.conn, sql);
  }

  /** Run a single SELECT against the tenant analytics DB (metrics table). */
  async analyticsQuery(sql: string, opts: AppendOpts = {}): Promise<unknown[]> {
    return this.query(sql, opts);
  }

  dbFilePath(tenantId: string = DEFAULT_TENANT): string {
    return analyticsDbPath(tenantId);
  }

  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    for (const h of this.handles.values()) {
      try {
        h.conn?.close?.();
      } catch {
        /* ignore */
      }
      try {
        h.db?.close?.();
      } catch {
        /* ignore */
      }
    }
    this.handles.clear();
    this.ready = false;
    this.buffers.clear();
  }
}

let singleton: TimeseriesStore | null = null;

export function getTimeseriesStore(): TimeseriesStore {
  if (!singleton) {
    singleton = new TimeseriesStore();
  }
  return singleton;
}

export const GRADUATION_TRIGGERS = {
  timeSeries:
    "Move to QuestDB/ClickHouse when platform or plugin analytics outgrow single-file DuckDB",
  vectors:
    "Move to Qdrant when >5-10M vectors or heavy metadata-filtered search",
} as const;

export async function initTimeseriesStore(): Promise<TimeseriesStore> {
  const store = getTimeseriesStore();
  await store.init();
  return store;
}
