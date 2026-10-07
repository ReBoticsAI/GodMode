/**
 * Per-agent (or per-user) fixed-window rate limits for report / support tools.
 * Reuses the same SQLite bucket table as HTTP durableRateLimit when available.
 */
import { getCloudDb } from "../core-db.js";

const memCache = new Map<string, { count: number; resetAt: number }>();

export class AgentToolRateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs: number
  ) {
    super(message);
    this.name = "AgentToolRateLimitError";
  }
}

export function assertAgentToolRateLimit(opts: {
  agentId: string;
  toolName: string;
  /** Max calls per window. */
  max: number;
  windowMs: number;
}): void {
  const key = `agent-tool:${opts.agentId}:${opts.toolName}`;
  const now = Date.now();

  const cached = memCache.get(key);
  if (cached && now < cached.resetAt) {
    if (cached.count >= opts.max) {
      throw new AgentToolRateLimitError(
        `Rate limit: ${opts.toolName} allows ${opts.max} calls per ${Math.round(opts.windowMs / 60000)}m for this agent. Try again later.`,
        cached.resetAt - now
      );
    }
    cached.count += 1;
    persistBucket(key, cached.count, cached.resetAt);
    return;
  }

  let count = 1;
  let resetAt = now + opts.windowMs;
  try {
    const core = getCloudDb();
    const row = core
      .prepare(`SELECT count, reset_at FROM rate_limit_buckets WHERE bucket_key=?`)
      .get(key) as { count: number; reset_at: number } | undefined;
    if (row && now < row.reset_at) {
      count = row.count + 1;
      resetAt = row.reset_at;
    }
    if (count > opts.max) {
      memCache.set(key, { count: row?.count ?? opts.max, resetAt });
      throw new AgentToolRateLimitError(
        `Rate limit: ${opts.toolName} allows ${opts.max} calls per ${Math.round(opts.windowMs / 60000)}m for this agent. Try again later.`,
        resetAt - now
      );
    }
    persistBucket(key, count, resetAt);
  } catch (err) {
    if (err instanceof AgentToolRateLimitError) throw err;
    // Schema missing in early tests — memory only.
    const bucket = memCache.get(key);
    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= opts.max) {
        throw new AgentToolRateLimitError(
          `Rate limit: ${opts.toolName} allows ${opts.max} calls per ${Math.round(opts.windowMs / 60000)}m for this agent. Try again later.`,
          bucket.resetAt - now
        );
      }
      bucket.count += 1;
      return;
    }
    memCache.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }
  memCache.set(key, { count, resetAt });
}

function persistBucket(key: string, count: number, resetAt: number): void {
  try {
    getCloudDb()
      .prepare(
        `INSERT INTO rate_limit_buckets (bucket_key, count, reset_at)
         VALUES (?, ?, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET count=excluded.count, reset_at=excluded.reset_at`
      )
      .run(key, count, resetAt);
  } catch {
    /* optional durable store */
  }
  memCache.set(key, { count, resetAt });
}

/** Test helper: clear memory and durable buckets for agent-tool keys. */
export function _resetAgentToolRateLimitForTests(): void {
  memCache.clear();
  try {
    getCloudDb()
      .prepare(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'agent-tool:%'`)
      .run();
  } catch {
    /* optional durable store / missing table in unit harness */
  }
}
