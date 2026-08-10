import type { AppDatabase } from "../../db.js";
import type { LlmManager } from "../llm-manager.js";
import { getAgent } from "./agents-db.js";
import type { AiAgent } from "./types.js";
import type { AgentBackend } from "./backend.js";
import { LocalLlamaBackend } from "./local-backend.js";
import { ProviderBackend } from "./provider-backend.js";
import { CliBackend } from "./cli-backend.js";
import { AcpBackend } from "./acp-backend.js";
import { CursorBackend } from "./cursor-backend.js";
import { CursorCloudBackend } from "./cursor-cloud-backend.js";
import { RemoteInferenceBackend } from "./remote-backend.js";
import { getCloudDb } from "../../core-db.js";
import {
  assertAgentExecutionAllowed,
} from "../authority/agent-pause-authority.js";

export const MAX_DELEGATION_DEPTH = 3;

export type AgentPauseScope = {
  tenantId?: string | null;
  userId?: string | null;
  action?: string;
};

export function resolveAgent(
  db: AppDatabase,
  id?: string | null,
  pauseScope?: AgentPauseScope
): AiAgent {
  const agentId = id?.trim() || "intelligence";
  const agent = getAgent(db, agentId);
  let resolved: AiAgent;
  if (!agent) {
    const fallback = getAgent(db, "intelligence");
    if (!fallback) throw new Error("Default Intelligence agent not seeded");
    resolved = fallback;
  } else {
    resolved = agent;
  }

  assertAgentExecutionAllowed({
    tenantId: pauseScope?.tenantId,
    userId: pauseScope?.userId,
    agentId: resolved.id,
    action: pauseScope?.action ?? "resolve_agent",
  });

  if (!resolved.enabled) throw new Error(`Agent "${resolved.name}" is disabled`);
  return resolved;
}

export function getBackend(
  agent: AiAgent,
  db: AppDatabase,
  llm: LlmManager
): AgentBackend {
  switch (agent.backend) {
    case "local":
      return new LocalLlamaBackend(llm, db);
    case "provider":
      return new ProviderBackend(db);
    case "cli":
      return new CliBackend();
    case "acp":
      return new AcpBackend();
    case "cursor":
      return new CursorBackend();
    case "cursor_cloud":
      return new CursorCloudBackend(db);
    case "remote":
      return new RemoteInferenceBackend(getCloudDb(), llm);
    default:
      return new LocalLlamaBackend(llm, db);
  }
}
