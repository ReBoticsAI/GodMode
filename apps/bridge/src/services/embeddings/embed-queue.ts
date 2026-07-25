/**
 * Shared SaaS embed job queue (#69 track C).
 * Core-DB table; tenant-fair round-robin dequeue; interactive before backfill.
 */
import { v4 as uuidv4 } from "uuid";
import { config } from "../../config.js";
import { getCoreDb, type CoreDatabase } from "../../core-db.js";
import type { EmbedProfileId } from "./profiles.js";

export type EmbedLane = "interactive" | "backfill";
export type EmbedTargetKind = "memory" | "wiki" | "code_chunk";

export interface EmbedQueueJob {
  id: string;
  tenant_id: string;
  profile: EmbedProfileId;
  lane: EmbedLane;
  priority: number;
  status: string;
  target_kind: EmbedTargetKind;
  target_id: string;
  payload_json: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface EnqueueEmbedInput {
  tenantId?: string | null;
  profile?: EmbedProfileId;
  lane?: EmbedLane;
  targetKind: EmbedTargetKind;
  targetId: string;
  /** Text to embed (snapshot). */
  text: string;
  /** Extra fields stored in payload_json (e.g. modelId for code). */
  extra?: Record<string, unknown>;
}

export interface EmbedQueueMetrics {
  enabled: boolean;
  depth: number;
  byLane: { interactive: number; backfill: number };
  failuresRecent: number;
  fairLastTenant: string | null;
}

/** Round-robin cursor (module state; single Bridge process). */
let fairLastTenant: string | null = null;

export function isEmbedQueueEnabled(): boolean {
  return config.embeddings.queueEnabled;
}

export function getFairLastTenant(): string | null {
  return fairLastTenant;
}

/** Test helper: reset RR cursor. */
export function resetEmbedQueueFairness(): void {
  fairLastTenant = null;
}

function core(): CoreDatabase {
  return getCoreDb();
}

export function enqueueEmbedJob(input: EnqueueEmbedInput): string | null {
  if (!isEmbedQueueEnabled()) return null;
  const text = (input.text ?? "").trim();
  if (!text || !input.targetId) return null;

  const id = uuidv4();
  const tenantId = input.tenantId ?? "";
  const profile = input.profile ?? "memory";
  const lane = input.lane ?? "backfill";
  const priority = lane === "interactive" ? 10 : 0;
  const payload = JSON.stringify({
    text,
    ...(input.extra ?? {}),
  });

  const db = core();
  try {
    db.prepare(
      `DELETE FROM embed_queue
       WHERE target_kind = ? AND target_id = ? AND status = 'pending'`
    ).run(input.targetKind, input.targetId);
    db.prepare(
      `INSERT INTO embed_queue
         (id, tenant_id, profile, lane, priority, status, target_kind, target_id, payload_json)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(
      id,
      tenantId,
      profile,
      lane,
      priority,
      input.targetKind,
      input.targetId,
      payload
    );
    return id;
  } catch (err) {
    console.warn(
      "[embed-queue] enqueue failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Pick next pending job with tenant round-robin and interactive-before-backfill.
 */
export function claimNextEmbedJob(): EmbedQueueJob | null {
  const db = core();
  let tenants: string[];
  try {
    tenants = (
      db
        .prepare(
          `SELECT DISTINCT tenant_id FROM embed_queue WHERE status = 'pending'`
        )
        .all() as Array<{ tenant_id: string }>
    ).map((r) => r.tenant_id);
  } catch {
    return null;
  }
  if (tenants.length === 0) return null;

  tenants.sort((a, b) => a.localeCompare(b));
  let start = 0;
  if (fairLastTenant != null) {
    const idx = tenants.indexOf(fairLastTenant);
    start = idx >= 0 ? (idx + 1) % tenants.length : 0;
  }

  for (let i = 0; i < tenants.length; i++) {
    const tenantId = tenants[(start + i) % tenants.length];
    const job =
      pickPendingForTenant(db, tenantId, "interactive") ??
      pickPendingForTenant(db, tenantId, "backfill");
    if (!job) continue;

    const claimed = db
      .prepare(
        `UPDATE embed_queue
         SET status = 'running', started_at = datetime('now')
         WHERE id = ? AND status = 'pending'`
      )
      .run(job.id);
    if (claimed.changes === 0) continue;

    fairLastTenant = tenantId;
    return {
      ...job,
      status: "running",
      started_at: new Date().toISOString(),
    };
  }
  return null;
}

function pickPendingForTenant(
  db: CoreDatabase,
  tenantId: string,
  lane: EmbedLane
): EmbedQueueJob | undefined {
  return db
    .prepare(
      `SELECT * FROM embed_queue
       WHERE status = 'pending' AND tenant_id = ? AND lane = ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(tenantId, lane) as EmbedQueueJob | undefined;
}

export function completeEmbedJob(id: string): void {
  try {
    core()
      .prepare(
        `UPDATE embed_queue
         SET status = 'done', finished_at = datetime('now'), error = NULL
         WHERE id = ?`
      )
      .run(id);
  } catch {
    /* optional */
  }
}

export function failEmbedJob(id: string, error: string): void {
  try {
    core()
      .prepare(
        `UPDATE embed_queue
         SET status = 'error', error = ?, finished_at = datetime('now')
         WHERE id = ?`
      )
      .run(error.slice(0, 500), id);
  } catch {
    /* optional */
  }
}

export function recoverStaleEmbedJobs(
  staleMinutes: number = config.embeddings.queueStaleMinutes
): number {
  const minutes = Math.max(1, Math.floor(staleMinutes));
  try {
    const result = core()
      .prepare(
        `UPDATE embed_queue
         SET status = 'error',
             error = 'stale running job recovered after worker loss',
             finished_at = datetime('now')
         WHERE status = 'running'
           AND started_at IS NOT NULL
           AND started_at < datetime('now', ?)`
      )
      .run(`-${minutes} minutes`);
    return result.changes;
  } catch {
    return 0;
  }
}

export function getEmbedQueueMetrics(): EmbedQueueMetrics {
  const enabled = isEmbedQueueEnabled();
  const empty: EmbedQueueMetrics = {
    enabled,
    depth: 0,
    byLane: { interactive: 0, backfill: 0 },
    failuresRecent: 0,
    fairLastTenant,
  };
  if (!enabled) return empty;
  try {
    const db = core();
    const depth = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM embed_queue WHERE status = 'pending'`
        )
        .get() as { n: number }
    ).n;
    const interactive = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM embed_queue
           WHERE status = 'pending' AND lane = 'interactive'`
        )
        .get() as { n: number }
    ).n;
    const backfill = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM embed_queue
           WHERE status = 'pending' AND lane = 'backfill'`
        )
        .get() as { n: number }
    ).n;
    const failuresRecent = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM embed_queue
           WHERE status = 'error'
             AND finished_at >= datetime('now', '-1 hour')`
        )
        .get() as { n: number }
    ).n;
    return {
      enabled,
      depth,
      byLane: { interactive, backfill },
      failuresRecent,
      fairLastTenant,
    };
  } catch {
    return empty;
  }
}
