/**
 * Agent execution pause gate (#96 Slice 8): ops instant revoke without mutating enabled.
 */
import { getTenantDb } from "../../tenant-registry.js";
import { logToolAudit } from "../coding/tool-audit.js";
import {
  isEnvAgentPauseActive,
  isGlobalAgentPauseActive,
  isPerAgentPauseActive,
  isTenantAgentPauseActive,
} from "./agent-pause-switch.js";

export class AgentPauseAuthorityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "AgentPauseAuthorityError";
    this.code = code;
    this.status = status;
  }
}

export function isAgentPauseAuthorityError(
  err: unknown
): err is AgentPauseAuthorityError {
  return err instanceof AgentPauseAuthorityError;
}

export type AgentPauseAssertOpts = {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  /** Audit action label when reject is recorded. */
  action?: string;
};

/** Best-effort tenant tool_audit_log row for agent pause rejects. */
export function logAgentPauseReject(opts: {
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
      action: opts.action ?? "agent_pause_gate",
      result: opts.code,
    });
  } catch {
    /* no tenant DB or audit table: skip */
  }
}

function deny(code: string, message: string, opts?: AgentPauseAssertOpts): never {
  logAgentPauseReject({
    tenantId: opts?.tenantId,
    userId: opts?.userId,
    agentId: opts?.agentId,
    action: opts?.action,
    code,
  });
  throw new AgentPauseAuthorityError(code, message);
}

/**
 * Fail closed when agent execution is paused globally, for the tenant, or for the agent.
 */
export function assertAgentExecutionAllowed(opts?: AgentPauseAssertOpts): void {
  if (isEnvAgentPauseActive()) {
    deny(
      "kill:env_agents",
      "Agent execution is disabled platform-wide (PLATFORM_AGENTS_DISABLED).",
      opts
    );
  }
  if (isGlobalAgentPauseActive()) {
    deny(
      "kill:global_agents",
      "Agent execution is temporarily paused platform-wide (ops kill switch).",
      opts
    );
  }
  const tid = String(opts?.tenantId ?? "").trim();
  if (tid && isTenantAgentPauseActive(tid)) {
    deny(
      "kill:tenant_agents",
      "Agent execution is temporarily paused for this workspace (ops kill switch).",
      opts
    );
  }
  const aid = String(opts?.agentId ?? "").trim();
  if (tid && aid && isPerAgentPauseActive(tid, aid)) {
    deny(
      "kill:agent_paused",
      "This agent is temporarily paused (ops kill switch).",
      opts
    );
  }
}
