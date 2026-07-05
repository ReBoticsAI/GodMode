import type { AgentMessage } from "../ai-agent.js";
import type { ToolExecContext } from "../ai-tool-executor.js";
import type { AiAgent } from "./types.js";

export interface AgentRunRequest {
  agent: AiAgent;
  messages: AgentMessage[];
  toolCtx: ToolExecContext;
  /**
   * Optional tool schemas advertised to the model. When omitted the backend
   * derives them from `toolCtx.db`. Callers pass this to keep tool definitions
   * sourced from the engine (agent owner) DB while execution writes go to the
   * actor's work DB (`toolCtx.db`).
   */
  toolSchemas?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  delegationDepth?: number;
  onToken?: (chunk: string) => void;
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
    toolCallId?: string
  ) => void;
  onToolResult?: (
    name: string,
    result: unknown,
    toolCallId?: string,
    isError?: boolean
  ) => void;
  onConfirmRequired?: (payload: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
  }) => Promise<boolean>;
  onReasoning?: (chunk: string) => void;
  onToolCallDelta?: (
    toolCallId: string,
    name: string,
    argsPartial: Record<string, unknown>
  ) => void;
  abortSignal?: AbortSignal;
  maxIterations?: number;
  chatMode?: import("../chat-mode.js").IntelligenceChatMode;
  onTerminalOutput?: (
    toolCallId: string,
    chunk: { stream: "stdout" | "stderr"; text: string }
  ) => void;
  onUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }) => void;
}

export interface AgentBackend {
  run(req: AgentRunRequest): Promise<string>;
}
