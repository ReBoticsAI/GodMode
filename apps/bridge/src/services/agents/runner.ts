import type { AppDatabase } from "../../db.js";
import type { LlmManager } from "../llm-manager.js";
import type { AgentMessage } from "../ai-agent.js";
import type { ToolExecContext } from "../ai-tool-executor.js";
import type { AgentRunRequest } from "./backend.js";
import { getBackend, resolveAgent, MAX_DELEGATION_DEPTH } from "./registry.js";

export interface RunSubagentOptions {
  db: AppDatabase;
  llm: LlmManager;
  agentId: string;
  prompt: string;
  systemExtra?: string;
  toolCtx: ToolExecContext;
  delegationDepth?: number;
  onToken?: (chunk: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onConfirmRequired?: AgentRunRequest["onConfirmRequired"];
  maxIterations?: number;
}

export async function runSubagent(opts: RunSubagentOptions): Promise<string> {
  const depth = opts.delegationDepth ?? 0;
  if (depth >= MAX_DELEGATION_DEPTH) {
    throw new Error(`Subagent delegation depth limit (${MAX_DELEGATION_DEPTH}) exceeded`);
  }

  const agent = resolveAgent(opts.db, opts.agentId);
  const backend = getBackend(agent, opts.db, opts.llm);

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: opts.systemExtra
        ? `${agent.systemPrompt}\n\n${opts.systemExtra}`
        : agent.systemPrompt,
    },
    { role: "user", content: opts.prompt },
  ];

  return backend.run({
    agent,
    messages,
    toolCtx: { ...opts.toolCtx, activeAgentId: agent.id, delegationDepth: depth + 1 },
    delegationDepth: depth + 1,
    onToken: opts.onToken,
    onToolCall: opts.onToolCall,
    onToolResult: opts.onToolResult,
    onConfirmRequired: opts.onConfirmRequired,
    maxIterations: opts.maxIterations,
  });
}
