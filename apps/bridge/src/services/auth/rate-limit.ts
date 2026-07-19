import type { Request, Response, NextFunction } from "express";
import { getCoreDb } from "../../core-db.js";
import { config } from "../../config.js";

function clientIp(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * SQLite-backed fixed-window rate limiter (survives process restart).
 * Uses an in-process Map as a short cache to cut DB hits under load.
 */
const memCache = new Map<string, { count: number; resetAt: number }>();

export function durableRateLimit(opts: {
  windowMs: number;
  max: number;
  message?: string;
  /** Extra key suffix (e.g. route name). Default: req.path */
  key?: (req: Request) => string;
}) {
  const { windowMs, max, message = "Too many requests" } = opts;
  return (req: Request, res: Response, next: NextFunction): void => {
    const suffix = opts.key?.(req) ?? req.path;
    const key = `${clientIp(req)}:${suffix}`;
    const now = Date.now();

    const cached = memCache.get(key);
    if (cached && now < cached.resetAt) {
      cached.count += 1;
      if (cached.count > max) {
        res.status(429).json({ error: message });
        return;
      }
      next();
      return;
    }

    try {
      const core = getCoreDb();
      const row = core
        .prepare(`SELECT count, reset_at FROM rate_limit_buckets WHERE bucket_key=?`)
        .get(key) as { count: number; reset_at: number } | undefined;

      let count = 1;
      let resetAt = now + windowMs;
      if (row && now < row.reset_at) {
        count = row.count + 1;
        resetAt = row.reset_at;
      }
      core
        .prepare(
          `INSERT INTO rate_limit_buckets (bucket_key, count, reset_at)
           VALUES (?, ?, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET count=excluded.count, reset_at=excluded.reset_at`
        )
        .run(key, count, resetAt);
      memCache.set(key, { count, resetAt });
      if (count > max) {
        res.status(429).json({ error: message });
        return;
      }
    } catch {
      // Schema may not exist yet during early boot tests — fall back to memory.
      const bucket = memCache.get(key);
      if (!bucket || now >= bucket.resetAt) {
        memCache.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        bucket.count += 1;
        if (bucket.count > max) {
          res.status(429).json({ error: message });
          return;
        }
      }
    }
    next();
  };
}

/** Prefer durable limiter; keep name-compatible export used by routes. */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  return durableRateLimit(opts);
}

/**
 * CSRF defense for cookie-authenticated mutating requests on hub/saas.
 * Webhooks and Bearer-only clients are exempt.
 */
export function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!config.isHub && !config.isSaas) {
    next();
    return;
  }
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  // Signature-authenticated webhooks
  if (req.path.includes("/webhook") || req.originalUrl.includes("/webhook")) {
    next();
    return;
  }
  // Bearer API clients (no browser cookie session) are not CSRF-vulnerable via cookies.
  const auth = req.headers.authorization;
  const hasBearer =
    typeof auth === "string" && auth.startsWith("Bearer ") && auth.length > 7;
  const cookie = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  const hasSessionCookie =
    cookie.includes("godmode_session=") || cookie.includes("money_session=");
  if (hasBearer && !hasSessionCookie) {
    next();
    return;
  }
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const referer = typeof req.headers.referer === "string" ? req.headers.referer : "";
  const allowed = config.web.allowedOrigins;
  const okOrigin = origin && allowed.some((o) => origin === o || origin.startsWith(o));
  const okReferer =
    referer && allowed.some((o) => referer === o || referer.startsWith(`${o}/`));
  if (okOrigin || okReferer) {
    next();
    return;
  }
  // Same-origin navigations sometimes omit Origin; require at least one match in prod.
  if (!origin && !referer && !config.isProduction) {
    next();
    return;
  }
  res.status(403).json({ error: "Untrusted Origin" });
}
