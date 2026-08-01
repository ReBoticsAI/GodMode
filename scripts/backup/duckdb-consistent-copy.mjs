/**
 * Consistent DuckDB file copy for online backups.
 * Uses ATTACH (READ_ONLY) + COPY FROM DATABASE so writers on the source
 * do not produce a torn file-level copy.
 */
import fs from "node:fs";
import path from "node:path";

function sqlPath(p) {
  return p.replace(/\\/g, "/").replace(/'/g, "''");
}

function run(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function all(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows ?? [])));
  });
}

async function loadDuckDb() {
  const mod = await import("duckdb");
  return mod.default ?? mod;
}

/**
 * Copy src.duckdb → dest.duckdb via DuckDB COPY FROM DATABASE.
 * Verifies dest is non-empty and openable (SELECT 1).
 */
export async function consistentCopyDuckDb(src, destFile) {
  if (!fs.existsSync(src)) {
    throw new Error(`DuckDB source missing: ${src}`);
  }
  const srcStat = fs.statSync(src);
  if (srcStat.size <= 0) {
    throw new Error(`DuckDB source empty: ${src}`);
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  if (fs.existsSync(destFile)) fs.unlinkSync(destFile);

  const duckdb = await loadDuckDb();
  const Database = duckdb.Database;
  if (typeof Database !== "function") {
    throw new Error("duckdb.Database is unavailable in this image");
  }

  const db = new Database(":memory:");
  const conn = typeof db.connect === "function" ? db.connect() : db;
  const srcEsc = sqlPath(src);
  const destEsc = sqlPath(destFile);
  try {
    await run(conn, `ATTACH '${srcEsc}' AS src (READ_ONLY)`);
    await run(conn, `ATTACH '${destEsc}' AS dst`);
    await run(conn, `COPY FROM DATABASE src TO dst`);
    await run(conn, `DETACH dst`);
    await run(conn, `DETACH src`);
  } finally {
    try {
      conn.close?.();
    } catch {
      /* ignore */
    }
    try {
      db.close?.();
    } catch {
      /* ignore */
    }
  }

  await verifyDuckDbFile(destFile);
}

/** Lightweight integrity: exists, non-empty, opens and runs SELECT 1. */
export async function verifyDuckDbFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`DuckDB snapshot missing: ${file}`);
  }
  const st = fs.statSync(file);
  if (st.size <= 0) {
    throw new Error(`DuckDB snapshot empty: ${file}`);
  }

  const duckdb = await loadDuckDb();
  const Database = duckdb.Database;
  const db = new Database(file, { access_mode: "READ_ONLY" });
  const conn = typeof db.connect === "function" ? db.connect() : db;
  try {
    const rows = await all(conn, "SELECT 1 AS ok");
    if (!rows?.length) {
      throw new Error(`DuckDB open check returned no rows: ${file}`);
    }
  } finally {
    try {
      conn.close?.();
    } catch {
      /* ignore */
    }
    try {
      db.close?.();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Snapshot all {dataDir}/timeseries/tenant=* /analytics.duckdb into destRoot
 * mirroring the tenant=* layout.
 * @returns {Promise<string[]>} relative paths written (posix-style)
 */
export async function snapshotTimeseriesTree(dataDir, destRoot) {
  const tsRoot = path.join(dataDir, "timeseries");
  const written = [];
  if (!fs.existsSync(tsRoot)) {
    console.log("No timeseries/ dir — skipping DuckDB snapshot");
    return written;
  }

  for (const ent of fs.readdirSync(tsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory() || !ent.name.startsWith("tenant=")) continue;
    const src = path.join(tsRoot, ent.name, "analytics.duckdb");
    if (!fs.existsSync(src)) {
      console.warn(`skip missing ${src}`);
      continue;
    }
    const dest = path.join(destRoot, ent.name, "analytics.duckdb");
    await consistentCopyDuckDb(src, dest);
    written.push(`timeseries/${ent.name}/analytics.duckdb`);
    console.log(`DuckDB snapshot: ${ent.name}/analytics.duckdb`);
  }
  return written;
}
