import { requiresConfirmation } from "./ai-tool-executor.js";
import { isCodingTool, isCodingWriteTool } from "./ai-tools-registry.js";
import {
  agentCodeAutonomyLevel,
  type CodeAutonomyLevel,
} from "./agents/agents-db.js";
import type { AiAgent } from "./agents/types.js";

const NEVER_AUTO_APPROVE = new Set([
  "flatten_all",
  "flatten_playbook",
  "deploy_playbook",
]);

export interface ConfirmPayload {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}

function effectiveAutonomy(
  agent: AiAgent,
  sessionAutonomy?: CodeAutonomyLevel | null
): CodeAutonomyLevel {
  const agentLevel = agentCodeAutonomyLevel(agent);
  if (sessionAutonomy === "full") return "full";
  if (sessionAutonomy === "writes") {
    return agentLevel === "full" ? "full" : "writes";
  }
  if (sessionAutonomy === "off" || !sessionAutonomy) return agentLevel;
  return sessionAutonomy;
}

function autoApprovedByAutonomy(
  level: CodeAutonomyLevel,
  toolName: string
): boolean {
  if (NEVER_AUTO_APPROVE.has(toolName)) return false;
  if (level === "full") return true;
  if (level === "writes" && isCodingWriteTool(toolName)) return true;
  return false;
}

/**
 * Decide whether a tool may run without surfacing a confirm dialog.
 */
export async function shouldAutoApproveTool(
  agent: AiAgent,
  toolName: string,
  onConfirmRequired?: (payload: ConfirmPayload) => Promise<boolean>,
  payload?: ConfirmPayload,
  sessionAutonomy?: CodeAutonomyLevel | null
): Promise<boolean> {
  const level = effectiveAutonomy(agent, sessionAutonomy);
  if (autoApprovedByAutonomy(level, toolName)) return true;

  const autoApprove = new Set(agent.autoApprove);
  if (autoApprove.has(toolName) || autoApprove.has("*")) return true;

  if (requiresConfirmation(toolName)) {
    return payload ? ((await onConfirmRequired?.(payload)) ?? false) : false;
  }
  return true;
}

export { NEVER_AUTO_APPROVE };
