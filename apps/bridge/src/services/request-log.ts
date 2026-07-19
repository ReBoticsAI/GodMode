import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { getCoreDb, type CoreDatabase } from "../core-db.js";

export function ensurePlatformRequestLog(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_request_log (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      ip TEXT,
      user_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS platform_request_log_ts_idx
      ON platform_request_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_request_log_level_idx
      ON platform_request_log(level, created_at DESC);
  `);
}

/** Persist warn/error rows; prune oldest when over cap (first-party ops log, no SaaS APM). */
function persistRow(row: {
  level: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string | null;
  userId: string | null;
  error: string | null;
}): void {
  try {
    const core = getCoreDb();
    ensurePlatformRequestLog(core);
    core
      .prepare(
        `INSERT INTO platform_request_log
           (id, level, method, path, status, duration_ms, ip, user_id, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uuidv4(),
        row.level,
        row.method,
        row.path,
        row.status,
        row.durationMs,
        row.ip,
        row.userId,
        row.error
      );
    // Soft retention: keep newest ~5k rows
    core
      .prepare(
        `DELETE FROM platform_request_log
         WHERE id IN (
           SELECT id FROM platform_request_log
           ORDER BY created_at DESC
           LIMIT -1 OFFSET 5000
         )`
      )
      .run();
  } catch {
    /* never break the request path for logging */
  }
}

/**
 * First-party structured request logging for Bridge.
 * Always emits JSON to process stdout/stderr (Docker / Hostinger).
 * Warn/error responses are also persisted to core.sqlite for Admin review.
 */
export function structuredRequestLog(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.path === "/api/health" || req.path === "/health") {
    next();
    return;
  }
  const started = Date.now();
  res.on("finish", () => {
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    const path = req.originalUrl?.split("?")[0] ?? req.path;
    const ip =
      (typeof req.headers["cf-connecting-ip"] === "string"
        ? req.headers["cf-connecting-ip"]
        : null) ??
      req.ip ??
      req.socket.remoteAddress ??
      null;
    const line = {
      ts: new Date().toISOString(),
      level,
      method: req.method,
      path,
      status: res.statusCode,
      ms: Date.now() - started,
      ip,
      userId: req.user?.id ?? null,
    };
    const payload = JSON.stringify(line);
    if (level === "error") console.error(payload);
    else if (level === "warn") console.warn(payload);
    else console.info(payload);

    if (level === "warn" || level === "error") {
      persistRow({
        level,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: line.ms,
        ip,
        userId: line.userId,
        error: level === "error" ? `HTTP ${res.statusCode}` : null,
      });
    }
  });
  next();
}

export function listPlatformRequestLogs(
  core: CoreDatabase,
  opts?: { limit?: number; level?: string }
): Array<{
  id: string;
  level: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string | null;
  userId: string | null;
  error: string | null;
  createdAt: string;
}> {
  ensurePlatformRequestLog(core);
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const level = opts?.level?.trim();
  const rows = level
    ? (core
        .prepare(
          `SELECT * FROM platform_request_log WHERE level=? ORDER BY created_at DESC LIMIT ?`
        )
        .all(level, limit) as Array<Record<string, unknown>>)
    : (core
        .prepare(
          `SELECT * FROM platform_request_log ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as Array<Record<string, unknown>>);
  return rows.map((r) => ({
    id: String(r.id),
    level: String(r.level),
    method: String(r.method),
    path: String(r.path),
    status: Number(r.status),
    durationMs: Number(r.duration_ms),
    ip: (r.ip as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}
