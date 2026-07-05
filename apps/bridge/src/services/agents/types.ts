export type AgentBackendKind =
  | "local"
  | "provider"
  | "cli"
  | "acp"
  | "remote"
  | "cursor"
  | "cursor_cloud";

export interface AgentSamplingConfig {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
  maxTokens: number;
  seed: number;
}

export interface AgentThinkingConfig {
  enableThinking: boolean;
  thinkingEfficiency: "normal" | "low";
  nativeTools: boolean;
}

export interface AgentProviderConfig {
  provider?: "openai" | "anthropic" | "openai_compatible";
  apiKeyRef?: string;
  baseUrl?: string;
  model?: string;
}

export interface AgentCliConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface AgentAcpConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Config for the `cursor` backend, which shells out to the Cursor CLI
 * (`cursor-agent -p`). Unlike `local`/`provider`, this delegates the whole
 * turn to a real Cursor coding agent that can read, write, and run commands.
 */
export interface AgentCursorConfig {
  /** Override the resolved `cursor-agent` command/path. */
  command?: string;
  /** Extra raw args appended after the managed flags. */
  args?: string[];
  /** Model id (default "auto" — the account is metered per-model). */
  model?: string;
  /** Workspace directory cursor-agent runs against (defaults to bridge cwd). */
  workspace?: string;
  /** Run inside an isolated git worktree (name optional). Defaults on for safety. */
  worktree?: boolean | string;
  /** Branch/ref to base a new worktree on. */
  worktreeBase?: string;
  /** Explicit sandbox mode. */
  sandbox?: "enabled" | "disabled";
  /** Allow commands without prompting (headless). Use with care. */
  force?: boolean;
  /** plan = read-only planning, ask = read-only Q&A, omit for full agent mode. */
  mode?: "plan" | "ask";
  /** Hard timeout in ms (default 10 minutes). */
  timeoutMs?: number;
}

/** Cursor subscription via @cursor/sdk — hosted models + GodMode custom tools. */
export interface AgentCursorCloudConfig {
  /** Model id from Cursor.models.list() — e.g. auto, composer-2.5 */
  model?: string;
  workspace?: string;
}

export interface AiAgentRecord {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  backend: AgentBackendKind;
  enabled: number;
  is_template: number;
  system_prompt: string;
  sampling_json: string;
  thinking_json: string;
  tool_allow_json: string;
  auto_approve_json: string;
  model_path: string | null;
  adapter_ids_json: string | null;
  config_json: string;
  parent_id: string | null;
  team: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiAgent {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  backend: AgentBackendKind;
  enabled: boolean;
  isTemplate: boolean;
  systemPrompt: string;
  sampling: AgentSamplingConfig;
  thinking: AgentThinkingConfig;
  toolAllow: string[] | null;
  autoApprove: string[];
  modelPath: string | null;
  adapterIds: string[];
  config: AgentProviderConfig &
    AgentCliConfig &
    AgentAcpConfig &
    AgentCursorConfig &
    AgentCursorCloudConfig &
    Record<string, unknown>;
  parentId: string | null;
  team: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SAMPLING: AgentSamplingConfig = {
  temperature: 1.0,
  topP: 0.95,
  topK: 64,
  minP: 0.05,
  repeatPenalty: 1.1,
  presencePenalty: 0,
  frequencyPenalty: 0,
  maxTokens: 2048,
  seed: -1,
};

export const DEFAULT_THINKING: AgentThinkingConfig = {
  enableThinking: false,
  thinkingEfficiency: "normal",
  nativeTools: true,
};
