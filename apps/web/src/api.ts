import {
  clearActiveTenant,
  clearSessionToken,
  readSessionToken,
  readTenantId,
  writeSessionToken,
  writeTenantId,
} from "./lib/storage-keys";
import {
  createRecordApi,
  deleteRecordApi,
  runRecordActionApi,
  updateRecordApi,
  waitForOperationRun,
  type RecordRowClient,
} from "./lib/object-types-api";
import { randomId } from "./lib/random-id";

const API_BASE = "/api";

/** Session token in localStorage/query is dev-only; production relies on HttpOnly cookies. */
const allowSessionTokenFallback =
  import.meta.env.DEV || import.meta.env.VITE_ALLOW_SESSION_TOKEN === "true";

function withSessionQuery(path: string, sessionToken: string | null): string {
  if (!allowSessionTokenFallback || !sessionToken) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}session=${encodeURIComponent(sessionToken)}`;
}

export function getActiveTenantId(): string | null {
  try {
    return readTenantId();
  } catch {
    return null;
  }
}

export function setActiveTenantId(tenantId: string): void {
  writeTenantId(tenantId);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  retryable: boolean;

  constructor(
    status: number,
    message: string,
    opts: { code?: string; details?: unknown; retryable?: boolean } = {}
  ) {
    super(message);
    this.status = status;
    this.code = opts.code;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const tenantId = getActiveTenantId();
  const { headers: callerHeaders, ...rest } = options ?? {};
  const headers = new Headers(callerHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (tenantId && !headers.has("X-Tenant-Id")) {
    headers.set("X-Tenant-Id", tenantId);
  }
  const sessionToken = allowSessionTokenFallback ? readSessionToken() : null;
  if (sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  if (sessionToken && !headers.has("X-Godmode-Session")) {
    headers.set("X-Godmode-Session", sessionToken);
  }
  const apiPath = withSessionQuery(path, sessionToken);
  const res = await fetch(`${API_BASE}${apiPath}`, {
    credentials: "include",
    headers,
    ...rest,
  });
  if (!res.ok) {
    if (res.status === 401) clearSessionToken();
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const structured = error as {
        code?: string;
        message?: string;
        details?: unknown;
        retryable?: boolean;
      };
      throw new ApiError(res.status, structured.message ?? res.statusText, {
        code: structured.code,
        details: structured.details,
        retryable: structured.retryable,
      });
    }
    throw new ApiError(
      res.status,
      typeof error === "string" ? error : res.statusText
    );
  }
  return (await res.json()) as T;
}

function rowDto<T>(row: RecordRowClient): T {
  return { id: row.id, ...row.data } as T;
}

async function createDto<T>(
  objectType: string,
  data: Record<string, unknown>,
  opts?: { agentId?: string }
): Promise<T> {
  return rowDto<T>(await createRecordApi(objectType, data, opts));
}

async function updateDto<T>(
  objectType: string,
  id: string,
  data: Record<string, unknown>,
  opts?: { agentId?: string }
): Promise<T> {
  return rowDto<T>(await updateRecordApi(objectType, id, data, undefined, opts));
}

async function deleteDto(
  objectType: string,
  id: string,
  opts?: { agentId?: string }
): Promise<{ ok: boolean }> {
  await deleteRecordApi(objectType, id, undefined, opts);
  return { ok: true };
}

async function actionDto<T>(
  objectType: string,
  action: string,
  input: Record<string, unknown>,
  id?: string,
  confirmed = false,
  opts?: { agentId?: string }
): Promise<T> {
  const result = await runRecordActionApi(objectType, action, input, {
    id,
    confirmed,
    idempotencyKey: randomId(),
    agentId: opts?.agentId,
  });
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    result.status === "accepted" &&
    "operationRunId" in result &&
    typeof result.operationRunId === "string"
  ) {
    const run = await waitForOperationRun(result.operationRunId);
    if (run.status === "failed") {
      throw new ApiError(500, run.errorMessage ?? "Kernel action failed", {
        code: run.errorCode,
      });
    }
    return run.result as T;
  }
  return result as T;
}

export interface SessionStatus {
  bridge: boolean;
  dtc: boolean;
  chartHost: boolean;
  chartHostProcess?: boolean;
  platformControl?: boolean;
  fileTail?: boolean;
  queueDepth?: number;
  lastPing?: { value: string };
  masterChartSymbol?: string | null;
}

export interface JournalEntry {
  id: string;
  playbook_id?: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  pnl?: number;
  fill_time?: string;
  created_at: string;
}

export interface BacktestRun {
  id: string;
  playbook_id: string;
  sweep_id: string | null;
  spec_json: string;
  params_override_json: string | null;
  chart_number: number | null;
  study_id: number | null;
  status: string;
  step: string | null;
  message: string | null;
  symbol: string | null;
  start_date: string | null;
  end_date: string | null;
  total_trades: number | null;
  win_rate: number | null;
  net_pnl: number | null;
  profit_factor: number | null;
  max_drawdown: number | null;
  expectancy: number | null;
  trade_account: string | null;
  replay_mode: string | null;
  charts_to_replay: string | null;
  replay_speed: number | null;
  days_to_load: number | null;
  processing_step_seconds: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BacktestTrade {
  id: string;
  run_id: string;
  trade_index: number;
  symbol: string | null;
  trade_account: string | null;
  entry_price: number | null;
  exit_price: number | null;
  quantity: number | null;
  side: number | null;
  pnl: number | null;
  max_adverse: number | null;
  max_favorable: number | null;
  entry_ts: string | null;
  exit_ts: string | null;
  internal_order_id: number | null;
}

export type ReplayModeOption = "accurate" | "every_tick";
export type ChartsToReplayOption =
  | "auto"
  | "single"
  | "all_chartbook"
  | "same_link_number";

export interface SweepParamAxis {
  signalId: string;
  paramKey: string;
  values: number[];
}

export interface ScChart {
  chartbook_key?: string;
  chart_number: number;
  name: string;
  symbol: string | null;
  include_in_backtest: number;
  last_seen_at: string;
}

export const fetchScCharts = () =>
  api<{
    charts: ScChart[];
    configured: number[];
    chartbooks?: Array<{ chartbookKey: string; name: string; path: string }>;
    backtestChartbookKey?: string;
  }>("/sc-charts");
export const fetchBacktests = () => api<BacktestRun[]>("/backtests");
export const fetchBacktestDetail = (id: string) =>
  api<{ run: BacktestRun; trades: BacktestTrade[] }>(`/backtests/${id}`);
export const fetchSweepRuns = (sweepId: string) =>
  api<BacktestRun[]>(`/backtests/sweep/${sweepId}`);

export interface StudySettingsReloadStatus {
  reloadRequired: boolean;
}

export interface SetupPhaseRow {
  id: number;
  playbookId: string;
  chartNumber?: number;
  phase: string;
  detail?: string;
  scTs?: string;
  createdAt: string;
}

export interface OrderLifecycleRow {
  id: number;
  playbookId: string;
  chartNumber?: number;
  event: string;
  internalOrderId?: number;
  side?: string;
  qty?: number;
  price?: number;
  status?: string;
  scTs?: string;
  createdAt: string;
}

export const fetchStudySettingsReloadStatus = () =>
  api<StudySettingsReloadStatus>("/study-settings/reload-status");

export const fetchSetupPhases = (playbookId?: string, limit = 100) =>
  api<SetupPhaseRow[]>(
    `/setup-phases?limit=${limit}${playbookId ? `&playbookId=${encodeURIComponent(playbookId)}` : ""}`
  );

export const fetchOrderLifecycle = (playbookId?: string, limit = 100) =>
  api<OrderLifecycleRow[]>(
    `/order-lifecycle?limit=${limit}${playbookId ? `&playbookId=${encodeURIComponent(playbookId)}` : ""}`
  );

/* ------------------------------- Intelligence ------------------------------- */

export interface AiModel {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  mmprojPath: string | null;
  isMmproj: boolean;
  isMultimodal: boolean;
}

export interface AiStatus {
  state: "stopped" | "starting" | "running" | "error" | "stopping";
  pid: number | null;
  modelPath: string | null;
  modelName: string | null;
  mmprojPath: string | null;
  port: number;
  host: string;
  ctxSize: number;
  gpuLayers: number;
  healthOk: boolean;
  tokensPerSecond: number | null;
  logs: string[];
  error: string | null;
  startedAt: string | null;
}

export interface AiSettings {
  // read-only environment
  llamaServerBin: string;
  modelDirs: string;
  host: string;
  // server launch flags
  activeModelPath: string;
  ctxSize: number;
  gpuLayers: number;
  port: number;
  flashAttn: string;
  threads: number;
  batchSize: number;
  ubatchSize: number;
  parallel: number;
  jinja: boolean;
  autoStart: boolean;
  // sampling / generation
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
  maxTokens: number;
  seed: number;
  // prompt / gemma4
  systemPrompt: string;
  enableThinking: boolean;
  thinkingEfficiency: "normal" | "low";
  nativeTools: boolean;
  // memory engine
  memoryMode: "approval" | "auto";
}

export type PromptSectionId =
  | "profile"
  | "user"
  | "base"
  | "rules"
  | "memory"
  | "skills"
  | "tools"
  | "platform"
  | "mentions"
  | "chatHistory"
  | "userMessage"
  | "final";

export interface AiAssembledSection {
  id: PromptSectionId;
  label: string;
  enabled: boolean;
  included: boolean;
  preview: string;
  charCount: number;
  inSystemPrompt: boolean;
}

export interface AiPromptFlowConfig {
  sections: Array<{ id: PromptSectionId; enabled: boolean; order: number }>;
  positions?: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface AiAssembledPrompt {
  systemPrompt: string;
  sections: AiAssembledSection[];
  omitted: string[];
  estimatedChars: number;
}

export interface AiMemory {
  id: string;
  scope: "global" | "chat";
  chat_id: string | null;
  agent_id: string | null;
  text: string;
  category: string | null;
  source: string;
  enabled: number;
  status: "active" | "pending";
  created_at: string;
  updated_at: string;
  embedding_model?: string | null;
  embedding_dim?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  /** 1 when a vector embedding exists; FTS may still index without it. */
  has_embedding?: number;
}

export interface AiArtifact {
  id: string;
  agent_id: string;
  name: string;
  kind: string;
  mime_type: string | null;
  path: string;
  size_bytes: number;
  description: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  /** 1 when DB content column is populated. */
  has_content?: number;
}

export interface AiRule {
  id: string;
  description: string;
  body: string;
  alwaysApply: boolean;
  globs: string[];
  departments: string[];
  priority: number;
  enabled: boolean;
  /** Reflection drafts start as pending until approved. */
  status?: "active" | "pending";
  /** Owner agent id (present on DB-backed list rows). */
  agentId?: string;
  version?: number;
  updatedAt?: string;
}

export interface AiSkill {
  id: string;
  name: string;
  description: string;
  tools: string[];
  departments: string[];
  enabled: boolean;
  /** Reflection drafts start as pending until approved. */
  status?: "active" | "pending";
  body?: string;
  /** Owner agent id (present on DB-backed list rows). */
  agentId?: string;
  version?: number;
  updatedAt?: string;
}

export interface AiChatCommand {
  name: string;
  usage: string;
  description: string;
  runsOn: "client" | "server";
}

export interface AiToolDef {
  name: string;
  description: string;
  mode: "auto" | "confirm";
  category?: string;
  departments?: string[];
  write?: boolean;
}

export interface AiInspect {
  systemPrompt: string;
  defaultSystemPrompt: string;
  sampling: {
    temperature: number;
    topP: number;
    topK: number;
    minP: number;
    repeatPenalty: number;
    presencePenalty: number;
    frequencyPenalty: number;
    maxTokens: number;
    seed: number;
  };
  launch: { bin: string; args: string[] } | null;
  tools: AiToolDef[];
  toolsNote: string;
  sections?: AiAssembledSection[];
  omitted?: string[];
  estimatedChars?: number;
  lastRequest: {
    at: string;
    systemPrompt: string;
    sampling: AiInspect["sampling"];
    endpoint: string;
    messages: Array<{ role: string; preview: string; images: number }>;
    sections?: AiAssembledSection[];
    omitted?: string[];
  } | null;
}

export interface AiChat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiStoredMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: {
    text?: string;
    images?: string[];
    content?: string;
    thinking?: string | null;
    answer?: string;
    /** Cursor-style structured parts (tools/thinking/todos/text) for replay. */
    parts?: unknown[];
  };
  created_at: string;
}

export const fetchAiModels = () => api<{ models: AiModel[] }>("/ai/models");
export const fetchAiStatus = () => api<AiStatus>("/ai/status");
export const fetchAiSettings = () => api<AiSettings>("/ai/settings");
export const fetchAiInspect = (opts?: { pathname?: string; agentId?: string }) => {
  const params = new URLSearchParams();
  if (opts?.pathname) params.set("pathname", opts.pathname);
  if (opts?.agentId) params.set("agentId", opts.agentId);
  const qs = params.toString();
  return api<AiInspect>(qs ? `/ai/inspect?${qs}` : "/ai/inspect");
};

export const fetchAiPromptFlow = (agentId?: string) => {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return api<{ config: AiPromptFlowConfig; assembled: AiAssembledPrompt }>(
    `/ai/prompt-flow${qs}`
  );
};

export const updateAiPromptFlow = (config: AiPromptFlowConfig, agentId?: string) =>
  updateDto<{ config: AiPromptFlowConfig; assembled: AiAssembledPrompt }>(
    "PromptFlow",
    "default",
    { config, agent_id: agentId ?? "intelligence" }
  );

export const fetchAiMemories = (
  chatId?: string,
  agentId?: string,
  status?: "active" | "pending"
) => {
  const params = new URLSearchParams();
  if (chatId) params.set("chatId", chatId);
  if (agentId) params.set("agentId", agentId);
  if (status) params.set("status", status);
  const qs = params.toString();
  return api<AiMemory[]>(qs ? `/ai/memories?${qs}` : "/ai/memories");
};

export const approveAiMemory = (id: string) =>
  actionDto<RecordRowClient>("Memory", "approve", {}, id, true).then(rowDto<AiMemory>);

export const createAiMemory = (body: {
  text: string;
  scope?: "global" | "chat";
  chatId?: string;
  category?: string;
  agentId?: string;
}) =>
  createDto<AiMemory>(
    "Memory",
    {
      // Ownership via ?agentId= scope, not a writable Memory field.
      text: body.text,
      scope: body.scope,
      chat_id: body.chatId,
      category: body.category,
    },
    { agentId: body.agentId }
  );

export const updateAiMemory = (
  id: string,
  patch: { text?: string; enabled?: boolean; category?: string }
) =>
  updateDto<AiMemory>("Memory", id, patch);

export const deleteAiMemory = (id: string) =>
  deleteDto("Memory", id);

export const fetchAiRules = (agentId?: string) =>
  api<{ rules: AiRule[] }>(
    agentId ? `/ai/rules?agentId=${encodeURIComponent(agentId)}` : "/ai/rules"
  );

export const updateAiRuleState = (
  id: string,
  patch: { enabled?: boolean; priorityOverride?: number | null; agentId?: string }
) => {
  return updateDto<AiRule>(
    "Rule",
    id,
    {
      // Ownership via ?agentId= scope, not a writable Rule field.
      enabled: patch.enabled,
      priority: patch.priorityOverride,
    },
    { agentId: patch.agentId }
  ).then((rule) => ({ rules: [rule] }));
};

export const approveAiRule = (id: string, agentId?: string) => {
  return actionDto<RecordRowClient>(
    "Rule",
    "approve",
    {},
    id,
    true,
    { agentId }
  ).then((row) => ({ rules: [rowDto<AiRule>(row)] }));
};

export const rejectAiRule = (id: string, agentId?: string) => {
  return actionDto<{ ok: boolean }>(
    "Rule",
    "reject",
    {},
    id,
    true,
    { agentId }
  ).then(() => ({ ok: true, rules: [] }));
};

export const fetchAiSkills = (includeBody?: boolean, agentId?: string) => {
  const params = new URLSearchParams();
  if (includeBody) params.set("body", "1");
  if (agentId) params.set("agentId", agentId);
  const qs = params.toString();
  return api<{ skills: AiSkill[] }>(qs ? `/ai/skills?${qs}` : "/ai/skills");
};

export const updateAiSkillState = (
  id: string,
  enabled: boolean,
  agentId?: string
) => {
  // Ownership via ?agentId= scope, not a writable Skill field.
  return updateDto<AiSkill>("Skill", id, { enabled }, { agentId }).then(
    (skill) => ({
      skills: [skill],
    })
  );
};

export const approveAiSkill = (id: string, agentId?: string) => {
  return actionDto<RecordRowClient>(
    "Skill",
    "approve",
    {},
    id,
    true,
    { agentId }
  ).then((row) => ({ skills: [rowDto<AiSkill>(row)] }));
};

export const rejectAiSkill = (id: string, agentId?: string) => {
  return actionDto<{ ok: boolean }>(
    "Skill",
    "reject",
    {},
    id,
    true,
    { agentId }
  ).then(() => ({ ok: true, skills: [] }));
};

export const fetchAiArtifacts = (agentId?: string, limit?: number) => {
  const params = new URLSearchParams();
  if (agentId) params.set("agentId", agentId);
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString();
  return api<{ artifacts: AiArtifact[] }>(qs ? `/ai/artifacts?${qs}` : "/ai/artifacts");
};

export const fetchAiArtifact = (id: string, agentId?: string, withContent?: boolean) => {
  const params = new URLSearchParams();
  if (agentId) params.set("agentId", agentId);
  if (withContent) params.set("content", "1");
  const qs = params.toString();
  return api<AiArtifact & { content?: string }>(
    qs ? `/ai/artifacts/${id}?${qs}` : `/ai/artifacts/${id}`
  );
};

export const createAiArtifact = (body: {
  name: string;
  content: string;
  agentId?: string;
  kind?: string;
  mimeType?: string;
  description?: string;
}) =>
  createDto<AiArtifact>(
    "Artifact",
    {
      // Ownership via ?agentId= scope, not a writable Artifact field.
      name: body.name,
      content: body.content,
      kind: body.kind,
      mime_type: body.mimeType,
      description: body.description,
    },
    { agentId: body.agentId }
  );

export const deleteAiArtifact = (id: string, agentId?: string) => {
  return deleteDto("Artifact", id, { agentId });
};

export const fetchAiCommands = () => api<{ commands: AiChatCommand[] }>("/ai/commands");

export const fetchAiToolsRegistry = (agentId = "intelligence") =>
  api<{ tools: AiToolDef[] }>(`/ai/tools?agentId=${encodeURIComponent(agentId)}`);
export const updateAiSettings = (patch: Partial<AiSettings>) =>
  updateDto<AiSettings>("IntelligenceSettings", "default", patch);
export const startAiModel = (modelPath?: string) =>
  modelPath
    ? actionDto(
        "ModelRuntime",
        "select_model",
        { model_id: `local:${modelPath}` },
        "runtime",
        true
      ).then(fetchAiStatus)
    : actionDto<AiStatus>("ModelRuntime", "start", {}, "runtime", true);
export const stopAiModel = () =>
  actionDto<AiStatus>("ModelRuntime", "stop", {}, "runtime", true);
export const restartAiModel = (modelPath?: string) =>
  modelPath
    ? actionDto(
        "ModelRuntime",
        "select_model",
        { model_id: `local:${modelPath}` },
        "runtime",
        true
      ).then(fetchAiStatus)
    : actionDto<AiStatus>("ModelRuntime", "restart", {}, "runtime", true);

/* --------------------------- EMBEDDING ENGINE --------------------------- */

export type CpuServerState =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "stopping";

export interface CpuServerStatus {
  role: string;
  state: CpuServerState;
  pid: number | null;
  modelPath: string | null;
  modelName: string | null;
  port: number;
  host: string;
  healthOk: boolean;
  logs: string[];
  error: string | null;
  startedAt: string | null;
}

export interface EmbeddingEngineStatus {
  enabled: boolean;
  /** True/false when the persisted runtime override is set, null = env default. */
  enabledOverride: boolean | null;
  embedder: CpuServerStatus | null;
}

export interface EmbeddingEngineActivity {
  enabled: boolean;
  pending: {
    skills: number;
    rules: number;
    memories: number;
    episodes?: number;
    wikiProposals?: number;
  };
  embeddingCoverage: { total: number; embedded: number };
  ftsCoverage?: { total: number; indexed: number };
  ragTopK: number;
  wikiRagTopK?: number;
  embedderLogTail: string[];
}

export const fetchEmbeddingStatus = () =>
  api<EmbeddingEngineStatus>("/ai/embeddings/status");
export const fetchEmbeddingActivity = () =>
  api<EmbeddingEngineActivity>("/ai/embeddings/activity");
export const setEmbeddingEnabled = (enabled: boolean) =>
  actionDto<EmbeddingEngineStatus>(
    "EmbeddingRuntime",
    "set_enabled",
    { enabled },
    "runtime",
    true
  );
export const startEmbeddingEngine = () =>
  actionDto<EmbeddingEngineStatus>("EmbeddingRuntime", "start", {}, "runtime", true);
export const stopEmbeddingEngine = () =>
  actionDto<EmbeddingEngineStatus>("EmbeddingRuntime", "stop", {}, "runtime", true);

export const fetchAiChats = () => api<AiChat[]>("/ai/chats");
export const createAiChat = (title?: string) =>
  createDto<AiChat>("ChatSession", { title });
export const deleteAiChat = (id: string) =>
  deleteDto("ChatSession", id);
export const fetchAiMessages = (chatId: string) =>
  api<AiStoredMessage[]>(`/ai/chats/${chatId}/messages`);

export interface SharedChatSession {
  id: string;
  chatId: string;
  agentId: string;
  homeTenantId: string;
  createdByUserId: string;
  createdAt: string;
  isHome: boolean;
}

/** Resolve whether a chat is a collaborative shared session (and its home). */
export const fetchChatSession = (chatId: string) =>
  api<{ shared: boolean; session: SharedChatSession | null }>(
    `/ai/chats/${chatId}/session`
  );

/** Promote a chat to a shared session so collaborators can join it live. */
export const startSharedChatSession = (chatId: string, agentId: string) =>
  actionDto<{ ok: boolean; session: SharedChatSession }>(
    "ChatSession",
    "share",
    { agent_id: agentId },
    chatId,
    true
  );

export interface AiChatHistoryTurn {
  role: string;
  content?: string;
  parts?: Array<{
    kind: string;
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
    status?: string;
    result?: unknown;
    text?: string;
  }>;
}

export interface AiChatRequest {
  chatId?: string;
  message: string;
  history?: AiChatHistoryTurn[];
  platformContext?: unknown;
  images?: string[];
  agentId?: string;
  /**
   * When chatting with a shared agent, also contribute any new memories the
   * turn produces back to the agent owner's workspace. No-op for owned agents.
   */
  contributeMemory?: boolean;
  /** Auto-approve confirm-gated tools (kill-switches still require approval). */
  autoAcceptTools?: boolean;
  /** Agent / Plan / Ask mode. */
  chatMode?: "agent" | "plan" | "ask";
  /** Session tool autonomy: off | writes | full. */
  toolAutonomy?: "off" | "writes" | "full";
}

export interface AiStreamHandlers {
  onChatId?: (chatId: string) => void;
  onToken?: (content: string) => void;
  onReasoning?: (content: string) => void;
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
    toolCallId?: string
  ) => void;
  onToolCallDelta?: (
    toolCallId: string,
    name: string,
    args: Record<string, unknown>
  ) => void;
  onToolResult?: (
    name: string,
    result: unknown,
    toolCallId?: string,
    isError?: boolean
  ) => void;
  onToolConfirmRequired?: (payload: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
  }) => void;
  onTerminalOutput?: (payload: {
    toolCallId: string;
    stream: "stdout" | "stderr";
    text: string;
  }) => void;
  onDone?: (data: {
    content: string;
    thinking: string | null;
    answer: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    contextWindow?: number;
    messageId: string;
  }) => void;
  onError?: (error: string) => void;
}

/**
 * Streams a chat completion from the bridge AI proxy via SSE-over-fetch.
 * Returns an abort function.
 */
export function streamAiChat(
  req: AiChatRequest,
  handlers: AiStreamHandlers
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const tenantId = getActiveTenantId();
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
        },
        body: JSON.stringify(req),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        handlers.onError?.((err as { error?: string }).error ?? res.statusText);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const block of events) {
          let event = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          switch (event) {
            case "chat_id":
              handlers.onChatId?.(parsed.chatId as string);
              break;
            case "token":
              handlers.onToken?.(parsed.content as string);
              break;
            case "reasoning":
              handlers.onReasoning?.(parsed.content as string);
              break;
            case "tool_call":
              handlers.onToolCall?.(
                parsed.name as string,
                (parsed.args as Record<string, unknown>) ?? {},
                parsed.toolCallId as string | undefined
              );
              break;
            case "tool_result":
              handlers.onToolResult?.(
                parsed.name as string,
                parsed.result,
                parsed.toolCallId as string | undefined,
                parsed.isError as boolean | undefined
              );
              break;
            case "tool_call_delta":
              handlers.onToolCallDelta?.(
                parsed.toolCallId as string,
                parsed.name as string,
                (parsed.args as Record<string, unknown>) ?? {}
              );
              break;
            case "tool_confirm_required":
              handlers.onToolConfirmRequired?.({
                toolCallId: parsed.toolCallId as string,
                name: parsed.name as string,
                args: (parsed.args as Record<string, unknown>) ?? {},
              });
              break;
            case "terminal_output":
              handlers.onTerminalOutput?.({
                toolCallId: parsed.toolCallId as string,
                stream: parsed.stream as "stdout" | "stderr",
                text: parsed.text as string,
              });
              break;
            case "done":
              handlers.onDone?.(parsed as never);
              break;
            case "error":
              handlers.onError?.(parsed.error as string);
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      }
    }
  })();

  return () => controller.abort();
}

export interface AiAdapter {
  id: string;
  name: string;
  path: string;
  description: string | null;
  domain: string | null;
  enabled: number;
  default_scale: number;
}

export interface AiQueueJob {
  id: string;
  status: string;
  priority: number;
  workflow_id: string | null;
  prompt: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
}

export interface AiWorkflow {
  id: string;
  name: string;
  config_json: string;
  enabled: number;
  agent_id: string | null;
}

export interface AiSchedule {
  id: string;
  workflow_id: string;
  cron_expr: string;
  timezone: string;
  enabled: number;
  last_run_at: string | null;
}

export interface AiProjectColumn {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
}

export interface AiProjectCard {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  description: string | null;
  prompt: string | null;
  context_json: string | null;
  tags_json: string | null;
  due_at: string | null;
  linked_chat_id: string | null;
  linked_workflow_id: string | null;
  sort_order: number;
  priority: number;
  parent_card_id: string | null;
  status: string | null;
  assigned_agent_id: string | null;
}

export type AgentBackendKind =
  | "local"
  | "provider"
  | "cli"
  | "acp"
  | "remote"
  | "cursor"
  | "cursor_cloud";

export interface InferenceRunResult {
  ok: boolean;
  content: string;
}

export function runInference(body: {
  endpointId: string;
  messages: Array<{ role: string; content: string }>;
  sampling?: Record<string, number>;
}) {
  return actionDto<InferenceRunResult>(
    "InferenceRuntime",
    "run_inference",
    {
      endpoint_id: body.endpointId,
      messages: body.messages,
      sampling: body.sampling,
    },
    undefined,
    true
  );
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
  sampling: {
    temperature: number;
    topP: number;
    topK: number;
    minP: number;
    repeatPenalty: number;
    presencePenalty: number;
    frequencyPenalty: number;
    maxTokens: number;
    seed: number;
  };
  thinking: {
    enableThinking: boolean;
    thinkingEfficiency: "normal" | "low";
    nativeTools: boolean;
  };
  toolAllow: string[] | null;
  autoApprove: string[];
  modelPath: string | null;
  adapterIds: string[];
  config: Record<string, unknown>;
  parentId: string | null;
  team: string | null;
  createdAt: string;
  updatedAt: string;
  /** True when this agent is shared TO the current user (not owned by them). */
  shared?: boolean;
  /** The caller's share role on the agent ("owner" when owned). */
  shareRole?: "viewer" | "editor" | "owner";
}

export interface AiSecret {
  id: string;
  name: string;
  masked: string;
  createdAt: string;
}

export interface AiCardComment {
  id: string;
  card_id: string;
  // 'system' is written by automated handlers (e.g. backtest completion).
  author: "user" | "agent" | "system";
  body: string;
  kind?: string | null;
  created_at: string;
}

export interface AiWorkflowComment {
  id: string;
  workflow_id: string;
  author: "user" | "agent";
  body: string;
  created_at: string;
}

export interface AiCardSubtasks {
  subtasks: AiProjectCard[];
  total: number;
  done: number;
  open: number;
}

export interface AiProjectRow {
  id: string;
  name: string;
  agent_id: string | null;
  user_id?: string | null;
  archived_at?: string | null;
  github_project_node_id?: string | null;
  github_project_url?: string | null;
  github_status_map_json?: string | null;
  sync_enabled?: number;
  last_synced_at?: string | null;
}

export interface AiProjectsSnapshot {
  projects: AiProjectRow[];
  columns: AiProjectColumn[];
  cards: AiProjectCard[];
}

/** LoRA adapter slot as reported by llama-server's `/lora-adapters`. */
export interface AiLoraAdapter {
  id: number;
  path: string;
  scale: number;
}

export const confirmAiTool = (toolCallId: string, approved: boolean) =>
  actionDto<{ ok: boolean }>(
    "ChatSession",
    "confirm_tool",
    { tool_call_id: toolCallId, approved }
  );

export const fetchAiAdapters = () => api<{ adapters: AiAdapter[] }>("/ai/adapters");
export const createAiAdapter = (body: {
  name: string;
  path: string;
  description?: string;
  domain?: string;
  defaultScale?: number;
}) => createDto<AiAdapter>("ModelAdapter", {
  name: body.name,
  path: body.path,
  description: body.description,
  domain: body.domain,
  default_scale: body.defaultScale,
});
export const updateAiAdapter = (
  id: string,
  patch: { enabled?: boolean; defaultScale?: number; description?: string }
) => updateDto<AiAdapter>("ModelAdapter", id, {
  enabled: patch.enabled,
  default_scale: patch.defaultScale,
  description: patch.description,
});
export const deleteAiAdapter = (id: string) =>
  deleteDto("ModelAdapter", id);

export interface AiDataset {
  id: string;
  name: string;
  domain: string | null;
  path: string;
  row_count: number;
  created_at: string;
  updated_at: string;
}

export interface AiTrainingJob {
  id: string;
  adapter_id: string;
  status: "pending" | "running" | "done" | "error" | string;
  config_json: string;
  log: string;
  progress: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AiTrainingConfig {
  trainBaseModel: string;
  llamaCppDir: string;
  adaptersDir: string;
}

export const fetchAiTrainingConfig = () => api<AiTrainingConfig>("/ai/training/config");

export const fetchAiDatasets = () => api<{ datasets: AiDataset[] }>("/ai/datasets");

export const createAiDataset = (body: {
  name: string;
  domain?: string;
  path: string;
  rowCount?: number;
}) => actionDto<AiDataset>("Dataset", "import_dataset", {
  name: body.name,
  domain: body.domain,
  path: body.path,
  row_count: body.rowCount,
}, undefined, true);

export interface AiDatasetSource {
  source: string;
  label: string;
  count: number;
}

export interface AiDatasetExample {
  messages?: { role: string; content: string }[];
  instruction?: string;
  output?: string;
}

export interface AiChatSummary {
  id: string;
  title: string;
  message_count: number;
  updated_at: string;
}

export const fetchAiDatasetSources = () =>
  api<{ sources: AiDatasetSource[] }>("/ai/datasets/sources");

export const fetchAiDatasetChats = () =>
  api<{ chats: AiChatSummary[] }>("/ai/datasets/chats");

export const fetchAiDatasetPreview = (source: string, limit = 50) =>
  api<{ examples: AiDatasetExample[]; total: number }>(
    `/ai/datasets/preview?source=${encodeURIComponent(source)}&limit=${limit}`
  );

export const buildAiDataset = (body: {
  name: string;
  domain?: string;
  source: string;
  chatIds?: string[];
  limit?: number;
}) => actionDto<AiDataset>("Dataset", "build_dataset", {
  name: body.name,
  domain: body.domain,
  source: body.source,
  chat_ids: body.chatIds,
  limit: body.limit,
}, undefined, true);

export const fetchAiTrainingJobs = () => api<{ jobs: AiTrainingJob[] }>("/ai/training/jobs");

export const fetchAiTrainingJob = (id: string) => api<AiTrainingJob>(`/ai/training/jobs/${id}`);

export const createAiTrainingJob = (body: {
  adapterName: string;
  domain?: string;
  description?: string;
  datasetPath?: string;
  datasetId?: string;
  baseModel?: string;
  epochs?: number;
  learningRate?: number;
  loraRank?: number;
}) =>
  actionDto<{ id: string; job: AiTrainingJob }>("TrainingJob", "enqueue", {
    adapter_name: body.adapterName,
    domain: body.domain,
    description: body.description,
    dataset_path: body.datasetPath,
    dataset_id: body.datasetId,
    base_model: body.baseModel,
    epochs: body.epochs,
    learning_rate: body.learningRate,
    lora_rank: body.loraRank,
  }, undefined, true);

export const cancelAiTrainingJob = (id: string) =>
  actionDto<{ ok: boolean }>("TrainingJob", "cancel", {}, id, true);

export const fetchAiLoraAdapters = () => api<AiLoraAdapter[]>("/ai/lora-adapters");
export const fetchAiQueue = () => api<{ jobs: AiQueueJob[] }>("/ai/queue");
export const fetchAiAgents = () => api<{ agents: AiAgent[] }>("/ai/agents");
export const fetchAiAgent = (id: string) => api<AiAgent>(`/ai/agents/${id}`);
export const createAiAgent = async (body: {
  name: string;
  description?: string;
  icon?: string;
  backend?: AgentBackendKind;
  parentId?: string | null;
  cloneFromId?: string;
  systemPrompt?: string;
  sampling?: Partial<AiAgent["sampling"]>;
  thinking?: Partial<AiAgent["thinking"]>;
  toolAllow?: string[] | null;
  autoApprove?: string[];
  modelPath?: string | null;
  adapterIds?: string[];
  config?: Record<string, unknown>;
}) => {
  if (body.cloneFromId) {
    return cloneAiAgent(body.cloneFromId, body.name);
  }
  const row = await actionDto<RecordRowClient>("Agent", "create_configured", {
    name: body.name,
    description: body.description,
    icon: body.icon,
    backend: body.backend,
    system_prompt: body.systemPrompt,
    sampling: body.sampling,
    thinking: body.thinking,
    tool_allow: body.toolAllow,
    auto_approve: body.autoApprove,
    model_path: body.modelPath,
    adapter_ids: body.adapterIds,
    config: body.config,
    parent_id: body.parentId,
  });
  return fetchAiAgent(row.id);
};
export const cloneAiAgent = (id: string, name: string) =>
  actionDto<RecordRowClient>("Agent", "clone", { name }, id)
    .then((row) => fetchAiAgent(row.id));
export const updateAiAgent = (
  id: string,
  patch: Partial<AiAgent> & Record<string, unknown>
) => {
  return actionDto<RecordRowClient>("Agent", "update_config", {
    name: patch.name,
    description: patch.description,
    icon: patch.icon,
    backend: patch.backend,
    enabled: patch.enabled,
    system_prompt: patch.systemPrompt,
    sampling: patch.sampling,
    thinking: patch.thinking,
    tool_allow: patch.toolAllow,
    auto_approve: patch.autoApprove,
    model_path: patch.modelPath,
    adapter_ids: patch.adapterIds,
    config: patch.config,
    parent_id: patch.parentId,
    team: patch.team,
  }, id).then(() => fetchAiAgent(id));
};
export const deleteAiAgent = (id: string) =>
  deleteDto("Agent", id);

export interface AgentTypedProfile {
  // Agent-specific fields
  purpose?: string | null;
  domain?: string | null;
  mandate?: string | null;
  escalatesTo?: string | null;
  notes?: string | null;
  // Shared with UserProfile (Agents & Users symmetry)
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  timezone?: string | null;
  languages?: string | null;
  interests?: string | null;
  values?: string | null;
  goals?: string | null;
  personalityNotes?: string | null;
  decisionStyle?: string | null;
  riskTolerance?: string | null;
  communicationStyle?: string | null;
}

export interface AiAgentAccount {
  id: string;
  agentId: string;
  kind: "oauth" | "apikey";
  provider: string | null;
  providerUserId: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  status: "active" | "revoked";
  maskedToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export const fetchAgentAccounts = (agentId: string) =>
  api<{ accounts: AiAgentAccount[] }>(`/ai/agents/${agentId}/accounts`);

export const createAgentApiKeyAccount = (
  agentId: string,
  body: { provider: string; apiKey: string; label?: string }
) =>
  createDto<AiAgentAccount>("ProviderCredential", {
    agent_id: agentId,
    provider: body.provider,
    api_key: body.apiKey,
    label: body.label,
  }).then((account) => ({ account }));

export const revokeAgentAccount = (agentId: string, accountId: string) => {
  void agentId;
  return deleteDto("ProviderCredential", accountId);
};

export interface AgentReflectionConfig {
  enabled: boolean;
  mode: "approval" | "auto";
  schedule: { enabled: boolean; cron: string; timezone: string };
  idle: { enabled: boolean; afterMinutes: number };
  lastRunAt: string | null;
  lastSummary: string | null;
  watermark: string | null;
}

export interface ReflectionProposal {
  id: string;
  agent_id: string;
  kind: string;
  target_id: string | null;
  action: string;
  payload_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export const fetchAgentReflection = (agentId: string) =>
  api<{ reflection: AgentReflectionConfig }>(`/ai/agents/${agentId}/reflection`);

export const patchAgentReflection = (
  agentId: string,
  patch: Partial<AgentReflectionConfig>
) =>
  actionDto<{ reflection: AgentReflectionConfig }>(
    "Agent",
    "configure_reflection",
    patch as Record<string, unknown>,
    agentId,
    true
  );

export const runAgentReflection = (agentId: string) =>
  actionDto<{ ok: boolean; jobId: string }>(
    "Agent",
    "run_reflection",
    {},
    agentId,
    true
  );

export const fetchReflectionProposals = (
  agentId: string,
  status: "pending" | "approved" | "rejected" | "all" = "pending"
) =>
  api<{ proposals: ReflectionProposal[] }>(
    `/ai/agents/${agentId}/reflection/proposals?status=${status}`
  );

export const approveReflectionProposal = (id: string) =>
  actionDto<{ ok: boolean }>("ReflectionProposal", "approve", {}, id, true);

export const rejectReflectionProposal = (id: string) =>
  actionDto<{ ok: boolean }>("ReflectionProposal", "reject", {}, id, true);

export type AiAssignmentRole = "viewer" | "editor" | "owner";
export interface AiAgentAssignment {
  scope_type: "department" | "division" | "page";
  scope_id: string;
  agent_id: string;
  role: AiAssignmentRole;
  updated_at: string;
}
export interface AiResolvedAgent {
  agentId: string;
  inheritedFrom: "page" | "division" | "department" | "root";
}
export const fetchAgentAssignments = () =>
  api<{ assignments: AiAgentAssignment[] }>("/ai/agents/assignments");
export const setAgentAssignment = (
  scopeType: AiAgentAssignment["scope_type"],
  scopeId: string,
  agentId: string | null,
  role?: AiAssignmentRole
) => {
  if (!agentId) {
    return deleteRecordApi("AgentAssignment", scopeId).then(() => ({
      ok: true,
      assignment: null,
    }));
  }
  return actionDto<RecordRowClient>(
    "Agent",
    "assign",
    { scope_type: scopeType, scope_id: scopeId, role },
    agentId,
    true
  ).then((row) => ({
    ok: true,
    assignment: rowDto<AiAgentAssignment>(row),
  }));
};

export interface PlatformActionLogRow {
  id: number;
  agent_id: string;
  action: string;
  scope: string | null;
  payload_hash: string | null;
  result: string;
  created_at: string;
}
export const fetchPlatformActions = (limit = 50) =>
  api<{ actions: PlatformActionLogRow[] }>(
    `/ai/platform/actions?limit=${limit}`
  );
export const resolveAgentForPage = (loc: {
  departmentId: string;
  divisionId?: string;
  pageId?: string;
}) => {
  const qs = new URLSearchParams({ departmentId: loc.departmentId });
  if (loc.divisionId) qs.set("divisionId", loc.divisionId);
  if (loc.pageId) qs.set("pageId", loc.pageId);
  return api<AiResolvedAgent>(`/ai/agents/resolve?${qs.toString()}`);
};
export const fetchAiSecrets = () => api<{ secrets: AiSecret[] }>("/ai/secrets");
export const createAiSecret = (name: string, value: string) =>
  createDto<AiSecret>("VaultSecret", { name, value });
export const deleteAiSecret = (id: string) =>
  deleteDto("VaultSecret", id);

export interface CursorAuthStatus {
  connected: boolean;
  source: "env" | "vault" | "none";
  masked?: string;
  cliAuthenticated?: boolean;
  cliDetail?: string;
}

export interface CursorModelOption {
  id: string;
  label: string;
}

export const fetchCursorStatus = () => api<CursorAuthStatus>("/ai/cursor/status");
export const connectCursorApiKey = (apiKey: string) =>
  createRecordApi("ProviderCredential", {
    agent_id: "intelligence",
    provider: "cursor",
    label: "Cursor subscription",
    api_key: apiKey,
  })
    .then(fetchCursorStatus)
    .then((status) => ({ ok: true, status }));
export const disconnectCursorApiKey = () =>
  deleteRecordApi("ProviderCredential", "cursor-api-key")
    .then(fetchCursorStatus)
    .then((status) => ({ ok: true, status }));
export const fetchCursorModels = () =>
  api<{ models: CursorModelOption[] }>("/ai/cursor/models");
export const applyCursorToIntelligence = (model = "auto") =>
  actionDto<{ ok: boolean }>(
    "ModelRuntime",
    "select_model",
    { model_id: `cursor:${model}` },
    "runtime",
    true
  );

export type CatalogModelSource = "local" | "cursor" | "provider" | "remote";

export interface CatalogModel {
  id: string;
  source: CatalogModelSource;
  label: string;
  path?: string;
  model?: string;
  endpointId?: string;
  provider?: "openai" | "anthropic" | "openai_compatible";
  multimodal?: boolean;
  active?: boolean;
}

export const fetchModelCatalog = () =>
  api<{ models: CatalogModel[]; active: CatalogModel | null }>("/ai/model-catalog");

export const selectIntelligenceModel = (body: {
  source: CatalogModelSource;
  path?: string;
  model?: string;
  provider?: "openai" | "anthropic" | "openai_compatible";
  endpointId?: string;
  apiKeyRef?: string;
}) =>
  actionDto<{ ok: true; active: CatalogModel }>(
    "ModelRuntime",
    "select_model",
    {
      model_id:
        body.source === "local"
          ? `local:${body.path}`
          : body.source === "remote"
            ? `remote:${body.endpointId}`
            : body.source === "cursor"
              ? `cursor:${body.model}`
              : `provider:${body.provider ?? "openai"}:${body.model}`,
    },
    "runtime",
    true
  );

export const truncateAiChat = (chatId: string, afterMessageId: string) =>
  actionDto<{ deleted: number }>(
    "ChatSession",
    "truncate",
    { after_message_id: afterMessageId },
    chatId,
    true
  );

export const deleteAiChatMessage = (chatId: string, messageId: string) => {
  void chatId;
  return deleteDto("ChatMessage", messageId);
};

export interface AiRepoMentionPath {
  path: string;
  type: "file" | "dir";
}

export const fetchRepoMentionPaths = (q = "") =>
  api<{ paths: AiRepoMentionPath[] }>(
    `/ai/coding/mention-paths${q ? `?q=${encodeURIComponent(q)}` : ""}`
  );

export const enqueueAiJob = (body: {
  prompt?: string;
  workflowId?: string;
  priority?: number;
  context?: Record<string, unknown>;
  adapterIds?: string[];
}) => actionDto<AiQueueJob>("PromptQueueJob", "enqueue", {
  prompt: body.prompt,
  workflow_id: body.workflowId,
  priority: body.priority,
  context: body.context,
  adapter_ids: body.adapterIds,
}, undefined, true);
export const cancelAiQueueJob = (id: string) =>
  actionDto<{ ok: boolean }>("PromptQueueJob", "cancel", {}, id, true);
export const fetchAiWorkflows = (agentId = "intelligence") =>
  api<{ workflows: AiWorkflow[] }>(
    `/ai/workflows?agentId=${encodeURIComponent(agentId)}`
  );
export const updateAiWorkflow = (id: string, patch: { name?: string; config?: unknown; enabled?: boolean }) =>
  updateDto<AiWorkflow>("Workflow", id, {
    name: patch.name,
    config_json: patch.config,
    enabled: patch.enabled,
  });
export const createAiWorkflow = (name: string, config?: unknown, agentId = "intelligence") =>
  createDto<AiWorkflow>("Workflow", {
    name,
    config_json: config ?? { nodes: [], edges: [], triggers: [] },
    agent_id: agentId,
  });

export const fetchActiveAgents = () =>
  api<{ activeAgentIds: string[] }>("/ai/agents/active");
export interface AiWorkflowRun {
  id: string;
  workflow_id: string;
  status: "running" | "awaiting_input" | "done" | "failed";
  card_id: string | null;
  awaiting_node_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  trigger_input?: string | null;
  result_json?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  workflow_name?: string | null;
}

export const fetchWorkflowRuns = (params?: { status?: string; cardId?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.cardId) q.set("cardId", params.cardId);
  const qs = q.toString();
  return api<{ runs: AiWorkflowRun[] }>(`/ai/workflows/runs${qs ? `?${qs}` : ""}`);
};
export const resumeWorkflowRun = (
  id: string,
  decision: "approve" | "request_changes",
  comments?: string
) =>
  actionDto<{ ok: boolean }>(
    "WorkflowRun",
    "resume",
    { decision, comments },
    id,
    true
  );
export const cancelWorkflowRun = (id: string) =>
  actionDto<{ ok: boolean }>("WorkflowRun", "cancel", {}, id, true);

export const fetchAiSchedules = () => api<{ schedules: AiSchedule[] }>("/ai/schedules");
export const createAiSchedule = (body: {
  workflowId: string;
  cronExpr: string;
  timezone?: string;
  enabled?: boolean;
}) => createDto<AiSchedule>("Schedule", {
  workflow_id: body.workflowId,
  cron_expr: body.cronExpr,
  timezone: body.timezone,
  enabled: body.enabled,
});
export const fetchAiProjects = (agentId = "intelligence") =>
  api<AiProjectsSnapshot>(`/ai/projects?agentId=${encodeURIComponent(agentId)}`);
export const createProjectCard = (body: {
  projectId?: string;
  agentId?: string;
  columnId?: string;
  title: string;
  description?: string;
  prompt?: string;
  contextJson?: unknown;
  tags?: string;
  dueAt?: string;
  priority?: number;
  parentCardId?: string;
  status?: string;
  assignedAgentId?: string;
}) =>
  createDto<AiProjectCard>(
    "TaskCard",
    {
      // Ownership via ?agentId= → ensureAgentProject; else personal ensureUserProject.
      column_id: body.columnId,
      title: body.title,
      description: body.description,
      prompt: body.prompt,
      context_json: body.contextJson,
      tags_json: body.tags,
      due_at: body.dueAt,
      priority: body.priority,
      parent_card_id: body.parentCardId,
      status: body.status,
      assigned_agent_id: body.assignedAgentId,
    },
    { agentId: body.agentId }
  );
export const moveProjectCard = (
  id: string,
  columnId: string,
  sortOrder?: number,
  agentId?: string
) =>
  actionDto<RecordRowClient>(
    "TaskCard",
    "move",
    { column_id: columnId, sort_order: sortOrder },
    id,
    false,
    { agentId }
  ).then(rowDto<AiProjectCard>);
export const updateProjectCard = (
  id: string,
  patch: {
    title?: string;
    description?: string;
    prompt?: string;
    contextJson?: unknown;
    tags?: string;
    dueAt?: string;
    columnId?: string;
    sortOrder?: number;
    priority?: number;
    parentCardId?: string | null;
    status?: string;
    assignedAgentId?: string | null;
    agentId?: string;
  }
) =>
  updateDto<AiProjectCard>(
    "TaskCard",
    id,
    {
      title: patch.title,
      description: patch.description,
      prompt: patch.prompt,
      context_json: patch.contextJson,
      tags_json: patch.tags,
      due_at: patch.dueAt,
      priority: patch.priority,
      parent_card_id: patch.parentCardId,
      assigned_agent_id: patch.assignedAgentId,
    },
    { agentId: patch.agentId }
  ).then(async (card) => {
    if (patch.columnId) {
      card = rowDto<AiProjectCard>(
        await actionDto<RecordRowClient>(
          "TaskCard",
          "move",
          { column_id: patch.columnId, sort_order: patch.sortOrder },
          id,
          false,
          { agentId: patch.agentId }
        )
      );
    }
    if (patch.status) {
      card = rowDto<AiProjectCard>(
        await actionDto<RecordRowClient>(
          "TaskCard",
          "transition",
          { status: patch.status },
          id,
          false,
          { agentId: patch.agentId }
        )
      );
    }
    return card;
  });
export const deleteProjectCard = (id: string, agentId?: string) =>
  deleteDto("TaskCard", id, { agentId });
export const fetchCardSubtasks = (id: string) =>
  api<AiCardSubtasks>(`/ai/projects/cards/${id}/subtasks`);
export const fetchCardComments = (id: string) =>
  api<{ comments: AiCardComment[] }>(`/ai/projects/cards/${id}/comments`);
export const addCardComment = (id: string, body: string, author: "user" | "agent" = "user") =>
  actionDto<RecordRowClient>("CardComment", "add_comment", {
    card_id: id,
    body,
    author,
  }).then(rowDto<AiCardComment>);
export const fetchWorkflowComments = (id: string) =>
  api<{ comments: AiWorkflowComment[] }>(`/ai/workflows/${id}/comments`);
export const addWorkflowComment = (id: string, body: string, author: "user" | "agent" = "user") =>
  createDto<AiWorkflowComment>("WorkflowComment", {
    workflow_id: id,
    body,
    author,
  });

/* ------------------------------ AI CALENDAR ----------------------------- */

export type AiCalendarKind = "event" | "task" | "appointment";

export interface AiCalendarEvent {
  id: string;
  agent_id: string;
  kind: AiCalendarKind;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: number;
  location: string | null;
  linked_card_id: string | null;
  linked_run_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export const fetchCalendarEvents = (
  agentId = "intelligence",
  range?: { from?: string; to?: string }
) => {
  const q = new URLSearchParams({ agentId });
  if (range?.from) q.set("from", range.from);
  if (range?.to) q.set("to", range.to);
  return api<{ events: AiCalendarEvent[] }>(`/ai/calendar/events?${q.toString()}`);
};

export const createCalendarEvent = (body: {
  agentId?: string;
  kind?: AiCalendarKind;
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
  all_day?: boolean;
  location?: string;
  linked_card_id?: string;
  linked_run_id?: string;
  status?: string;
}) =>
  createDto<AiCalendarEvent>(
    "CalendarEvent",
    {
      // Ownership via ?agentId= scope, not a writable CalendarEvent field.
      kind: body.kind,
      title: body.title,
      description: body.description,
      start_at: body.start_at,
      end_at: body.end_at,
      all_day: body.all_day,
      location: body.location,
      linked_card_id: body.linked_card_id,
      linked_run_id: body.linked_run_id,
      status: body.status,
    },
    { agentId: body.agentId }
  );

export const updateCalendarEvent = (
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    start_at?: string;
    end_at?: string | null;
    all_day?: boolean;
    location?: string | null;
    kind?: AiCalendarKind;
    status?: string;
    agentId?: string;
  }
) => {
  const { agentId, ...data } = patch;
  return updateDto<AiCalendarEvent>("CalendarEvent", id, data, { agentId });
};

export const deleteCalendarEvent = (id: string, agentId?: string) =>
  deleteDto("CalendarEvent", id, { agentId });

export const fetchCalendarActivity = (
  agentId = "intelligence",
  range?: { from?: string; to?: string }
) => {
  const q = new URLSearchParams({ agentId });
  if (range?.from) q.set("from", range.from);
  if (range?.to) q.set("to", range.to);
  return api<{ runs: AiWorkflowRun[]; cards: AiProjectCard[] }>(
    `/ai/calendar/activity?${q.toString()}`
  );
};

// --- Per-user calendar & tasks (owner workspace tenant) ---

export type UserProductivityRole = "owner" | "viewer" | "editor";

export const fetchUserCalendarEvents = (
  range?: { from?: string; to?: string },
  userId?: string
) => {
  const q = new URLSearchParams();
  if (range?.from) q.set("from", range.from);
  if (range?.to) q.set("to", range.to);
  if (userId) q.set("userId", userId);
  const qs = q.toString();
  return api<{ events: AiCalendarEvent[]; role: UserProductivityRole; ownerUserId: string }>(
    `/user/calendar/events${qs ? `?${qs}` : ""}`
  );
};

export const createUserCalendarEvent = (body: {
  kind?: AiCalendarKind;
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
  all_day?: boolean;
  location?: string;
  linked_card_id?: string;
  linked_run_id?: string;
  status?: string;
}) =>
  createDto<AiCalendarEvent>("CalendarEvent", body);

export const updateUserCalendarEvent = (
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    start_at?: string;
    end_at?: string | null;
    all_day?: boolean;
    location?: string | null;
    kind?: AiCalendarKind;
    status?: string;
  }
) =>
  updateDto<AiCalendarEvent>("CalendarEvent", id, patch);

export const deleteUserCalendarEvent = (id: string) =>
  deleteDto("CalendarEvent", id);

export const fetchUserCalendarActivity = (
  range?: { from?: string; to?: string },
  userId?: string
) => {
  const q = new URLSearchParams();
  if (range?.from) q.set("from", range.from);
  if (range?.to) q.set("to", range.to);
  if (userId) q.set("userId", userId);
  const qs = q.toString();
  return api<{
    runs: AiWorkflowRun[];
    cards: AiProjectCard[];
    role: UserProductivityRole;
    ownerUserId: string;
  }>(`/user/calendar/activity${qs ? `?${qs}` : ""}`);
};

export const fetchUserProjects = (userId?: string, projectId?: string) => {
  const params = new URLSearchParams();
  if (userId) params.set("userId", userId);
  if (projectId) params.set("projectId", projectId);
  const q = params.toString() ? `?${params}` : "";
  return api<
    AiProjectsSnapshot & {
      role: UserProductivityRole;
      ownerUserId: string;
      activeProjectId?: string;
    }
  >(`/user/projects${q}`);
};

export type UserTaskBoard = {
  id: string;
  name: string;
  user_id: string | null;
  archived_at: string | null;
  github_project_node_id: string | null;
  github_project_url: string | null;
  github_status_map_json: string | null;
  sync_enabled: number;
  last_synced_at: string | null;
};

export const createUserTaskBoard = (name: string) =>
  api<{ project: UserTaskBoard }>("/user/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const renameUserTaskBoard = (id: string, name: string) =>
  api<{ project: UserTaskBoard }>(`/user/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const archiveUserTaskBoard = (id: string) =>
  api<{ project: UserTaskBoard }>(
    `/user/projects/${encodeURIComponent(id)}/archive`,
    { method: "POST" }
  );

export const fetchGithubProjectsList = () =>
  api<{
    projects: Array<{
      id: string;
      title: string;
      url: string;
      number: number;
      owner: string;
    }>;
  }>("/user/github/projects");

export const linkUserBoardGithub = (
  boardId: string,
  body: { projectNodeId: string; statusMap?: Record<string, string> }
) =>
  api<{ project: UserTaskBoard }>(
    `/user/projects/${encodeURIComponent(boardId)}/github/link`,
    { method: "POST", body: JSON.stringify(body) }
  );

export const unlinkUserBoardGithub = (boardId: string) =>
  api<{ project: UserTaskBoard }>(
    `/user/projects/${encodeURIComponent(boardId)}/github/unlink`,
    { method: "POST" }
  );

export const syncUserBoardGithub = (boardId: string) =>
  api<{
    project: UserTaskBoard;
    pulled: number;
    created: number;
    updated: number;
  }>(`/user/projects/${encodeURIComponent(boardId)}/github/sync`, {
    method: "POST",
  });

export const fetchGithubProjectMeta = (projectNodeId: string) =>
  api<{
    id: string;
    title: string;
    url: string;
    statusOptions: Array<{ id: string; name: string }>;
    statusFieldId: string | null;
    defaultStatusMap: Record<string, string>;
  }>(
    `/user/github/projects/meta?projectNodeId=${encodeURIComponent(projectNodeId)}`
  );

export const updateUserBoardStatusMap = (
  boardId: string,
  statusMap: Record<string, string>
) =>
  api<{ project: UserTaskBoard }>(
    `/user/projects/${encodeURIComponent(boardId)}/github/status-map`,
    { method: "POST", body: JSON.stringify({ statusMap }) }
  );

export const fetchGithubIntegrationStatus = () =>
  api<{ connected: boolean; login: string | null; configured: boolean }>(
    "/integrations/github/status"
  );

export const startGithubIntegrationConnect = () =>
  api<{ url: string }>("/integrations/github/connect", { method: "POST" });

export const disconnectGithubIntegration = () =>
  api<{ ok: boolean }>("/integrations/github/disconnect", { method: "POST" });

export const createUserProjectCard = (body: {
  columnId?: string;
  title: string;
  description?: string;
  prompt?: string;
  contextJson?: unknown;
  tags?: string;
  dueAt?: string;
  priority?: number;
  parentCardId?: string;
  status?: string;
  assignedAgentId?: string;
  projectId?: string;
}) =>
  createDto<AiProjectCard>("TaskCard", {
    column_id: body.columnId,
    title: body.title,
    description: body.description,
    prompt: body.prompt,
    context_json: body.contextJson,
    tags_json: body.tags,
    due_at: body.dueAt,
    priority: body.priority,
    parent_card_id: body.parentCardId,
    status: body.status,
    assigned_agent_id: body.assignedAgentId,
    project_id: body.projectId,
  });

export const moveUserProjectCard = (id: string, columnId: string, sortOrder?: number) =>
  actionDto<RecordRowClient>(
    "TaskCard",
    "move",
    { column_id: columnId, sort_order: sortOrder },
    id
  ).then(rowDto<AiProjectCard>);

export const updateUserProjectCard = (
  id: string,
  patch: {
    title?: string;
    description?: string;
    prompt?: string;
    contextJson?: unknown;
    tags?: string;
    dueAt?: string;
    columnId?: string;
    sortOrder?: number;
    priority?: number;
    parentCardId?: string | null;
    status?: string;
    assignedAgentId?: string | null;
  }
) =>
  updateProjectCard(id, patch);

export const deleteUserProjectCard = (id: string) =>
  deleteDto("TaskCard", id);

export const fetchUserCardSubtasks = (id: string, userId?: string) => {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return api<AiCardSubtasks>(`/user/projects/cards/${id}/subtasks${q}`);
};

export const fetchUserCardComments = (id: string, userId?: string) => {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return api<{ comments: AiCardComment[] }>(`/user/projects/cards/${id}/comments${q}`);
};

export const addUserCardComment = (
  id: string,
  body: string,
  author: "user" | "agent" = "user",
  userId?: string
) => {
  void userId;
  return addCardComment(id, body, author);
};

export function slugifyStructureId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function isValidStructureSlug(s: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(s);
}

export async function createStructureDepartment(body: {
  id: string;
  label: string;
  icon?: string;
}) {
  return createDto<{ id: string; label: string; icon: string }>("StructureNode", {
    id: body.id,
    parent_id: null,
    label: body.label,
    icon: body.icon,
    kind: "department",
  });
}

export async function updateStructureDepartment(
  id: string,
  patch: { label?: string; icon?: string }
) {
  await updateRecordApi("StructureNode", id, patch);
  return { ok: true };
}

export async function deleteStructureDepartment(id: string) {
  return deleteDto("StructureNode", id);
}

export async function createStructureDivision(
  departmentId: string,
  body: { id: string; label: string; icon?: string; rightSidebar?: string | null }
) {
  return createDto<{ id: string }>("StructureNode", {
    id: body.id,
    parent_id: departmentId,
    label: body.label,
    icon: body.icon,
    kind: "division",
    right_sidebar: body.rightSidebar,
  });
}

export async function updateStructureDivision(
  departmentId: string,
  divisionId: string,
  patch: { label?: string; icon?: string; rightSidebar?: string | null }
) {
  await updateRecordApi("StructureNode", `${departmentId}-${divisionId}`, {
    label: patch.label,
    icon: patch.icon,
    right_sidebar: patch.rightSidebar,
  });
  return { ok: true };
}

export async function deleteStructureDivision(departmentId: string, divisionId: string) {
  return deleteDto("StructureNode", `${departmentId}-${divisionId}`);
}

export async function createStructurePage(
  departmentId: string,
  divisionId: string,
  body: { id: string; label: string; icon?: string; segment?: string }
) {
  return createDto<{ id: string }>("StructureNode", {
    id: body.id,
    parent_id: `${departmentId}-${divisionId}`,
    label: body.label,
    icon: body.icon,
    segment: body.segment,
    kind: "page",
  });
}

export async function updateStructurePage(
  departmentId: string,
  divisionId: string,
  pageId: string,
  patch: { label?: string; icon?: string; segment?: string }
) {
  await updateRecordApi(
    "StructureNode",
    `${departmentId}-${divisionId}-${pageId}`,
    patch
  );
  return { ok: true };
}

export async function deleteStructurePage(
  departmentId: string,
  divisionId: string,
  pageId: string
) {
  return deleteDto("StructureNode", `${departmentId}-${divisionId}-${pageId}`);
}

/* --------------------- Flattened structure node helpers --------------------- */

export interface StructureNodeDto {
  id: string;
  parentId: string | null;
  label: string;
  icon: string;
  segment: string;
  path: string;
  kind: string;
  objectType: string | null;
  rightSidebar: string | null;
  agentId: string | null;
  builtIn: boolean;
  sortOrder: number;
  children: StructureNodeDto[];
}

export async function createStructureNode(body: {
  id: string;
  parentId?: string | null;
  label: string;
  icon?: string;
  segment?: string;
  kind?: string;
  rightSidebar?: string | null;
  objectType?: string | null;
}) {
  const row = await createRecordApi("StructureNode", {
    id: body.id,
    parent_id: body.parentId ?? null,
    label: body.label,
    icon: body.icon ?? "folder",
    segment: body.segment,
    kind: body.kind,
    right_sidebar: body.rightSidebar,
    object_type: body.objectType,
  });
  return {
    id: row.id,
    parentId: (row.data.parent_id as string | null) ?? null,
    label: String(row.data.label ?? ""),
    icon: String(row.data.icon ?? "folder"),
    segment: String(row.data.segment ?? ""),
    path: String(row.data.path ?? ""),
    kind: String(row.data.kind ?? "placeholder"),
    objectType: (row.data.object_type as string | null) ?? null,
    rightSidebar: (row.data.right_sidebar as string | null) ?? null,
    agentId: (row.data.agent_id as string | null) ?? null,
    builtIn: Boolean(row.data.built_in),
    sortOrder: Number(row.data.sort_order ?? 0),
    children: [],
  } satisfies StructureNodeDto;
}

export async function updateStructureNode(
  id: string,
  patch: {
    label?: string;
    icon?: string;
    segment?: string;
    kind?: string;
    rightSidebar?: string | null;
    parentId?: string | null;
    objectType?: string | null;
  }
) {
  return updateRecordApi("StructureNode", id, {
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    ...(patch.segment !== undefined ? { segment: patch.segment } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.rightSidebar !== undefined
      ? { right_sidebar: patch.rightSidebar }
      : {}),
    ...(patch.parentId !== undefined ? { parent_id: patch.parentId } : {}),
    ...(patch.objectType !== undefined
      ? { object_type: patch.objectType }
      : {}),
  });
}

export async function deleteStructureNode(id: string) {
  return deleteDto("StructureNode", id);
}

/** Move a node under a new parent (or to top-level with `null`). */
export async function reparentStructureNode(id: string, parentId: string | null) {
  return updateStructureNode(id, { parentId });
}

export async function reorderStructureNodes(
  parentId: string | null,
  orderedIds: string[]
) {
  return actionDto<{ ok: boolean }>("StructureNode", "reorder", {
    parent_id: parentId,
    ordered_ids: orderedIds,
  });
}

export interface StructureGraphLayoutDto {
  version: number;
  viewport?: { x: number; y: number; zoom: number };
  positions: Record<string, { x: number; y: number }>;
  collapsed: string[];
}

export async function fetchStructureGraph() {
  return api<{
    tree: { nodes: StructureNodeDto[] };
    layout: StructureGraphLayoutDto | null;
  }>("/structure/graph");
}

export async function saveStructureGraphLayout(layout: StructureGraphLayoutDto) {
  return actionDto<{ ok: boolean }>("StructureNode", "save_layout", { layout });
}

/** Attach (or detach with `null`) an agent on a structure node. */
export async function setNodeAgent(nodeId: string, agentId: string | null) {
  return actionDto<{ ok: boolean }>("StructureNode", "set_agent", {
    agent_id: agentId,
  }, nodeId);
}

export function connectWebSocket(onMessage: (data: unknown) => void): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const tenantId = getActiveTenantId();
  const params = new URLSearchParams();
  if (tenantId) params.set("tenantId", tenantId);
  const sessionToken = allowSessionTokenFallback ? readSessionToken() : null;
  if (sessionToken) params.set("session", sessionToken);
  const qs = params.size ? `?${params.toString()}` : "";
  const ws = new WebSocket(`${protocol}//${host}/ws${qs}`);

  ws.onopen = () => {
    const tenantId = getActiveTenantId();
    if (tenantId) {
      ws.send(JSON.stringify({ type: "join_room", room: `tenant:${tenantId}` }));
    }
  };

  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };

  return () => ws.close();
}

export interface StorageUsageEntry {
  id: string;
  label: string;
  path: string;
  bytes: number;
  bytesLabel: string;
  kind: string;
  detail?: string;
}

export interface StorageUsageReport {
  entries: StorageUsageEntry[];
  totalBytes: number;
  totalBytesLabel: string;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  diskFreeBytesLabel: string | null;
  diskTotalBytesLabel: string | null;
  largestTables: Array<{ name: string; bytes: number; rows: number }>;
  parquetDatasets: Array<{ dataset: string; bytes: number; files: number }>;
}

export function fetchStorageUsage() {
  return api<StorageUsageReport>("/storage/usage");
}

/* ----------------------------- Auth & tenants ----------------------------- */

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  emailVerified?: boolean;
  mfaEnabled?: boolean;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  is_operator: number;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user?: AuthUser;
  tenantId?: string;
  tenantRole?: string;
}

export function fetchAuthSession() {
  return api<AuthSessionResponse>("/auth/session");
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  tenants: TenantSummary[];
}

export function loginPassword(email: string, password: string) {
  return api<{
    user: AuthUser;
    sessionToken?: string;
    mfaRequired?: boolean;
    mfaToken?: string;
    mfaSetupRequired?: boolean;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }).then((res) => {
    if (res.mfaRequired) return res;
    if (allowSessionTokenFallback && res.sessionToken) {
      clearActiveTenant();
      writeSessionToken(res.sessionToken);
    }
    return res;
  });
}

export function verifyMfaLogin(mfaToken: string, code: string) {
  return api<{ user: AuthUser; sessionToken?: string }>("/auth/mfa/verify-login", {
    method: "POST",
    body: JSON.stringify({ mfaToken, code }),
  }).then((res) => {
    if (allowSessionTokenFallback && res.sessionToken) {
      clearActiveTenant();
      writeSessionToken(res.sessionToken);
    }
    return res;
  });
}

export function requestEmailVerification(email: string) {
  return api<{ ok: boolean }>("/auth/request-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyEmailToken(token: string) {
  return api<{ ok: boolean }>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function forgotPassword(email: string) {
  return api<{ ok: boolean }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, newPassword: string) {
  return api<{ ok: boolean }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

export function fetchMfaStatus() {
  return api<{ enabled: boolean; required: boolean }>("/auth/mfa/status");
}

export function beginMfaEnroll() {
  return api<{
    secretBase32: string;
    otpauthUrl: string;
    recoveryCodes: string[];
  }>("/auth/mfa/begin", { method: "POST", body: "{}" });
}

export function confirmMfaEnroll(code: string) {
  return api<{ ok: boolean }>("/auth/mfa/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function disableMfa(code: string) {
  return api<{ ok: boolean }>("/auth/mfa/disable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function fetchOauthProviders() {
  return api<{ google: boolean; github: boolean }>("/auth/oauth/providers");
}

export function startOauth(provider: "google" | "github") {
  return api<{ url: string }>(`/auth/oauth/${provider}/start`);
}

export function fetchAdminMarketplaceFees() {
  return api<{
    orders: Array<{
      id: string;
      amountCents: number;
      platformFeeCents: number;
      status: string;
      provider: string;
      sellerUserId: string | null;
      createdAt: string;
      deliveredAt: string | null;
    }>;
    totals: {
      paidCount: number;
      deliveredCount: number;
      amountCents: number;
      platformFeeCents: number;
    };
  }>("/admin/marketplace/fees");
}

export type AdminRequestLogRow = {
  id: string;
  level: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string | null;
  userId: string | null;
  error: string | null;
  createdAt: string;
};

export function fetchAdminObservabilityRequests(opts?: {
  limit?: number;
  level?: "warn" | "error" | "all";
}) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.level && opts.level !== "all") params.set("level", opts.level);
  const q = params.toString();
  return api<{ requests: AdminRequestLogRow[] }>(
    `/admin/observability/requests${q ? `?${q}` : ""}`
  );
}

export function fetchAdminBackupStatus() {
  return api<{
    backup: {
      status: string;
      localPath: string | null;
      remoteUri: string | null;
      error: string | null;
      updatedAt: string;
    } | null;
  }>("/admin/marketplace/backup-status");
}

export function triggerAdminPlatformBackup() {
  return api<{
    backup: {
      status: string;
      localPath: string | null;
      remoteUri: string | null;
      error: string | null;
      updatedAt: string;
    };
  }>("/admin/marketplace/backup", { method: "POST", body: "{}" });
}


export function signupPassword(
  email: string,
  password: string,
  name: string,
  opts?: { inviteCode?: string; checkoutSessionId?: string }
) {
  return api<{ user: AuthUser; sessionToken?: string }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      name,
      ...(opts?.inviteCode ? { inviteCode: opts.inviteCode } : {}),
      ...(opts?.checkoutSessionId
        ? { checkoutSessionId: opts.checkoutSessionId }
        : {}),
    }),
  }).then((res) => {
    if (allowSessionTokenFallback && res.sessionToken) {
      clearActiveTenant();
      writeSessionToken(res.sessionToken);
    }
    return res;
  });
}

export function fetchUsers() {
  return api<{ users: AdminUserRow[] }>("/admin/users");
}

export interface AdminCreateUserInput {
  email: string;
  password: string;
  displayName?: string;
  isAdmin?: boolean;
  provisionDefaultTenant?: boolean;
}

export interface AdminUpdateUserInput {
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  password?: string;
}

export function createAdminUser(input: AdminCreateUserInput) {
  return actionDto<RecordRowClient>(
    "User",
    "create_account",
    {
      email: input.email,
      password: input.password,
      display_name: input.displayName,
      is_admin: input.isAdmin,
    },
    undefined,
    true
  ).then(async (row) => {
    const { users } = await fetchUsers();
    const user = users.find((candidate) => candidate.id === row.id);
    if (!user) {
      throw new ApiError(404, "Created user was not returned by admin list");
    }
    return { user };
  });
}

export async function updateAdminUser(
  userId: string,
  input: AdminUpdateUserInput
) {
  await updateDto("User", userId, {
    email: input.email,
    display_name: input.displayName,
    is_admin: input.isAdmin,
  });
  if (input.password) {
    if (input.password.length < 6) {
      throw new ApiError(400, "password must be at least 6 characters");
    }
    await actionDto(
      "User",
      "reset_password",
      { new_password: input.password },
      userId,
      true
    );
  }
  const { users } = await fetchUsers();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    throw new ApiError(404, "Updated user was not returned by admin list");
  }
  return { user };
}

export function deleteAdminUser(userId: string) {
  return deleteDto("User", userId);
}

export function createAdminTenantForUser(
  userId: string,
  name: string,
  slug?: string
) {
  return createDto<{ id: string; name: string; slug: string }>("Tenant", {
    name,
    slug,
    owner_user_id: userId,
  }).then(async (tenant) => {
    const { users } = await fetchUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new ApiError(404, "Tenant owner was not returned after provisioning");
    }
    return { tenant, user };
  });
}

export function updateAdminTenant(
  tenantId: string,
  input: { name?: string; slug?: string }
) {
  return updateDto<{ id: string; name: string; slug: string; isOperator: boolean }>(
    "Tenant",
    tenantId,
    input
  ).then((tenant) => ({ tenant }));
}

export function deleteAdminTenant(tenantId: string) {
  return deleteDto("Tenant", tenantId);
}

export function fetchAuthTenants() {
  return api<{ tenants: TenantSummary[]; operatorTenantId: string }>("/auth/tenants");
}

export function createAuthTenant(name: string, slug?: string) {
  return createDto<{ id: string; slug: string }>("Tenant", { name, slug });
}

export function logoutAuth() {
  return api<{ ok: boolean }>("/auth/logout", { method: "POST" }).finally(() => {
    clearSessionToken();
    clearActiveTenant();
  });
}

export function changePasswordAuth(currentPassword: string, newPassword: string) {
  return api<{ ok: boolean }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  pronouns: string | null;
  location: string | null;
  timezone: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  website: string | null;
  twitter: string | null;
  github: string | null;
  linkedin: string | null;
  emoji: string | null;
  birthday: string | null;
  languages: string | null;
  interests: string | null;
  values: string | null;
  goals: string | null;
  personalityNotes: string | null;
  decisionStyle: string | null;
  riskTolerance: string | null;
}

export type UserProfileUpdate = Partial<Omit<UserProfile, "id" | "email">>;

export function fetchProfile() {
  return api<{ profile: UserProfile }>("/auth/profile");
}

export function updateProfile(patch: UserProfileUpdate) {
  return fetchProfile().then(({ profile: current }) =>
    updateDto<UserProfile>("UserProfile", current.id, {
      display_name: patch.displayName,
      avatar_url: patch.avatarUrl,
      headline: patch.headline,
      bio: patch.bio,
      pronouns: patch.pronouns,
      location: patch.location,
      timezone: patch.timezone,
      phone: patch.phone,
      company: patch.company,
      job_title: patch.jobTitle,
      website: patch.website,
      twitter: patch.twitter,
      github: patch.github,
      linkedin: patch.linkedin,
      emoji: patch.emoji,
      birthday: patch.birthday,
      languages: patch.languages,
      interests: patch.interests,
      values: patch.values,
      goals: patch.goals,
      personality_notes: patch.personalityNotes,
      decision_style: patch.decisionStyle,
      risk_tolerance: patch.riskTolerance,
    }).then((profile) => ({ profile }))
  );
}

/* --------------------------- Bridge connections --------------------------- */

export interface BridgeConnection {
  id: string;
  owner_tenant_id: string;
  owner_user_id: string;
  label: string;
  mode: "local" | "remote";
  remote_bridge_url: string | null;
  remote_bridge_token: string | null;
  status: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export function fetchBridgeConnections() {
  return api<{ connections: BridgeConnection[] }>("/connections");
}

export function createBridgeConnection(input: {
  label: string;
  mode: "local" | "remote";
  remoteBridgeUrl?: string;
  remoteBridgeToken?: string;
}) {
  return actionDto<RecordRowClient>("BridgeConnection", "register", {
    label: input.label,
    mode: input.mode,
    remote_bridge_url: input.remoteBridgeUrl,
    remote_bridge_token: input.remoteBridgeToken,
  }, undefined, true).then((row) => ({ connection: rowDto<BridgeConnection>(row) }));
}

export function deleteBridgeConnection(id: string) {
  return deleteDto("BridgeConnection", id);
}

/* ----------------------------- Marketplace ----------------------------- */

export interface MarketplaceListing {
  id: string;
  seller_user_id: string;
  seller_tenant_id: string;
  kind: string;
  resource_id: string;
  title: string;
  description: string | null;
  price_credits: number;
  price_cents?: number;
  currency?: string;
  seller_kind?: string;
  visibility: string;
  status: string;
  delivery_mode?: string;
  pricing_model?: string;
  price_period?: string | null;
  meter_unit?: string | null;
  meter_rate?: number | null;
  license?: string | null;
  inference_endpoint_id?: string | null;
  catalog_entry_id?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface MarketplaceEntitlement {
  id: string;
  listing_id: string;
  listing_title?: string;
  buyer_user_id: string;
  kind: string;
  resource_kind: string;
  resource_id: string;
  pricing_model: string;
  delivery_mode?: string;
  status: string;
  expires_at: string | null;
  price_credits?: number;
  created_at: string;
}

export interface InferenceEndpoint {
  id: string;
  name: string;
  base_model_path: string;
  adapter_ids_json: string;
  meter_unit: string;
  meter_rate: number;
  capacity_hint: number;
  status: string;
  created_at: string;
}

export function fetchMarketplaceListings(params?: {
  q?: string;
  kind?: string;
  sellerKind?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.kind) qs.set("kind", params.kind);
  if (params?.sellerKind) qs.set("seller_kind", params.sellerKind);
  const suffix = qs.toString() ? `?${qs}` : "";
  return api<{ listings: MarketplaceListing[] }>(`/marketplace/listings${suffix}`);
}

export interface CatalogEntry {
  id: string;
  kind: string;
  installType: "clone" | "plugin";
  title: string;
  description: string;
  version: string;
  author: string;
  tags?: string[];
  sourceCatalog?: string;
  sourceName?: string;
  priceCents?: number;
  currency?: string;
  listingId?: string;
}

export interface DiscoveredPlugin {
  id: string;
  version: string;
  name: string;
  pluginRoot: string;
  loaded: boolean;
  installed: boolean;
  source: "env" | "marketplace";
}

export interface TenantPluginRow {
  plugin_id: string;
  version: string;
  installed_at: string;
  plugin_root?: string | null;
}

export function fetchOfficialCatalog() {
  return api<{ catalogUrl: string; entries: CatalogEntry[] }>("/marketplace/catalog/official");
}

export function fetchUnofficialCatalog() {
  return api<{
    sources: Array<{ id: string; name: string; url: string; created_at: string }>;
    entries: CatalogEntry[];
    discovered: DiscoveredPlugin[];
    localPaths: string[];
  }>("/marketplace/catalog/unofficial");
}

export function addCatalogSource(name: string, url: string) {
  return actionDto<{ id: string }>("CatalogSource", "add", { name, url });
}

export function removeCatalogSource(id: string) {
  return actionDto<{ ok: boolean }>("CatalogSource", "remove", {}, id, true);
}

export function installCatalogEntry(entryId: string, sourceCatalog?: string) {
  return actionDto<Record<string, unknown>>(
    "CatalogInstall",
    "install_entry",
    { entry_id: entryId, source_catalog: sourceCatalog },
    undefined,
    true
  );
}

export function fetchInstalledCatalog() {
  return api<{
    catalogInstalls: Array<Record<string, unknown>>;
    plugins: TenantPluginRow[];
    available: DiscoveredPlugin[];
    discovered: DiscoveredPlugin[];
  }>("/marketplace/catalog/installed");
}

export function registerLocalPlugin(path: string) {
  return actionDto<{
    pluginId: string;
    pluginRoot: string;
    name: string;
    version: string;
    installed: boolean;
    built: boolean;
  }>("CatalogInstall", "register_local_plugin", { path }, undefined, true);
}

export function removeLocalPlugin(path: string) {
  return actionDto<{ ok: boolean }>(
    "CatalogInstall",
    "unregister_local_plugin",
    { path },
    undefined,
    true
  );
}

export function installWorkspacePlugin(pluginId: string) {
  return actionDto<{ ok: boolean; pluginId: string }>(
    "CatalogInstall",
    "install_plugin",
    { plugin_id: pluginId },
    undefined,
    true
  );
}

export function uninstallWorkspacePlugin(pluginId: string) {
  return actionDto<{ ok: boolean; pluginId: string }>(
    "CatalogInstall",
    "uninstall_plugin",
    { plugin_id: pluginId },
    undefined,
    true
  );
}

export function fetchNetworkStatus() {
  return api<Record<string, unknown>>("/network/status");
}

export function enableTailscaleFederation() {
  return actionDto<{
    federationUrl: string | null;
    error?: string;
  }>("PeerConnection", "enable_tailscale", {}, undefined, true);
}

export function fetchNetworkPeers() {
  return api<{ peers: Array<Record<string, unknown>> }>("/network/peers");
}

export function inviteNetworkPeer(email: string, remoteBridgeUrl?: string) {
  return actionDto<{ inviteId: string }>("PeerConnection", "invite", {
    email,
    remote_bridge_url: remoteBridgeUrl,
  }, undefined, true);
}

export function refreshNetworkPeers() {
  return actionDto<{ peers: Array<Record<string, unknown>> }>(
    "PeerConnection",
    "refresh_health",
    {}
  );
}

export function acceptFederatedShareInvite(inviteToken: string, ownerBridgeUrl: string) {
  void ownerBridgeUrl;
  return actionDto<Record<string, unknown>>(
    "FederatedShareInvite",
    "accept",
    { invite_token: inviteToken },
    undefined,
    true
  );
}

export function fetchBridgeHealth() {
  return api<{
    ok: boolean;
    hub: boolean;
    deploymentMode: string;
    client?: boolean;
    saas?: boolean;
    installationSurface?: string;
  }>("/health");
}

export function fetchSaasPaywall() {
  return api<{
    enabled: boolean;
    paymentsConfigured: boolean;
    priceConfigured: boolean;
    publishableKey: string | null;
    checkoutMode: "payment" | "subscription";
    plans: Array<{
      id: string;
      priceId: string;
      label: string;
      amountLabel: string;
      interval: "month" | "year" | "one_time";
    }>;
  }>("/saas/paywall");
}

export function startSaasCheckout(input?: {
  email?: string;
  plan?: string;
  successUrl?: string;
  cancelUrl?: string;
}) {
  return api<{ url: string; sessionId: string; planId: string; priceId: string }>(
    "/saas/checkout",
    {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }
  );
}

export function fetchSaasCheckoutStatus(sessionId: string) {
  return api<{
    paid: boolean;
    email: string | null;
    status: string;
    sessionId: string;
  }>(`/saas/checkout/status?session_id=${encodeURIComponent(sessionId)}`);
}

export type SaasSubscriptionPublic = {
  planId: string | null;
  planLabel: string | null;
  amountLabel: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
};

export function fetchSaasSubscription() {
  return api<{ subscription: SaasSubscriptionPublic | null }>("/saas/subscription");
}

export function startSaasBillingPortal(input?: { returnUrl?: string }) {
  return api<{ url: string }>("/saas/portal", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

export type AdminSaasCustomerRow = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  isAdmin: boolean;
  accessDisabled: boolean;
  lastSeenAt: string | null;
  planId: string | null;
  planLabel: string | null;
  amountLabel: string | null;
  priceId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  accessRevoked: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeDashboardUrl: string | null;
  createdAt: string | null;
};

export function fetchAdminSaasCustomers() {
  return api<{ customers: AdminSaasCustomerRow[] }>("/admin/saas/customers");
}

export function setAdminSaasCustomerAccess(userId: string, disabled: boolean) {
  return api<{ userId: string; accessDisabled: boolean }>(
    `/admin/saas/customers/${encodeURIComponent(userId)}/access`,
    {
      method: "POST",
      body: JSON.stringify({ disabled }),
    }
  );
}

export function fetchOnboardingStatus() {
  return api<{
    completed: boolean;
    llmReady: boolean;
    llmStatus: Record<string, unknown>;
  }>("/onboarding/status");
}

export function fetchOnboardingDetect() {
  return api<{
    ollama: { available: boolean; models: string[] };
    localModels: string[];
  }>("/onboarding/detect");
}

export function startOnboardingLocalLlm(modelPath: string) {
  return actionDto(
    "ModelRuntime",
    "select_model",
    { model_id: `local:${modelPath}` },
    "runtime",
    true
  ).then(() => ({ ok: true }));
}

export function markOnboardingCloudReady() {
  return actionDto<RecordRowClient>(
    "TenantOnboardingConfig",
    "mark_llm_ready",
    {},
    getActiveTenantId() ?? undefined
  ).then(() => ({ ok: true }));
}

export function completeOnboarding() {
  return actionDto<RecordRowClient>(
    "TenantOnboardingConfig",
    "complete",
    {},
    getActiveTenantId() ?? undefined
  ).then(() => ({ ok: true }));
}

export function fetchMarketplaceWallet() {
  return api<{
    balance: number;
    ledger: Array<Record<string, unknown>>;
  }>("/marketplace/wallet");
}

export interface MarketplaceBillingConfig {
  publishableKey: string | null;
  creditsPerUsd: number;
  paymentsEnabled: boolean;
}

export function fetchMarketplaceBillingConfig() {
  return api<MarketplaceBillingConfig>("/marketplace/billing/config");
}

export interface PlatformBillingConfig {
  configured: boolean;
  publishableKey: string | null;
  creditsPerUsd: number;
  hasSecretKey: boolean;
}

export function fetchAdminBillingConfig() {
  return api<PlatformBillingConfig>("/admin/billing");
}

export function updateAdminBillingConfig(body: {
  secretKey?: string;
  publishableKey?: string;
  creditsPerUsd?: number;
}) {
  return actionDto<RecordRowClient>(
    "PlatformBillingConfig",
    "configure",
    {
      secret_key: body.secretKey,
      publishable_key: body.publishableKey,
      credits_per_usd: body.creditsPerUsd,
    },
    "platform-billing",
    true
  ).then(rowDto<PlatformBillingConfig>);
}

export function testAdminBillingConnection() {
  return actionDto<{ ok: boolean; detail?: string }>(
    "PlatformBillingConfig",
    "test_connection",
    {},
    "platform-billing",
    true
  );
}

export interface WorkspaceTemplateNode {
  id: string;
  label: string;
  icon: string;
  segment?: string;
  kind: string;
  children?: WorkspaceTemplateNode[];
}

export function fetchAdminWorkspaceTemplate() {
  return api<{
    structure: WorkspaceTemplateNode | null;
    sidebarPages: string[];
    agents: Array<{ id: string; label: string; note: string }>;
    welcomeWiki: { slug: string; title: string; space: string };
    bootstrapNote: string;
    editable: boolean;
    source: string;
  }>("/admin/workspace-template");
}

export function createMarketplaceListing(body: {
  kind: string;
  resourceId?: string;
  title?: string;
  description?: string;
  priceCredits?: number;
  priceCents?: number;
  currency?: string;
  sellerKind?: "official" | "user";
  deliveryMode?: "clone" | "live";
  pricingModel?: "one_time" | "subscription" | "metered";
  pricePeriod?: string;
  meterUnit?: string;
  meterRate?: number;
  license?: string;
  inferenceEndpointId?: string;
  bundleChildren?: unknown[];
}) {
  return actionDto<{ id: string }>("MarketplaceListing", "publish", {
    kind: body.kind,
    resource_id: body.resourceId,
    title: body.title,
    description: body.description,
    price_credits: body.priceCredits,
    price_cents: body.priceCents,
    currency: body.currency,
    seller_kind: body.sellerKind,
    delivery_mode: body.deliveryMode,
    pricing_model: body.pricingModel,
    price_period: body.pricePeriod,
    meter_unit: body.meterUnit,
    meter_rate: body.meterRate,
    license: body.license,
    inference_endpoint_id: body.inferenceEndpointId,
    bundle_children: body.bundleChildren,
  }, undefined, true);
}

export function acceptMarketplaceTos() {
  return actionDto<{ tosVersion: string; acceptedAt: string }>(
    "MarketplaceSellerAccount",
    "accept_tos",
    {},
    undefined,
    true
  );
}

export function connectMarketplacePayout(body: {
  stripeConnectAccountId?: string | null;
  paypalMerchantId?: string | null;
  metamaskAddress?: string | null;
  payoutPreference?: "stripe" | "paypal" | "crypto";
}) {
  return actionDto<Record<string, unknown>>(
    "MarketplaceSellerAccount",
    "connect_payout",
    {
      stripe_connect_account_id: body.stripeConnectAccountId,
      paypal_merchant_id: body.paypalMerchantId,
      metamask_address: body.metamaskAddress,
      payout_preference: body.payoutPreference,
    },
    undefined,
    true
  );
}

export function fetchMarketplaceCommerceConfig() {
  return actionDto<{
    tosVersion: string;
    platformFeeBps: number;
    providers: { stripe: boolean; paypal: boolean; crypto: boolean };
    cryptoTreasuryAddress: string | null;
    cryptoChainId: number;
    cryptoAsset: string;
  }>("MarketplaceSellerAccount", "commerce_config", {});
}

export function startMarketplaceCheckout(body: {
  provider: "stripe" | "paypal" | "crypto";
  listingId?: string;
  catalogEntryId?: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return actionDto<{
    order: { id: string; status: string };
    checkout: {
      provider: string;
      url?: string;
      sessionId?: string;
      paypalOrderId?: string;
      crypto?: {
        treasuryAddress: string;
        chainId: number;
        asset: string;
        amountCents: number;
        orderId: string;
        memo: string;
      };
    };
  }>(
    "MarketplaceOrder",
    "start_checkout",
    {
      provider: body.provider,
      listing_id: body.listingId,
      catalog_entry_id: body.catalogEntryId,
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
    },
    undefined,
    true
  );
}

export function confirmMarketplaceCryptoPayment(orderId: string, txHash: string) {
  return actionDto<Record<string, unknown>>(
    "MarketplaceOrder",
    "confirm_crypto",
    { tx_hash: txHash },
    orderId,
    true
  );
}

export function fetchMyMarketplaceListings() {
  return api<{ listings: MarketplaceListing[] }>("/marketplace/my/listings");
}

export function archiveMarketplaceListing(listingId: string) {
  return actionDto<{ id: string; status: string }>(
    "MarketplaceListing",
    "archive",
    {},
    listingId,
    true
  );
}

export function fetchMarketplaceEntitlements() {
  return api<{ entitlements: MarketplaceEntitlement[] }>("/marketplace/entitlements");
}

export function cancelMarketplaceEntitlement(entitlementId: string) {
  return actionDto<{ ok: boolean }>(
    "MarketplaceEntitlement",
    "cancel",
    {},
    entitlementId,
    true
  );
}

export function fetchInferenceEndpoints() {
  return api<{ endpoints: InferenceEndpoint[] }>("/marketplace/inference/endpoints");
}

export function createInferenceEndpoint(body: {
  name: string;
  baseModelPath: string;
  adapterIds?: string[];
  meterUnit?: string;
  meterRate?: number;
  capacityHint?: number;
}) {
  return actionDto<{ id: string }>("InferenceEndpoint", "publish", {
    name: body.name,
    base_model_path: body.baseModelPath,
    adapter_ids_json: body.adapterIds,
    meter_unit: body.meterUnit,
    meter_rate: body.meterRate,
    capacity_hint: body.capacityHint,
  }, undefined, true);
}

export function acquireMarketplaceListing(listingId: string) {
  return actionDto<{
    ok: boolean;
    mode: "clone" | "live";
    import?: { kind: string; newId: string };
    entitlementId?: string;
    shareGrantId?: string;
    balance: number;
  }>("MarketplaceListing", "acquire", {}, listingId, true);
}

export function exportPortableEntity(kind: string, resourceId: string) {
  return actionDto<{ bundle: unknown }>("MarketplaceListing", "export_portable", {
    kind,
    resource_id: resourceId,
  });
}

export function importPortableBundle(bundle: unknown) {
  return actionDto<{ ok: boolean; kind: string; newId: string }>(
    "MarketplaceListing",
    "import_portable",
    { bundle } as Record<string, unknown>,
    undefined,
    true
  );
}

/* ----------------------------- Sharing ----------------------------- */

export interface SharedSidebarDivision {
  grantId: string;
  id: string;
  label: string;
  basePath: string;
  resourceKind: string;
  resourceId: string;
}

export interface SharedSidebarDepartment {
  id: string;
  label: string;
  basePath: string;
  divisions: SharedSidebarDivision[];
}

export interface SharedSidebarOwner {
  ownerUserId: string;
  ownerDisplayName: string;
  departments: SharedSidebarDepartment[];
}

export function fetchShareGrants() {
  return api<{
    grants: Array<Record<string, unknown>>;
    sharedTree: SharedSidebarOwner[];
  }>("/shares/");
}

export function fetchShareGrantsForResource(kind: string, resourceId: string) {
  return api<{ grants: Array<Record<string, unknown>> }>(
    `/shares/resource/${encodeURIComponent(kind)}/${encodeURIComponent(resourceId)}`
  );
}

export function lookupUserByEmail(email: string) {
  const qs = new URLSearchParams({ email });
  return api<{
    user: { id: string; email: string; displayName: string; avatarUrl: string | null; isAdmin: boolean };
  }>(`/auth/users/lookup?${qs}`);
}

export function fetchTenantMembers(tenantId: string) {
  return api<{
    members: Array<{
      id: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
      role: string;
    }>;
  }>(`/auth/tenants/${encodeURIComponent(tenantId)}/members`);
}

export function createShareGrant(body: {
  resourceKind: string;
  resourceId: string;
  granteeUserId?: string;
  granteeTenantId?: string;
  role?: string;
}) {
  return actionDto<{ id: string }>("ShareGrant", "grant", {
    resource_kind: body.resourceKind,
    resource_id: body.resourceId,
    grantee_user_id: body.granteeUserId,
    grantee_tenant_id: body.granteeTenantId,
    role: body.role,
  }, undefined, true);
}

export function revokeShareGrant(grantId: string) {
  return actionDto<{ ok: boolean }>("ShareGrant", "revoke", {}, grantId, true);
}

/** A model shared with the current user for FREE inference. */
export interface SharedModel {
  grantId: string;
  endpointId: string;
  name: string;
  ownerUserId: string;
  ownerDisplayName: string;
  baseModelName: string;
}

/** Share one of my local models with a friend for free inference. */
export function shareModel(body: {
  modelPath: string;
  granteeUserId?: string;
  granteeEmail?: string;
  name?: string;
}) {
  return actionDto<{ id: string; endpointId: string }>(
    "ShareGrant",
    "share_model",
    {
      model_path: body.modelPath,
      grantee_user_id: body.granteeUserId,
      grantee_email: body.granteeEmail,
      name: body.name,
    },
    undefined,
    true
  );
}

/** Models shared WITH me (incoming free `model` grants). */
export function fetchSharedModels() {
  return api<{ models: SharedModel[] }>("/shares/models");
}

export function cloneSharedResource(kind: string, resourceId: string) {
  return actionDto<{ ok: boolean; kind: string; newId: string }>(
    "ShareGrant",
    "clone_shared",
    { kind, resource_id: resourceId },
    undefined,
    true
  );
}

/* ----------------------------- User-to-user DM chat ----------------------------- */

export interface DmUserSummary {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  online: boolean;
}

export interface DmContact extends DmUserSummary {
  relationship: "share" | "tenant" | "lookup";
}

export interface DmAgentSummary {
  id: string;
  tenantId: string;
  name: string;
  icon: string | null;
}

export interface DmConversationMember {
  memberKind: "user" | "agent";
  userId: string | null;
  role: "owner" | "member";
  joinedAt: string;
  lastReadAt: string | null;
  user: DmUserSummary | null;
  agentId: string | null;
  agentTenantId: string | null;
  agent: DmAgentSummary | null;
}

export interface DmConversation {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  members: DmConversationMember[];
  displayTitle: string;
}

export interface DmAttachment {
  id: string;
  kind: "image" | "file" | "resource_ref";
  blobId: string | null;
  href: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  label: string | null;
  mime: string | null;
  size: number | null;
}

export interface DmMessage {
  id: string;
  conversationId: string;
  senderKind: "user" | "agent";
  senderUserId: string | null;
  sender: DmUserSummary | null;
  senderAgentId: string | null;
  senderAgent: DmAgentSummary | null;
  bodyText: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments: DmAttachment[];
}

export interface DmAttachmentInput {
  kind: "image" | "file" | "resource_ref";
  blobId?: string;
  resourceKind?: string;
  resourceId?: string;
  label?: string;
  href?: string;
  mime?: string;
  size?: number;
}

export interface DmBlobUpload {
  id: string;
  filename: string;
  mime: string;
  size: number;
  href: string;
}

export function fetchDmContacts(email?: string) {
  const qs = email ? `?email=${encodeURIComponent(email)}` : "";
  return api<{ contacts: DmContact[] }>(`/dm/contacts${qs}`);
}

export function fetchDmUnread() {
  return api<{ unread: number }>("/dm/unread");
}

export function fetchDmConversations() {
  return api<{ conversations: DmConversation[] }>("/dm/conversations");
}

export function fetchDmConversation(id: string) {
  return api<{ conversation: DmConversation }>(`/dm/conversations/${id}`);
}

export function createDmConversation(body: {
  kind?: "direct" | "group";
  title?: string;
  memberUserIds?: string[];
  memberEmails?: string[];
  memberAgents?: Array<{ agentId: string; agentTenantId?: string }>;
}) {
  return actionDto<RecordRowClient>("DirectConversation", "start", {
    kind: body.kind,
    title: body.title,
    member_user_ids: body.memberUserIds,
  }).then((row) => ({ conversation: rowDto<DmConversation>(row) }));
}

export function fetchDmMessages(
  conversationId: string,
  opts?: { before?: string; limit?: number }
) {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString() ? `?${params}` : "";
  return api<{ messages: DmMessage[] }>(
    `/dm/conversations/${conversationId}/messages${qs}`
  );
}

export function sendDmMessage(
  conversationId: string,
  body: { bodyText?: string; attachments?: DmAttachmentInput[] }
) {
  return actionDto<RecordRowClient>("DirectMessage", "send", {
    conversation_id: conversationId,
    body_text: body.bodyText,
    attachments: body.attachments,
  }).then((row) => ({ message: rowDto<DmMessage>(row) }));
}

export function markDmConversationRead(
  conversationId: string,
  messageId?: string
) {
  return actionDto<{ ok: boolean }>(
    "DirectConversation",
    "mark_read",
    { message_id: messageId },
    conversationId
  );
}

export function addDmConversationMember(
  conversationId: string,
  body: { userId?: string; email?: string }
) {
  return actionDto<{ member: DmConversationMember }>(
    "DirectConversation",
    "add_member",
    { user_id: body.userId },
    conversationId
  );
}

export function removeDmConversationMember(
  conversationId: string,
  userId: string
) {
  return actionDto<{ ok: boolean }>(
    "DirectConversation",
    "remove_member",
    { user_id: userId },
    conversationId,
    true
  );
}

export function shareDmResource(
  conversationId: string,
  body: {
    resourceKind: string;
    resourceId: string;
    role?: "viewer" | "editor" | "owner";
  }
) {
  return actionDto<{
    grants: Array<{ granteeUserId: string; grantId: string }>;
  }>("DirectConversation", "share", {
    resource_kind: body.resourceKind,
    resource_id: body.resourceId,
    role: body.role,
  }, conversationId, true);
}

export function sendDmTyping(conversationId: string) {
  return api<{ ok: boolean }>(`/dm/conversations/${conversationId}/typing`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function uploadDmFile(file: File): Promise<DmBlobUpload> {
  const form = new FormData();
  form.append("file", file);
  const tenantId = getActiveTenantId();
  const headers = new Headers();
  if (tenantId) headers.set("X-Tenant-Id", tenantId);
  const res = await fetch(`${API_BASE}/dm/uploads`, {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  const data = (await res.json()) as { blob: DmBlobUpload };
  return data.blob;
}

/* ----------------------------- Notifications ----------------------------- */

export interface AppNotification {
  id: string;
  recipient_kind: "user" | "agent";
  recipient_id: string;
  recipient_tenant_id: string | null;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  resource_kind: string | null;
  resource_id: string | null;
  read_at: string | null;
  created_at: string;
}

export function fetchNotifications(opts?: { unreadOnly?: boolean; limit?: number }) {
  const qs = new URLSearchParams();
  if (opts?.unreadOnly) qs.set("unread", "1");
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  return api<{ notifications: AppNotification[]; unreadCount: number }>(
    `/notifications${suffix}`
  );
}

export function fetchNotificationUnreadCount() {
  return api<{ unreadCount: number }>("/notifications/unread-count");
}

export function markNotificationsRead(input: { ids?: string[]; all?: boolean }) {
  if (input.all) {
    return actionDto<{ changed: number }>(
      "Notification",
      "mark_all_read",
      {}
    ).then(({ changed }) => ({ updated: changed, unreadCount: 0 }));
  }
  return Promise.all(
    (input.ids ?? []).map((id) =>
      actionDto("Notification", "mark_read", {}, id)
    )
  ).then((rows) => ({ updated: rows.length, unreadCount: 0 }));
}

export function deleteNotification(id: string) {
  return deleteDto("Notification", id).then(() => ({ ok: true, unreadCount: 0 }));
}

export function clearNotifications(input: { readOnly?: boolean } = {}) {
  return actionDto<{ deleted: number }>("Notification", "clear", {
    read_only: input.readOnly,
  }).then(({ deleted }) => ({ deleted, unreadCount: 0 }));
}

/* ----------------------------- Automations (Hooks) ----------------------------- */

export type HookTriggerKind = "event" | "schedule";
export type HookActionKind =
  | "notify"
  | "run_agent"
  | "run_workflow"
  | "send_message"
  | "webhook";

export interface Hook {
  id: string;
  owner_kind: "user" | "agent";
  owner_id: string;
  owner_tenant_id: string | null;
  name: string;
  enabled: number;
  trigger_kind: HookTriggerKind;
  event_type: string | null;
  schedule_cron: string | null;
  condition_json: string | null;
  action_kind: HookActionKind;
  action_config_json: string | null;
  rate_limit_per_hour: number | null;
  require_approval: number;
  created_at: string;
  updated_at: string;
  last_fired_at: string | null;
}

export interface HookRun {
  id: string;
  hook_id: string;
  event_id: string | null;
  status: "success" | "error" | "skipped" | "pending_approval";
  detail: string | null;
  result_json: string | null;
  created_at: string;
}

export interface AppEvent {
  id: string;
  type: string;
  actor_kind: "user" | "agent" | "system";
  actor_id: string | null;
  tenant_id: string | null;
  payload_json: string | null;
  created_at: string;
}

export interface CreateHookBody {
  ownerKind?: "user" | "agent";
  ownerId?: string;
  name: string;
  enabled?: boolean;
  triggerKind: HookTriggerKind;
  eventType?: string | null;
  scheduleCron?: string | null;
  conditionJson?: string | null;
  actionKind: HookActionKind;
  actionConfigJson?: string | null;
  rateLimitPerHour?: number | null;
  requireApproval?: boolean;
}

export function fetchHooks() {
  return api<{ hooks: Hook[]; agentIds: string[] }>("/hooks/");
}

export function createHook(body: CreateHookBody) {
  return createDto<Hook>("Hook", {
    owner_kind: body.ownerKind,
    owner_id: body.ownerId,
    name: body.name,
    enabled: body.enabled,
    trigger_kind: body.triggerKind,
    event_type: body.eventType,
    schedule_cron: body.scheduleCron,
    condition_json: body.conditionJson,
    action_kind: body.actionKind,
    action_config_json: body.actionConfigJson,
    require_approval: body.requireApproval,
  }).then((hook) => ({ hook }));
}

export function updateHook(id: string, body: Partial<CreateHookBody>) {
  return updateDto<Hook>("Hook", id, {
    owner_kind: body.ownerKind,
    owner_id: body.ownerId,
    name: body.name,
    enabled: body.enabled,
    trigger_kind: body.triggerKind,
    event_type: body.eventType,
    schedule_cron: body.scheduleCron,
    condition_json: body.conditionJson,
    action_kind: body.actionKind,
    action_config_json: body.actionConfigJson,
    require_approval: body.requireApproval,
  }).then((hook) => ({ hook }));
}

export function deleteHook(id: string) {
  return deleteDto("Hook", id);
}

export function fetchHookRuns(id: string) {
  return api<{ runs: HookRun[] }>(`/hooks/${id}/runs`);
}

export function approveHookRun(runId: string) {
  return actionDto<{ ok: boolean }>("HookRun", "approve", {}, runId, true);
}

export function rejectHookRun(runId: string) {
  return actionDto<{ ok: boolean }>("HookRun", "reject", {}, runId, true);
}

export function fetchEvents(limit?: number) {
  const suffix = limit ? `?limit=${limit}` : "";
  return api<{ events: AppEvent[]; eventTypes: string[] }>(`/events/${suffix}`);
}

/* ----------------------------- Support ----------------------------- */

export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface SupportTicket {
  id: string;
  requester_kind: "user" | "agent";
  requester_id: string;
  requester_tenant_id: string | null;
  subject: string;
  body: string;
  category: string | null;
  status: SupportTicketStatus;
  priority: string | null;
  target_kind?: string | null;
  owner_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  author_kind: "user" | "agent" | "admin";
  author_id: string;
  body: string;
  created_at: string;
}

export interface SupportGroupMember {
  group_id: string;
  member_kind: "user" | "agent";
  member_id: string;
  tenant_id: string | null;
  created_at: string;
}

export function createSupportTicket(body: {
  subject: string;
  body: string;
  category?: string | null;
  targetKind?: "platform_github" | "platform_admin" | "resource_owner";
  sharedGrantId?: string | null;
  ownerUserId?: string | null;
}): Promise<{ ticket?: SupportTicket; redirectUrl?: string; kind?: string }> {
  return actionDto<RecordRowClient>("SupportTicket", "open", {
    subject: body.subject,
    body: body.body,
    category: body.category,
  }).then((row) => ({ ticket: rowDto<SupportTicket>(row) }));
}

export function fetchOwnerSupportTickets() {
  return api<{ tickets: SupportTicket[] }>("/support/owner/tickets");
}

export function fetchMySupportTickets() {
  return api<{ tickets: SupportTicket[] }>("/support/tickets");
}

export function fetchStaffSupportTickets(status?: SupportTicketStatus) {
  const suffix = status ? `?status=${status}` : "";
  return api<{ tickets: SupportTicket[] }>(`/support/staff/tickets${suffix}`);
}

export function fetchSupportTicket(id: string) {
  return api<{ ticket: SupportTicket; messages: SupportMessage[] }>(
    `/support/tickets/${id}`
  );
}

export function postSupportMessage(id: string, body: string) {
  return actionDto<RecordRowClient>("SupportMessage", "reply", {
    ticket_id: id,
    body,
  }).then((row) => ({ message: rowDto<SupportMessage>(row) }));
}

export function fetchSupportGroup() {
  return api<{
    group: { id: string; slug: string; name: string; description: string | null };
    members: SupportGroupMember[];
    canManage: boolean;
    isMember: boolean;
  }>("/support/group");
}

export function addSupportGroupMember(body: {
  memberKind: "user" | "agent";
  memberId: string;
  tenantId?: string | null;
}) {
  return actionDto<{ member: SupportGroupMember }>("PlatformGroupMember", "add", {
    group_id: "support",
    member_kind: body.memberKind,
    member_id: body.memberId,
    tenant_id: body.tenantId,
  }, undefined, true);
}

export function removeSupportGroupMember(body: {
  memberKind: "user" | "agent";
  memberId: string;
  tenantId?: string | null;
}) {
  return actionDto<{ ok: boolean }>("PlatformGroupMember", "remove", {
    group_id: "support",
    member_kind: body.memberKind,
    member_id: body.memberId,
    tenant_id: body.tenantId,
  }, undefined, true);
}

export function fetchAdminSupportTickets(status?: SupportTicketStatus) {
  const suffix = status ? `?status=${status}` : "";
  return api<{ tickets: SupportTicket[] }>(`/support/admin/tickets${suffix}`);
}

export function updateAdminSupportTicket(
  id: string,
  body: { status?: SupportTicketStatus; priority?: string | null }
) {
  return actionDto<RecordRowClient>("SupportTicket", "set_status", body, id)
    .then((row) => ({ ticket: rowDto<SupportTicket>(row) }));
}

/* ----------------------------- Wiki ----------------------------- */

export type WikiVisibility = "internal" | "external";

export interface WikiPage {
  id: string;
  tenant_id: string;
  space: string | null;
  slug: string;
  title: string;
  body_markdown: string;
  visibility: WikiVisibility;
  author_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface WikiBacklink {
  id: string;
  slug: string;
  title: string;
}

export function fetchWikiPages(opts?: {
  visibility?: WikiVisibility;
  space?: string;
  q?: string;
}) {
  const qs = new URLSearchParams();
  if (opts?.visibility) qs.set("visibility", opts.visibility);
  if (opts?.space) qs.set("space", opts.space);
  if (opts?.q) qs.set("q", opts.q);
  const suffix = qs.toString() ? `?${qs}` : "";
  return api<{ pages: WikiPage[] }>(`/wiki/pages${suffix}`);
}

export function fetchWikiPage(slug: string) {
  return api<{ page: WikiPage; backlinks: WikiBacklink[] }>(`/wiki/pages/${slug}`);
}

export function createWikiPage(body: {
  title: string;
  bodyMarkdown?: string;
  space?: string | null;
  visibility?: WikiVisibility;
  slug?: string;
}) {
  return createDto<WikiPage>("WikiPage", {
    title: body.title,
    body_markdown: body.bodyMarkdown,
    space: body.space,
    visibility: body.visibility,
    slug: body.slug,
  }).then((page) => ({ page }));
}

export function updateWikiPage(
  id: string,
  body: {
    title?: string;
    bodyMarkdown?: string;
    space?: string | null;
    visibility?: WikiVisibility;
  }
) {
  return updateDto<WikiPage>("WikiPage", id, {
    title: body.title,
    body_markdown: body.bodyMarkdown,
    space: body.space,
    visibility: body.visibility,
  }).then((page) => ({ page }));
}

export function deleteWikiPage(id: string) {
  return deleteDto("WikiPage", id);
}

export interface WikiPageProposal {
  id: string;
  tenant_id: string;
  action: "create" | "update";
  space: string | null;
  slug: string | null;
  title: string;
  body_markdown: string;
  target_page_id: string | null;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export function fetchWikiProposals(status: "pending" | "all" = "pending") {
  return api<{ proposals: WikiPageProposal[] }>(
    `/wiki/proposals?status=${status}`
  );
}

export function approveWikiProposal(id: string) {
  return actionDto<{ ok: boolean; pageId?: string }>(
    "WikiProposal",
    "approve",
    {},
    id,
    true
  );
}

export function rejectWikiProposal(id: string) {
  return actionDto<{ ok: boolean }>("WikiProposal", "reject", {}, id, true);
}
