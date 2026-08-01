/**
 * Tenant self-serve workspace SQLite export (#235).
 * Consistent snapshot via better-sqlite3 backup API (not a live WAL copy).
 * Contrast platform admin DR (#243): this is one tenant file only, no DuckDB/core.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable, Writable } from "node:stream";
import Database from "better-sqlite3";
import type { CoreDatabase } from "../core-db.js";
import type { AppDatabase } from "../db.js";

export class TenantDatabaseExportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TenantDatabaseExportError";
    this.status = status;
  }
}

/** Safe download basename fragment from tenant slug (no path separators). */
export function sanitizeWorkspaceFilenameSlug(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 64) || "workspace";
}

async function backupSqliteToFile(
  db: Database.Database,
  destFile: string
): Promise<void> {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  await db.backup(destFile);
  const verification = new Database(destFile, { readonly: true });
  try {
    const result = verification.pragma("quick_check", { simple: true });
    if (result !== "ok") {
      throw new Error(`Snapshot verification failed: ${String(result)}`);
    }
  } finally {
    verification.close();
  }
}

/**
 * Write a consistent SQLite snapshot of the live tenant DB to a temp file.
 * Caller must unlink the returned path when finished streaming.
 */
export async function createTenantDatabaseSnapshot(
  tenantDb: AppDatabase
): Promise<{ filePath: string; bytes: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-tenant-export-"));
  const filePath = path.join(dir, "workspace.sqlite");
  try {
    await backupSqliteToFile(tenantDb, filePath);
    const bytes = fs.statSync(filePath).size;
    if (bytes <= 0) {
      throw new TenantDatabaseExportError(500, "Empty workspace snapshot");
    }
    return { filePath, bytes };
  } catch (err) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup */
    }
    if (err instanceof TenantDatabaseExportError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new TenantDatabaseExportError(
      500,
      `Workspace snapshot failed: ${message}`
    );
  }
}

/** Stream a snapshot file to an HTTP response (or other writable). */
export async function streamTenantSqliteFile(
  filePath: string,
  dest: Writable
): Promise<void> {
  const readable: Readable = createReadStream(filePath);
  await pipeline(readable, dest);
}

/** Remove temp snapshot directory created by createTenantDatabaseSnapshot. */
export function cleanupTenantSnapshot(filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

export function logTenantDatabaseDownloadAudit(
  core: CoreDatabase,
  entry: {
    userId: string;
    tenantId: string;
    bytes: number;
    result: "ok" | "failed";
    error?: string | null;
  }
): void {
  try {
    core.exec(`
      CREATE TABLE IF NOT EXISTS platform_action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        scope TEXT,
        payload_hash TEXT,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          userId: entry.userId,
          tenantId: entry.tenantId,
          bytes: entry.bytes,
          error: entry.error ?? null,
        })
      )
      .digest("hex")
      .slice(0, 16);
    core
      .prepare(
        `INSERT INTO platform_action_log (agent_id, action, scope, payload_hash, result)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        `user:${entry.userId}`,
        "tenant.database.download",
        `tenant:${entry.tenantId}`,
        payloadHash,
        entry.result === "ok" ? "ok" : `failed:${entry.error ?? "error"}`
      );
  } catch {
    /* never break download on audit failure */
  }
}

export function lookupTenantSlug(
  core: CoreDatabase,
  tenantId: string
): string | null {
  const row = core
    .prepare(`SELECT slug FROM tenants WHERE id=?`)
    .get(tenantId) as { slug: string } | undefined;
  return row?.slug ?? null;
}
