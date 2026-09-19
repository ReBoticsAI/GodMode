/**
 * First-class SQLite-universe tools for Agents/Humans (Phase 6 scaffold).
 * Tools list/query allowlisted paths via the registry open-set jail.
 */
import {
  listUniverseEntries,
  listUniverseManifest,
  prepareOpenSet,
  resolveUniversePath,
} from "./sqlite-universe-registry.js";
import Database from "better-sqlite3";

export const SQLITE_UNIVERSE_TOOL_NAMES = [
  "list_sqlite_universe",
  "query_sqlite_universe",
] as const;

export function listSqliteUniverseTool(): {
  entries: ReturnType<typeof listUniverseEntries>;
  manifest: ReturnType<typeof listUniverseManifest>;
} {
  return {
    entries: listUniverseEntries(),
    manifest: listUniverseManifest(),
  };
}

export function querySqliteUniverseTool(opts: {
  relativePath: string;
  sql: string;
  params?: unknown[];
}): { columns: string[]; rows: unknown[] } {
  const resolved = resolveUniversePath(opts.relativePath);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  // Read-only allowlist: SELECT / WITH / PRAGMA table_info only.
  const trimmed = opts.sql.trim().replace(/;+\s*$/, "");
  const head = trimmed.slice(0, 12).toUpperCase();
  if (
    !head.startsWith("SELECT") &&
    !head.startsWith("WITH") &&
    !head.startsWith("PRAGMA")
  ) {
    throw new Error("Only read-only SELECT/WITH/PRAGMA queries allowed");
  }
  prepareOpenSet([resolved.relativePath]);
  const db = new Database(resolved.absolutePath, { readonly: true });
  try {
    const stmt = db.prepare(trimmed);
    const rows = stmt.all(...(opts.params ?? [])) as unknown[];
    const columns =
      rows.length > 0 && rows[0] && typeof rows[0] === "object"
        ? Object.keys(rows[0] as object)
        : [];
    return { columns, rows };
  } finally {
    db.close();
  }
}
