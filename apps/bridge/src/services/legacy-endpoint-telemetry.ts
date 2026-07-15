import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { CoreDatabase } from "../core-db.js";

const LEGACY_ENDPOINTS: Array<{ key: string; pattern: RegExp }> = [
  { key: "/api/structure", pattern: /^\/api\/structure(?:\/|$)/ },
  { key: "/api/nodes", pattern: /^\/api\/nodes(?:\/|$)/ },
  { key: "/api/departments", pattern: /^\/api\/departments(?:\/|$)/ },
  { key: "/api/divisions", pattern: /^\/api\/divisions(?:\/|$)/ },
  { key: "/api/pages", pattern: /^\/api\/pages(?:\/|$)/ },
  { key: "/api/ai", pattern: /^\/api\/ai(?:\/|$)/ },
  { key: "/api/admin", pattern: /^\/api\/admin(?:\/|$)/ },
  { key: "/api/bank", pattern: /^\/api\/bank(?:\/|$)/ },
  { key: "/api/connections", pattern: /^\/api\/connections(?:\/|$)/ },
  { key: "/api/dm", pattern: /^\/api\/dm(?:\/|$)/ },
  { key: "/api/federation", pattern: /^\/api\/federation(?:\/|$)/ },
  { key: "/api/financial", pattern: /^\/api\/financial(?:\/|$)/ },
  { key: "/api/hooks", pattern: /^\/api\/hooks(?:\/|$)/ },
  { key: "/api/inference", pattern: /^\/api\/inference(?:\/|$)/ },
  { key: "/api/integrations", pattern: /^\/api\/integrations(?:\/|$)/ },
  { key: "/api/marketplace", pattern: /^\/api\/marketplace(?:\/|$)/ },
  { key: "/api/network", pattern: /^\/api\/network(?:\/|$)/ },
  { key: "/api/notifications", pattern: /^\/api\/notifications(?:\/|$)/ },
  { key: "/api/plugins", pattern: /^\/api\/plugins(?:\/|$)/ },
  { key: "/api/shares", pattern: /^\/api\/shares(?:\/|$)/ },
  { key: "/api/support", pattern: /^\/api\/support(?:\/|$)/ },
  { key: "/api/user", pattern: /^\/api\/user(?:\/|$)/ },
  { key: "/api/wiki", pattern: /^\/api\/wiki(?:\/|$)/ },
];
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PROTOCOL_EXCEPTIONS =
  /(?:\/stream|\/upload|\/download|\/typing)(?:\/|$)/;

export function ensureLegacyEndpointTelemetry(core: CoreDatabase): void {
  core.exec(`
    CREATE TABLE IF NOT EXISTS legacy_endpoint_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      endpoint_key TEXT NOT NULL,
      route_path TEXT NOT NULL,
      tenant_id TEXT,
      caller_hash TEXT NOT NULL,
      response_status INTEGER,
      used_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS legacy_endpoint_usage_lookup
      ON legacy_endpoint_usage(endpoint_key, used_at DESC);
  `);
}

function callerHash(req: Request): string {
  const source = [
    req.user?.id ?? "",
    req.get("user-agent") ?? "",
    req.ip ?? "",
  ].join("|");
  return createHash("sha256").update(source).digest("hex").slice(0, 20);
}

export function legacyEndpointTelemetry(core: CoreDatabase) {
  ensureLegacyEndpointTelemetry(core);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !MUTATION_METHODS.has(req.method) ||
      PROTOCOL_EXCEPTIONS.test(req.path)
    ) {
      next();
      return;
    }
    const match = LEGACY_ENDPOINTS.find((entry) => entry.pattern.test(req.path));
    if (!match) {
      next();
      return;
    }
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "ObjectType kernel parity and zero-use validation");
    const result = core
      .prepare(
        `INSERT INTO legacy_endpoint_usage
         (method, endpoint_key, route_path, tenant_id, caller_hash)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        req.method,
        match.key,
        req.path,
        req.tenantId ?? req.get("X-Tenant-Id") ?? null,
        callerHash(req)
      );
    res.on("finish", () => {
      core
        .prepare(
          `UPDATE legacy_endpoint_usage SET response_status=? WHERE id=?`
        )
        .run(res.statusCode, result.lastInsertRowid);
    });
    next();
  };
}

export function legacyEndpointUsageReport(
  core: CoreDatabase,
  windowDays = 30
): Array<{
  endpoint_key: string;
  method: string;
  hits: number;
  callers: number;
  last_used_at: string;
}> {
  ensureLegacyEndpointTelemetry(core);
  const days = Math.max(1, Math.floor(windowDays));
  return core
    .prepare(
      `SELECT endpoint_key, method, COUNT(*) AS hits,
              COUNT(DISTINCT caller_hash) AS callers,
              MAX(used_at) AS last_used_at
       FROM legacy_endpoint_usage
       WHERE used_at >= datetime('now', ?)
       GROUP BY endpoint_key, method
       ORDER BY hits DESC, endpoint_key`
    )
    .all(`-${days} days`) as Array<{
    endpoint_key: string;
    method: string;
    hits: number;
    callers: number;
    last_used_at: string;
  }>;
}
