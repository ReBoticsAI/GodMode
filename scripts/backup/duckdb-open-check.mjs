#!/usr/bin/env node
/**
 * Lightweight DuckDB open check.
 * Usage: node duckdb-open-check.mjs [/path/to/file.duckdb]
 * Default path: /db.duckdb (restore-drill mount).
 */
import { verifyDuckDbFile } from "./duckdb-consistent-copy.mjs";

const file = process.argv[2] || "/db.duckdb";
try {
  await verifyDuckDbFile(file);
  console.log("ok");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
