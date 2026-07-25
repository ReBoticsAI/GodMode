/**
 * Platform TimeseriesStore (#140) — persistent DuckDB, no SC residue.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gm-ts-"));

vi.mock("../../config.js", () => ({
  config: {
    dataDir: tmpRoot,
    isSaas: false,
    isHub: false,
  },
}));

const { TimeseriesStore, analyticsDbPath } = await import("../timeseries-store.js");

describe("TimeseriesStore platform analytics", () => {
  let store: InstanceType<typeof TimeseriesStore>;

  beforeEach(async () => {
    store?.shutdown();
    store = new TimeseriesStore();
    await store.init();
  });

  it("opens a tenant-scoped analytics.duckdb path", () => {
    expect(analyticsDbPath("platform")).toContain("tenant=platform");
    expect(analyticsDbPath("platform")).toMatch(/analytics\.duckdb$/);
    expect(analyticsDbPath("abc")).toContain("tenant=abc");
  });

  it("round-trips append + query when DuckDB is available", async () => {
    if (!store.isReady()) return;
    store.appendPlatformMetric("embed_queue", "test", { depth: 3, ts: Date.now() });
    await store.flushAll();
    const rows = (await store.analyticsQuery(
      "SELECT dataset, entity, tenant_id FROM metrics WHERE dataset = 'embed_queue'"
    )) as Array<{ dataset: string; entity: string; tenant_id: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.dataset).toBe("embed_queue");
    expect(rows[0]?.entity).toBe("test");
    expect(fs.existsSync(store.dbFilePath("platform"))).toBe(true);
  });

  it("module source has no Sierra table residue", () => {
    const srcPath = fileURLToPath(new URL("../timeseries-store.ts", import.meta.url));
    const text = fs.readFileSync(srcPath, "utf8");
    expect(text).not.toMatch(/sc_timesales/);
    expect(text).not.toMatch(/sc_bars/);
    expect(text).not.toMatch(/rollupTicksTo1m/);
    expect(text).not.toMatch(/backfillSqliteTimeseries/);
  });
});
