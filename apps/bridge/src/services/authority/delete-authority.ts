/**
 * Delete hard-stop gate (#96 Slice 5): records, coding FS, wiki, plugin uninstall.
 */
import { getTenantDb } from "../../tenant-registry.js";
import { logToolAudit } from "../coding/tool-audit.js";
import {
  isEnvDeleteKillActive,
  isGlobalDeleteKillActive,
  isTenantDeleteKillActive,
} from "./delete-kill-switch.js";

export class DeleteAuthorityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "DeleteAuthorityError";
    this.code = code;
    this.status = status;
  }
}

export function isDeleteAuthorityError(
  err: unknown
): err is DeleteAuthorityError {
  return err instanceof DeleteAuthorityError;
}

export type DeleteAssertOpts = {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  /** Audit action label when reject is recorded. */
  action?: string;
};

/** Best-effort tenant tool_audit_log row for delete rejects. */
export function logDeleteReject(opts: {
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
      action: opts.action ?? "delete_gate",
      result: opts.code,
    });
  } catch {
    /* no tenant DB or audit table: skip */
  }
}

function deny(code: string, message: string, opts?: DeleteAssertOpts): never {
  logDeleteReject({
    tenantId: opts?.tenantId,
    userId: opts?.userId,
    agentId: opts?.agentId,
    action: opts?.action,
    code,
  });
  throw new DeleteAuthorityError(code, message);
}

/**
 * Fail closed when delete is killed globally (env or meta) or for the tenant.
 * tenantId optional: paths without tenant still honor global/env.
 */
export function assertDeleteAllowed(opts?: DeleteAssertOpts): void {
  if (isEnvDeleteKillActive()) {
    deny(
      "kill:env_delete",
      "Delete is disabled platform-wide (PLATFORM_DELETE_DISABLED).",
      opts
    );
  }
  if (isGlobalDeleteKillActive()) {
    deny(
      "kill:global_delete",
      "Delete is temporarily disabled platform-wide (ops kill switch).",
      opts
    );
  }
  const tid = String(opts?.tenantId ?? "").trim();
  if (tid && isTenantDeleteKillActive(tid)) {
    deny(
      "kill:tenant_delete",
      "Delete is temporarily disabled for this workspace (ops kill switch).",
      opts
    );
  }
}
