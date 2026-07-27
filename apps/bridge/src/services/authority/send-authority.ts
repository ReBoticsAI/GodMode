/**
 * Send hard-stop gate (#96 Slice 6): hook webhook + send_message only.
 */
import { getTenantDb } from "../../tenant-registry.js";
import { logToolAudit } from "../coding/tool-audit.js";
import {
  isEnvSendKillActive,
  isGlobalSendKillActive,
  isTenantSendKillActive,
} from "./send-kill-switch.js";

export class SendAuthorityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "SendAuthorityError";
    this.code = code;
    this.status = status;
  }
}

export function isSendAuthorityError(err: unknown): err is SendAuthorityError {
  return err instanceof SendAuthorityError;
}

export type SendAssertOpts = {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  /** Audit action label when reject is recorded. */
  action?: string;
};

/** Best-effort tenant tool_audit_log row for send rejects. */
export function logSendReject(opts: {
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
      action: opts.action ?? "send_gate",
      result: opts.code,
    });
  } catch {
    /* no tenant DB or audit table: skip */
  }
}

function deny(code: string, message: string, opts?: SendAssertOpts): never {
  logSendReject({
    tenantId: opts?.tenantId,
    userId: opts?.userId,
    agentId: opts?.agentId,
    action: opts?.action,
    code,
  });
  throw new SendAuthorityError(code, message);
}

/**
 * Fail closed when send is killed globally (env or meta) or for the tenant.
 * tenantId optional: paths without tenant still honor global/env.
 */
export function assertSendAllowed(opts?: SendAssertOpts): void {
  if (isEnvSendKillActive()) {
    deny(
      "kill:env_send",
      "Send is disabled platform-wide (PLATFORM_SEND_DISABLED).",
      opts
    );
  }
  if (isGlobalSendKillActive()) {
    deny(
      "kill:global_send",
      "Send is temporarily disabled platform-wide (ops kill switch).",
      opts
    );
  }
  const tid = String(opts?.tenantId ?? "").trim();
  if (tid && isTenantSendKillActive(tid)) {
    deny(
      "kill:tenant_send",
      "Send is temporarily disabled for this workspace (ops kill switch).",
      opts
    );
  }
}
