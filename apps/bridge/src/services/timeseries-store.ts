import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type TimeseriesDataset = string;

type Row = Record<string, string | number | boolean | null>;

interface BufferBucket {
  rows: Row[];
  lastFlush: number;
}

const FLUSH_INTERVAL_MS = Number(process.env.TS_FLUSH_INTERVAL_MS ?? 5000);
const FLUSH_ROW_THRESHOLD = Number(process.env.TS_FLUSH_ROWS ?? 500);

// DuckDB is loaded dynamically; use loose typing to avoid import() type parse issues in .ts
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
    console.warn("[timeseries] DuckDB unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

function timeseriesRoot(): string {
  return path.join(config.dataDir, "timeseries");
}

function partitionDir(dataset: TimeseriesDataset, symbol: string, date: string): string {
  return path.join(timeseriesRoot(), dataset, `symbol=${symbol}`, `date=${date}`);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export class TimeseriesStore {
  private buffers = new Map<string, BufferBucket>();
  private flushTimer: NodeJS.Timeout | null = null;
  private db: DuckConn | null = null;
  private conn: DuckConn | null = null;

  async init(): Promise<void> {
    fs.mkdirSync(timeseriesRoot(), { recursive: true });
    const mod = await loadDuckDb();
    if (mod) {
      try {
        const Database = mod.Database;
        if (typeof Database !== "function") {
          throw new TypeError("duckdb.Database is not a constructor");
        }
        this.db = new Database(":memory:");
        this.conn = this.db.connect();
        console.log("[timeseries] DuckDB cold store ready");
      } catch (err) {
        console.warn(
          "[timeseries] DuckDB init failed — using JSONL cold store:",
          err instanceof Error ? err.message : err
        );
        this.db = null;
        this.conn = null;
      }
    } else {
      console.warn("[timeseries] DuckDB unavailable — using JSONL cold store");
    }
    this.flushTimer = setInterval(() => void this.flushAll(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  private bucketKey(dataset: TimeseriesDataset, symbol: string): string {
    return `${dataset}:${symbol}`;
  }

  append(dataset: TimeseriesDataset, symbol: string, row: Row): void {
    const key = this.bucketKey(dataset, symbol);
    let bucket = this.buffers.get(key);
    if (!bucket) {
      bucket = { rows: [], lastFlush: Date.now() };
      this.buffers.set(key, bucket);
    }
    bucket.rows.push({ ...row, _symbol: symbol, _dataset: dataset, _ts: row.ts ?? Date.now() });
    if (bucket.rows.length >= FLUSH_ROW_THRESHOLD) {
      void this.flushKey(key);
    }
  }

  appendBatch(dataset: TimeseriesDataset, symbol: string, rows: Row[]): void {
    for (const row of rows) this.append(dataset, symbol, row);
  }

  private async flushKey(key: string): Promise<void> {
    const bucket = this.buffers.get(key);
    if (!bucket || bucket.rows.length === 0) return;
    const rows = bucket.rows.splice(0, bucket.rows.length);
    bucket.lastFlush = Date.now();

    const [dataset, symbol] = key.split(":") as [TimeseriesDataset, string];
    const date = todayUtc();
    const dir = partitionDir(dataset, symbol, date);
    fs.mkdirSync(dir, { recursive: true });

    if (!this.conn) {
      const jsonl = path.join(dir, `part-${Date.now()}.jsonl`);
      fs.appendFileSync(jsonl, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      return;
    }

    const partTs = Date.now();
    const file = path.join(dir, `part-${partTs}.parquet`);
    const tempJson = path.join(dir, `part-${partTs}.json`);
    const sqlPath = (p: string) => p.replace(/\\/g, "/").replace(/'/g, "''");

    try {
      fs.writeFileSync(tempJson, JSON.stringify(rows));
      await new Promise<void>((resolve, reject) => {
        this.conn!.run(`CREATE OR REPLACE TEMP TABLE batch AS SELECT * FROM read_json_auto('${sqlPath(tempJson)}')`, (err: Error | null) => {
          if (err) return reject(err);
          this.conn!.run(`COPY batch TO '${sqlPath(file)}' (FORMAT PARQUET)`, (err2: Error | null) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });
    } catch (err) {
      // Fallback: write JSONL if DuckDB COPY fails
      const jsonl = path.join(dir, `part-${Date.now()}.jsonl`);
      fs.appendFileSync(jsonl, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      console.warn("[timeseries] parquet flush failed, wrote jsonl:", err instanceof Error ? err.message : err);
    } finally {
      try {
        fs.unlinkSync(tempJson);
      } catch {
        /* temp file may not exist if staging failed */
      }
    }
  }

  async flushAll(): Promise<void> {
    for (const key of [...this.buffers.keys()]) {
      await this.flushKey(key);
    }
  }

  async query(sql: string): Promise<unknown[]> {
    if (!this.conn) return [];
    return new Promise((resolve, reject) => {
      this.conn!.all(sql, (err: Error | null, rows: unknown[] | undefined) => {
        if (err) reject(err);
        else resolve(rows ?? []);
      });
    });
  }

  /** Analytics: attach SQLite read-only and scan Parquet glob. */
  async analyticsQuery(
    sql: string,
    sqlitePath = config.dbPath
  ): Promise<unknown[]> {
    if (!this.conn) return [];
    const glob = path.join(timeseriesRoot(), "**", "*.parquet").replace(/\\/g, "/");
    await new Promise<void>((resolve, reject) => {
      this.conn!.run(`ATTACH '${sqlitePath.replace(/\\/g, "/")}' AS app (READ_ONLY)`, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const wrapped = `
      CREATE OR REPLACE VIEW ts_all AS SELECT * FROM read_parquet('${glob}', union_by_name=true);
      ${sql}
    `;
    return this.query(wrapped);
  }

  shutdown(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    void this.flushAll();
    this.conn?.close();
    this.db?.close();
  }
}

let singleton: TimeseriesStore | null = null;

export function getTimeseriesStore(): TimeseriesStore {
  if (!singleton) {
    singleton = new TimeseriesStore();
  }
  return singleton;
}

/** Parquet partition lifecycle + graduation triggers (see plan Phase 5). */
export const GRADUATION_TRIGGERS = {
  sqliteHotStore:
    "Move to Postgres+pgvector when multi-process writers or sustained >10k writes/s",
  timeSeries: "Move to QuestDB/ClickHouse when tick ingest outgrows Parquet+DuckDB on disk",
  vectors: "Move to Qdrant when >5-10M vectors or heavy metadata-filtered search",
} as const;

export async function initTimeseriesStore(): Promise<TimeseriesStore> {
  const store = getTimeseriesStore();
  await store.init();
  return store;
}

/** Backfill SQLite time-series tables into Parquet cold store (tables may be plugin-owned). */
export async function backfillSqliteTimeseries(
  db: import("../db.js").AppDatabase,
  store: TimeseriesStore
): Promise<{ ticks: number; bars: number; extra: number }> {
  let ticks = 0;
  let bars = 0;
  let extra = 0;

  try {
    const tickRows = db
      .prepare(`SELECT symbol, seq, ts, price, size, side FROM sc_timesales`)
      .all() as Array<Record<string, unknown>>;
    for (const r of tickRows) {
      store.append("ticks", String(r.symbol), r as Row);
      ticks++;
    }
  } catch {
    /* plugin table absent on vanilla OSS */
  }

  try {
    const barCols = new Set(
      (db.prepare(`PRAGMA table_info(sc_bars)`).all() as Array<{ name: string }>).map((c) => c.name)
    );
    const volumeExpr = barCols.has("volume")
      ? "volume"
      : barCols.has("total_volume")
        ? "total_volume AS volume"
        : "NULL AS volume";
    if (barCols.has("symbol") && barCols.has("ts")) {
      const barRows = db
        .prepare(`SELECT symbol, ts, open, high, low, close, ${volumeExpr} FROM sc_bars`)
        .all() as Array<Record<string, unknown>>;
      for (const r of barRows) {
        store.append("bars", String(r.symbol), r as Row);
        bars++;
      }
    }
  } catch {
    /* plugin table absent on vanilla OSS */
  }

  await store.flushAll();
  return { ticks, bars, extra };
}

/** Roll up raw tick partitions to 1m bars (best-effort). */
export async function rollupTicksTo1m(store: TimeseriesStore): Promise<void> {
  if (!store) return;
  try {
    await store.analyticsQuery(`
      COPY (
        SELECT symbol, date_trunc('minute', to_timestamp(ts/1000)) AS bar_ts,
               first(price) AS open, max(price) AS high, min(price) AS low, last(price) AS close,
               sum(size) AS volume
        FROM ts_all WHERE _dataset = 'ticks' GROUP BY 1, 2
      ) TO '${path.join(timeseriesRoot(), "bars_1m", "rollup.parquet").replace(/\\/g, "/")}' (FORMAT PARQUET);
    `);
  } catch (err) {
    console.warn("[timeseries] rollup failed:", err instanceof Error ? err.message : err);
  }
}
