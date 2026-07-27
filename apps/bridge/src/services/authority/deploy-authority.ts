/**
 * Deploy hard-stop gate (#96 Slice 4): plugin build/activate and worktree promote.
 */
import { getTenantDb } from "../../tenant-registry.js";
import { logToolAudit } from "../coding/tool-audit.js";
import {
  isEnvDeployKillActive,
  isGlobalDeployKillActive,
  isTenantDeployKillActive,
} from "./deploy-kill-switch.js";

export class DeployAuthorityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "DeployAuthorityError";
    this.code = code;
    this.status = status;
  }
}

export function isDeployAuthorityError(
  err: unknown
): err is DeployAuthorityError {
  return err instanceof DeployAuthorityError;
}

export type DeployAssertOpts = {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  /** Audit action label when reject is recorded. */
  action?: string;
};

/** Best-effort tenant tool_audit_log row for deploy rejects. */
export function logDeployReject(opts: {
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
      action: opts.action ?? "deploy_gate",
      result: opts.code,
    });
  } catch {
    /* no tenant DB or audit table: skip */
  }
}

function deny(code: string, message: string, opts?: DeployAssertOpts): never {
  logDeployReject({
    tenantId: opts?.tenantId,
    userId: opts?.userId,
    agentId: opts?.agentId,
    action: opts?.action,
    code,
  });
  throw new DeployAuthorityError(code, message);
}

/**
 * Fail closed when deploy is killed globally (env or meta) or for the tenant.
 * tenantId optional: paths without tenant still honor global/env.
 */
export function assertDeployAllowed(opts?: DeployAssertOpts): void {
  if (isEnvDeployKillActive()) {
    deny(
      "kill:env_deploy",
      "Deploy is disabled platform-wide (PLATFORM_DEPLOY_DISABLED).",
      opts
    );
  }
  if (isGlobalDeployKillActive()) {
    deny(
      "kill:global_deploy",
      "Deploy is temporarily disabled platform-wide (ops kill switch).",
      opts
    );
  }
  const tid = String(opts?.tenantId ?? "").trim();
  if (tid && isTenantDeployKillActive(tid)) {
    deny(
      "kill:tenant_deploy",
      "Deploy is temporarily disabled for this workspace (ops kill switch).",
      opts
    );
  }
}
