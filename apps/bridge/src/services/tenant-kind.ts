import type { AppDatabase } from "../db.js";
import { getCoreDb, type CoreDatabase } from "../core-db.js";

export type TenantKind = "operator" | "personal";

const TENANT_KIND_KEY = "tenantKind";

/** Core DB: is this tenant the platform operator workspace? */
export function isOperatorTenantId(
  core: CoreDatabase,
  tenantId: string
): boolean {
  const row = core
    .prepare(`SELECT is_operator FROM tenants WHERE id=?`)
    .get(tenantId) as { is_operator: number } | undefined;
  return Boolean(row?.is_operator);
}

export function tenantKindFromCore(
  core: CoreDatabase,
  tenantId: string
): TenantKind {
  return isOperatorTenantId(core, tenantId) ? "operator" : "personal";
}

export function readTenantKind(db: AppDatabase): TenantKind | null {
  const row = db
    .prepare(`SELECT value FROM ai_settings WHERE key=?`)
    .get(TENANT_KIND_KEY) as { value: string } | undefined;
  if (row?.value === "operator" || row?.value === "personal") return row.value;
  return null;
}

export function writeTenantKind(db: AppDatabase, kind: TenantKind): void {
  db.prepare(
    `INSERT INTO ai_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(TENANT_KIND_KEY, kind);
}

/** Idempotent: persist tenant kind in tenant SQLite from core registry. */
export function ensureTenantKindMeta(tenantId: string, db: AppDatabase): TenantKind {
  const existing = readTenantKind(db);
  if (existing) return existing;
  const kind = tenantKindFromCore(getCoreDb(), tenantId);
  writeTenantKind(db, kind);
  return kind;
}

export function isOperatorTenantDb(db: AppDatabase): boolean {
  return readTenantKind(db) === "operator";
}

export function isPersonalTenantDb(db: AppDatabase): boolean {
  const kind = readTenantKind(db);
  if (kind) return kind === "personal";
  // Legacy fallback before meta backfill
  const row = db.prepare(`SELECT COUNT(*) AS c FROM departments`).get() as { c: number };
  return row.c === 0;
}
