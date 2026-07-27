/**
 * Spend hard-stop gate (#96 Slice 3). Thin wire from #91: ops kill only.
 */
import { getTenantDb } from "../../tenant-registry.js";
import { logToolAudit } from "../coding/tool-audit.js";
import {
  isEnvSpendKillActive,
  isGlobalSpendKillActive,
  isTenantSpendKillActive,
} from "./spend-kill-switch.js";

export class SpendAuthorityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "SpendAuthorityError";
    this.code = code;
    this.status = status;
  }
}

export function isSpendAuthorityError(
  err: unknown
): err is SpendAuthorityError {
  return err instanceof SpendAuthorityError;
}

export type SpendAssertOpts = {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  /** Audit action label when reject is recorded. */
  action?: string;
};

/** Best-effort tenant tool_audit_log row for spend rejects. */
export function logSpendReject(opts: {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  action?: string;
  code: string;
}): void {
  const tid = String(opts.tenantId ?? "").trim();
  if (!tid) return;
  try {
    const db = getTenantDb(tid);
    logToolAudit(db, {
      agentId: String(opts.agentId ?? "system").trim() || "system",
      userId: opts.userId ?? null,
      action: opts.action ?? "spend_gate",
      result: opts.code,
    });
  } catch {
    /* no tenant DB or audit table: skip */
  }
}

function deny(code: string, message: string, opts?: SpendAssertOpts): never {
  logSpendReject({
    tenantId: opts?.tenantId,
    userId: opts?.userId,
    agentId: opts?.agentId,
    action: opts?.action,
    code,
  });
  throw new SpendAuthorityError(code, message);
}

/**
 * Fail closed when spend is killed globally (env or meta) or for the tenant.
 * tenantId optional: credit paths without tenant still honor global/env.
 */
export function assertSpendAllowed(opts?: SpendAssertOpts): void {
  if (isEnvSpendKillActive()) {
    deny(
      "kill:env_spend",
      "Spend is disabled platform-wide (PLATFORM_SPEND_DISABLED).",
      opts
    );
  }
  if (isGlobalSpendKillActive()) {
    deny(
      "kill:global_spend",
      "Spend is temporarily disabled platform-wide (ops kill switch).",
      opts
    );
  }
  const tid = String(opts?.tenantId ?? "").trim();
  if (tid && isTenantSpendKillActive(tid)) {
    deny(
      "kill:tenant_spend",
      "Spend is temporarily disabled for this workspace (ops kill switch).",
      opts
    );
  }
}
