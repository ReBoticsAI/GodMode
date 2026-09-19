/**
 * GodMode Inference grants: free trial, $1 packs, and subscription allowances.
 * Admin platform supply may only be spent when an active grant has budget left
 * and the caller is Intelligence managed chat.
 */

import { randomUUID } from "node:crypto";
import type { CoreDatabase } from "../core-db.js";
import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../core-db.js";
import { ensureTrialInferenceTables } from "./trial-inference-schema.js";
import {
  isGodModeInferenceSupplySecretId,
  resolveGodModeInferenceSupplyBySecretId,
} from "./godmode-inference-supply.js";

/** Keep in sync with trial-inference TRIAL_DEFAULT_BUDGET_USD. */
const TRIAL_DEFAULT_BUDGET_USD = 0.1;

export type GodModeInferenceGrantKind = "trial" | "pack" | "subscription";

export type GodModeInferenceGrantRow = {
  id: string;
  subject_key: string;
  user_id: string | null;
  visitor_key: string | null;
  provider: string;
  mechanism: string;
  status: string;
  kind: GodModeInferenceGrantKind;
  model_id: string;
  prompt_count: number;
  spent_usd: number;
  budget_usd: number | null;
  expires_at: string | null;
  stripe_session_id: string | null;
  stripe_subscription_id: string | null;
};

const INTELLIGENCE_AGENT_ID = "intelligence";

/** Default USD added by a $1 pack (override with GODMODE_INFERENCE_PACK_BUDGET_USD). */
export const DEFAULT_PACK_BUDGET_USD = 1;

/** Heuristic USD per managed turn when providers do not return cost. */
export const DEFAULT_TURN_COST_USD = 0.002;

function readEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

export function packBudgetUsd(): number {
  const raw = Number(readEnv("GODMODE_INFERENCE_PACK_BUDGET_USD"));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PACK_BUDGET_USD;
}

export function turnCostUsd(): number {
  const raw = Number(readEnv("GODMODE_INFERENCE_TURN_COST_USD"));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TURN_COST_USD;
}

function ensureSchema(db: CoreDatabase = getCloudDb()): void {
  ensureTrialInferenceTables(db);
}

function mapRow(row: Record<string, unknown>): GodModeInferenceGrantRow {
  const kindRaw = String(row.kind ?? "trial");
  const kind: GodModeInferenceGrantKind =
    kindRaw === "pack" || kindRaw === "subscription" ? kindRaw : "trial";
  return {
    id: String(row.id),
    subject_key: String(row.subject_key),
    user_id: (row.user_id as string | null) ?? null,
    visitor_key: (row.visitor_key as string | null) ?? null,
    provider: String(row.provider ?? ""),
    mechanism: String(row.mechanism ?? ""),
    status: String(row.status ?? ""),
    kind,
    model_id: String(row.model_id ?? ""),
    prompt_count: Number(row.prompt_count ?? 0),
    spent_usd: Number(row.spent_usd ?? 0),
    budget_usd:
      row.budget_usd == null || row.budget_usd === ""
        ? null
        : Number(row.budget_usd),
    expires_at: (row.expires_at as string | null) ?? null,
    stripe_session_id: (row.stripe_session_id as string | null) ?? null,
    stripe_subscription_id:
      (row.stripe_subscription_id as string | null) ?? null,
  };
}

export function remainingBudgetUsd(grant: GodModeInferenceGrantRow): number {
  if (grant.budget_usd == null) return Infinity;
  return Math.max(0, grant.budget_usd - grant.spent_usd);
}

export function isGrantSpendable(grant: GodModeInferenceGrantRow | null): boolean {
  if (!grant || grant.status !== "active") return false;
  if (grant.expires_at) {
    const exp = Date.parse(grant.expires_at);
    if (Number.isFinite(exp) && exp < Date.now()) return false;
  }
  return remainingBudgetUsd(grant) > 0;
}

/**
 * Find the best active grant for a user (or visitor subject).
 * Prefer paid kinds with remaining budget, then trial.
 */
export function findActiveGodModeInferenceGrant(opts: {
  userId?: string | null;
  visitorKey?: string | null;
  subjectKey?: string | null;
  db?: CoreDatabase;
}): GodModeInferenceGrantRow | null {
  const db = opts.db ?? getCloudDb();
  ensureSchema(db);

  const candidates: GodModeInferenceGrantRow[] = [];
  if (opts.userId) {
    const rows = db
      .prepare(
        `SELECT * FROM trial_inference_grants
         WHERE user_id=? AND status='active'
         ORDER BY updated_at DESC`
      )
      .all(opts.userId) as Array<Record<string, unknown>>;
    candidates.push(...rows.map(mapRow));
  }
  if (opts.subjectKey) {
    const row = db
      .prepare(
        `SELECT * FROM trial_inference_grants WHERE subject_key=? AND status='active'`
      )
      .get(opts.subjectKey) as Record<string, unknown> | undefined;
    if (row) candidates.push(mapRow(row));
  }
  if (opts.visitorKey) {
    const rows = db
      .prepare(
        `SELECT * FROM trial_inference_grants
         WHERE visitor_key=? AND status='active'
         ORDER BY updated_at DESC`
      )
      .all(opts.visitorKey) as Array<Record<string, unknown>>;
    candidates.push(...rows.map(mapRow));
  }

  const spendable = candidates.filter(isGrantSpendable);
  if (!spendable.length) return null;
  spendable.sort((a, b) => {
    const rank = (k: GodModeInferenceGrantKind) =>
      k === "subscription" ? 0 : k === "pack" ? 1 : 2;
    return rank(a.kind) - rank(b.kind);
  });
  return spendable[0] ?? null;
}

export function recordGodModeInferenceSpend(opts: {
  grantId: string;
  usd?: number;
  db?: CoreDatabase;
}): GodModeInferenceGrantRow | null {
  const db = opts.db ?? getCloudDb();
  ensureSchema(db);
  const cost = opts.usd ?? turnCostUsd();
  db.prepare(
    `UPDATE trial_inference_grants
     SET spent_usd = spent_usd + ?,
         prompt_count = prompt_count + 1,
         updated_at = datetime('now'),
         status = CASE
           WHEN budget_usd IS NOT NULL AND (spent_usd + ?) >= budget_usd
             THEN 'expired'
           ELSE status
         END
     WHERE id=? AND status='active'`
  ).run(cost, cost, opts.grantId);
  const row = db
    .prepare(`SELECT * FROM trial_inference_grants WHERE id=?`)
    .get(opts.grantId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function markGodModeInferenceGrantConverted(opts: {
  userId?: string | null;
  subjectKey?: string | null;
  db?: CoreDatabase;
}): void {
  const db = opts.db ?? getCloudDb();
  ensureSchema(db);
  if (opts.userId) {
    db.prepare(
      `UPDATE trial_inference_grants
       SET status='converted', updated_at=datetime('now')
       WHERE user_id=? AND status='active' AND mechanism='godmodeInferenceSupply'`
    ).run(opts.userId);
  }
  if (opts.subjectKey) {
    db.prepare(
      `UPDATE trial_inference_grants
       SET status='converted', updated_at=datetime('now')
       WHERE subject_key=? AND status='active' AND mechanism='godmodeInferenceSupply'`
    ).run(opts.subjectKey);
  }
}

export function topUpGodModeInferenceGrant(opts: {
  userId: string;
  kind: "pack" | "subscription";
  budgetUsd: number;
  modelId?: string;
  stripeSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  expiresAt?: string | null;
  db?: CoreDatabase;
}): GodModeInferenceGrantRow {
  const db = opts.db ?? getCloudDb();
  ensureSchema(db);
  const subjectKey = `user:${opts.userId}:godmode-inference`;
  const existing = db
    .prepare(
      `SELECT * FROM trial_inference_grants WHERE subject_key=?`
    )
    .get(subjectKey) as Record<string, unknown> | undefined;

  if (existing) {
    const prev = mapRow(existing);
    const remaining = remainingBudgetUsd(prev);
    const nextBudget =
      (Number.isFinite(remaining) ? remaining : 0) + opts.budgetUsd;
    db.prepare(
      `UPDATE trial_inference_grants
       SET status='active',
           kind=?,
           mechanism='godmodeInferenceSupply',
           spent_usd=0,
           budget_usd=?,
           expires_at=?,
           stripe_session_id=COALESCE(?, stripe_session_id),
           stripe_subscription_id=COALESCE(?, stripe_subscription_id),
           user_id=?,
           updated_at=datetime('now')
       WHERE id=?`
    ).run(
      opts.kind,
      nextBudget,
      opts.expiresAt ?? null,
      opts.stripeSessionId ?? null,
      opts.stripeSubscriptionId ?? null,
      opts.userId,
      prev.id
    );
    const row = db
      .prepare(`SELECT * FROM trial_inference_grants WHERE id=?`)
      .get(prev.id) as Record<string, unknown>;
    return mapRow(row);
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO trial_inference_grants (
       id, subject_key, user_id, visitor_key, provider, mechanism, status,
       kind, model_id, prompt_count, spent_usd, budget_usd, expires_at,
       stripe_session_id, stripe_subscription_id
     ) VALUES (?, ?, ?, NULL, 'godmode', 'godmodeInferenceSupply', 'active',
       ?, ?, 0, 0, ?, ?, ?, ?)`
  ).run(
    id,
    subjectKey,
    opts.userId,
    opts.kind,
    opts.modelId ?? "godmode-inference",
    opts.budgetUsd,
    opts.expiresAt ?? null,
    opts.stripeSessionId ?? null,
    opts.stripeSubscriptionId ?? null
  );
  const row = db
    .prepare(`SELECT * FROM trial_inference_grants WHERE id=?`)
    .get(id) as Record<string, unknown>;
  return mapRow(row);
}

export function listGodModeInferenceGrantStats(db: CoreDatabase = getCloudDb()): {
  activeGrants: number;
  totalSpentUsd: number;
  totalBudgetUsd: number;
} {
  ensureSchema(db);
  const active = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM trial_inference_grants WHERE status='active'`
      )
      .get() as { c: number }
  ).c;
  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(spent_usd),0) AS s, COALESCE(SUM(budget_usd),0) AS b
       FROM trial_inference_grants`
    )
    .get() as { s: number; b: number };
  return {
    activeGrants: active,
    totalSpentUsd: Number(sums.s) || 0,
    totalBudgetUsd: Number(sums.b) || 0,
  };
}

const META_DEFAULT_TRIAL_BUDGET = "godmode_inference.default_trial_budget_usd";

/** Admin-configured default trial budget, else env, else $0.10. */
export function defaultTrialBudgetUsd(db: CoreDatabase = getCloudDb()): number {
  try {
    const rawMeta = getPlatformMeta(db, META_DEFAULT_TRIAL_BUDGET);
    if (rawMeta) {
      const n = Number(rawMeta);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* Cloud DB unavailable in some unit tests */
  }
  const raw = Number(readEnv("TRIAL_INFERENCE_BUDGET_USD"));
  return Number.isFinite(raw) && raw > 0 ? raw : TRIAL_DEFAULT_BUDGET_USD;
}

export function setDefaultTrialBudgetUsd(
  usd: number,
  db: CoreDatabase = getCloudDb()
): number {
  const next = Math.max(0.01, Number(usd));
  if (!Number.isFinite(next)) {
    throw Object.assign(new Error("Invalid trial budget"), { status: 400 });
  }
  setPlatformMeta(db, META_DEFAULT_TRIAL_BUDGET, String(next));
  return next;
}

export type AdminGodModeInferenceGrant = GodModeInferenceGrantRow & {
  remaining_usd: number | null;
  updated_at: string | null;
};

export function listAdminGodModeInferenceGrants(opts?: {
  limit?: number;
  status?: string | null;
  db?: CoreDatabase;
}): AdminGodModeInferenceGrant[] {
  const db = opts?.db ?? getCloudDb();
  ensureSchema(db);
  const limit = Math.min(200, Math.max(1, Number(opts?.limit) || 50));
  const status = opts?.status?.trim() || null;
  const rows = (
    status
      ? (db
          .prepare(
            `SELECT * FROM trial_inference_grants
             WHERE status=?
             ORDER BY updated_at DESC
             LIMIT ?`
          )
          .all(status, limit) as Array<Record<string, unknown>>)
      : (db
          .prepare(
            `SELECT * FROM trial_inference_grants
             ORDER BY updated_at DESC
             LIMIT ?`
          )
          .all(limit) as Array<Record<string, unknown>>)
  );
  return rows.map((row) => {
    const g = mapRow(row);
    const rem = remainingBudgetUsd(g);
    return {
      ...g,
      remaining_usd: Number.isFinite(rem) ? rem : null,
      updated_at: (row.updated_at as string | null) ?? null,
    };
  });
}

export function getGodModeInferenceGrantById(
  id: string,
  db: CoreDatabase = getCloudDb()
): GodModeInferenceGrantRow | null {
  ensureSchema(db);
  const row = db
    .prepare(`SELECT * FROM trial_inference_grants WHERE id=?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function revokeGodModeInferenceGrant(
  id: string,
  db: CoreDatabase = getCloudDb()
): GodModeInferenceGrantRow | null {
  ensureSchema(db);
  const existing = getGodModeInferenceGrantById(id, db);
  if (!existing) return null;
  db.prepare(
    `UPDATE trial_inference_grants
     SET status='revoked', updated_at=datetime('now')
     WHERE id=?`
  ).run(id);
  return getGodModeInferenceGrantById(id, db);
}

export function patchGodModeInferenceGrantBudget(
  id: string,
  budgetUsd: number,
  db: CoreDatabase = getCloudDb()
): GodModeInferenceGrantRow | null {
  ensureSchema(db);
  const existing = getGodModeInferenceGrantById(id, db);
  if (!existing) return null;
  const next = Math.max(0, Number(budgetUsd));
  if (!Number.isFinite(next)) {
    throw Object.assign(new Error("Invalid budget"), { status: 400 });
  }
  const status =
    existing.status === "revoked" || existing.status === "converted"
      ? existing.status
      : next > existing.spent_usd
        ? "active"
        : "expired";
  db.prepare(
    `UPDATE trial_inference_grants
     SET budget_usd=?, status=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(next, status, id);
  return getGodModeInferenceGrantById(id, db);
}

export type ManagedSupplyResolveCtx = {
  agentId: string;
  userId?: string | null;
  visitorKey?: string | null;
  subjectKey?: string | null;
  /** When true, skip grant check (Admin attach / ensureTrial only). */
  provisionAttach?: boolean;
  db?: CoreDatabase;
};

/**
 * Resolve Admin / env GodMode Inference supply for managed Intelligence chat.
 * Returns null for any other agent or when no spendable grant exists
 * (unless provisionAttach for trial ensure).
 */
export function resolveGodModeInferenceSupplyForManagedChat(
  secretId: string,
  ctx: ManagedSupplyResolveCtx
): string | null {
  if (!isGodModeInferenceSupplySecretId(secretId)) return null;
  if (ctx.agentId !== INTELLIGENCE_AGENT_ID) return null;

  if (!ctx.provisionAttach) {
    const grant = findActiveGodModeInferenceGrant({
      userId: ctx.userId,
      visitorKey: ctx.visitorKey,
      subjectKey: ctx.subjectKey,
      db: ctx.db,
    });
    if (!isGrantSpendable(grant)) return null;
  }

  return resolveGodModeInferenceSupplyBySecretId(secretId);
}
