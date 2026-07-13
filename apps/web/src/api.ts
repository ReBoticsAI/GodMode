import {
  clearActiveTenant,
  clearSessionToken,
  readSessionToken,
  readTenantId,
  writeSessionToken,
  writeTenantId,
} from "./lib/storage-keys";

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
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
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

export interface PlaybookRow {
  id: string;
  name: string;
  version: number;
  status: string;
  spec_json: string;
  updated_at: string;
}

export interface PlaybookSignalRow {
  playbookId: string;
  signalId: string;
  value: number;
  kind: string;
  chart: number | null;
  ts: string | null;
  metadataJson: string | null;
  updatedAt: string;
}

export interface PlaybookZoneRow {
  playbookId: string;
  signalId: string;
  valid: number;
  families: number;
  lo: number;
  hi: number;
  scTs: string | null;
  updatedAt: string;
}

export interface HeartbeatRow {
  playbook_id: string;
  chart_number: number;
  size: number;
  last_seen: string;
  bridge_count: number;
}

export interface ScMarketQuote {
  symbol: string;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  spread?: number | null;
  bid_size?: number | null;
  ask_size?: number | null;
  last_size?: number | null;
  source?: string;
}

export const fetchPlaybooks = () => api<PlaybookRow[]>("/playbooks");
export const fetchPlaybookSignals = (playbookId: string) =>
  api<PlaybookSignalRow[]>(
    `/playbook-signals?playbookId=${encodeURIComponent(playbookId)}`
  );
export const fetchPlaybookZones = (playbookId: string) =>
  api<PlaybookZoneRow[]>(
    `/playbook-zones?playbookId=${encodeURIComponent(playbookId)}`
  );
export const fetchHeartbeats = () => api<HeartbeatRow[]>("/sc/heartbeats");
export const fetchScMarketQuote = (symbol: string) =>
  api<ScMarketQuote | null>(`/sc/market?symbol=${encodeURIComponent(symbol)}`);

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
export const refreshScCharts = () =>
  api<{ ok: boolean; requestId: string }>("/sc-charts/refresh", { method: "POST" });
export const selectBacktestCharts = (charts: number[]) =>
  api<{ ok: boolean; configured: number[] }>("/sc-charts/select", {
    method: "POST",
    body: JSON.stringify({ charts }),
  });

export const fetchBacktests = () => api<BacktestRun[]>("/backtests");
export const fetchBacktestDetail = (id: string) =>
  api<{ run: BacktestRun; trades: BacktestTrade[] }>(`/backtests/${id}`);
export const startBacktest = (body: {
  playbookId: string;
  simOnly?: boolean;
  paramsOverride?: Record<string, unknown>;
  daysToLoad?: number;
  startDate?: string;
  endDate?: string;
  baseline?: boolean;
  chartUpdateIntervalMs?: number;
  useContinuousContract?: boolean;
  replayMode?: ReplayModeOption;
  chartsToReplay?: ChartsToReplayOption;
  processingStepSeconds?: number;
  replaySpeed?: number;
  tradeAccount?: string;
}) =>
  api<{ runId: string; status: string }>("/backtests", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const cancelBacktest = (id: string) =>
  api<{ ok: boolean }>(`/backtests/${id}/cancel`, { method: "POST" });
export const startBacktestSweep = (body: {
  playbookId: string;
  axes: SweepParamAxis[];
}) =>
  api<{ sweepId: string; runIds: string[] }>("/backtests/sweep", {
    method: "POST",
    body: JSON.stringify(body),
  });
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

export const updateStudySettings = (body: {
  playbookId: string;
  settings: Array<{ inputIdx: number; inputName?: string; value: number }>;
}) =>
  api<{ ok: boolean; reloadRequired: boolean }>("/study-settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });

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
  api<{ config: AiPromptFlowConfig; assembled: AiAssembledPrompt }>("/ai/prompt-flow", {
    method: "PUT",
    body: JSON.stringify({ config, agentId }),
  });

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
  api<AiMemory>(`/ai/memories/${id}/approve`, { method: "POST" });

export const createAiMemory = (body: {
  text: string;
  scope?: "global" | "chat";
  chatId?: string;
  category?: string;
  agentId?: string;
}) =>
  api<AiMemory>("/ai/memories", { method: "POST", body: JSON.stringify(body) });

export const updateAiMemory = (
  id: string,
  patch: { text?: string; enabled?: boolean; category?: string }
) =>
  api<AiMemory>(`/ai/memories/${id}`, { method: "PUT", body: JSON.stringify(patch) });

export const deleteAiMemory = (id: string) =>
  api<{ ok: boolean }>(`/ai/memories/${id}`, { method: "DELETE" });

export const fetchAiRules = (agentId?: string) =>
  api<{ rules: AiRule[] }>(
    agentId ? `/ai/rules?agentId=${encodeURIComponent(agentId)}` : "/ai/rules"
  );

export const updateAiRuleState = (
  id: string,
  patch: { enabled?: boolean; priorityOverride?: number | null; agentId?: string }
) =>
  api<{ rules: AiRule[] }>(`/ai/rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const approveAiRule = (id: string, agentId?: string) => {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return api<{ rules: AiRule[] }>(`/ai/rules/${id}/approve${qs}`, { method: "POST" });
};

export const rejectAiRule = (id: string, agentId?: string) => {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return api<{ ok: boolean; rules: AiRule[] }>(`/ai/rules/${id}${qs}`, { method: "DELETE" });
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
) =>
  api<{ skills: AiSkill[] }>(`/ai/skills/${id}`, {
    method: "PUT",
    body: JSON.stringify({ enabled, agentId }),
  });

export const approveAiSkill = (id: string, agentId?: string) => {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return api<{ skills: AiSkill[] }>(`/ai/skills/${id}/approve${qs}`, { method: "POST" });
};

export const rejectAiSkill = (id: string, agentId?: string) => {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return api<{ ok: boolean; skills: AiSkill[] }>(`/ai/skills/${id}${qs}`, { method: "DELETE" });
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
  api<AiArtifact>("/ai/artifacts", { method: "POST", body: JSON.stringify(body) });

export const deleteAiArtifact = (id: string, agentId?: string) =>
  api<{ ok: boolean }>(
    agentId
      ? `/ai/artifacts/${id}?agentId=${encodeURIComponent(agentId)}`
      : `/ai/artifacts/${id}`,
    { method: "DELETE" }
  );

export const fetchAiCommands = () => api<{ commands: AiChatCommand[] }>("/ai/commands");

export const fetchAiToolsRegistry = (agentId = "intelligence") =>
  api<{ tools: AiToolDef[] }>(`/ai/tools?agentId=${encodeURIComponent(agentId)}`);
export const updateAiSettings = (patch: Partial<AiSettings>) =>
  api<AiSettings>("/ai/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
export const startAiModel = (modelPath?: string) =>
  api<AiStatus>("/ai/start", {
    method: "POST",
    body: JSON.stringify({ modelPath }),
  });
export const stopAiModel = () => api<AiStatus>("/ai/stop", { method: "POST" });
export const restartAiModel = (modelPath?: string) =>
  api<AiStatus>("/ai/restart", {
    method: "POST",
    body: JSON.stringify({ modelPath }),
  });

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
  pending: { skills: number; rules: number; memories: number };
  embeddingCoverage: { total: number; embedded: number };
  ragTopK: number;
  embedderLogTail: string[];
}

export const fetchEmbeddingStatus = () =>
  api<EmbeddingEngineStatus>("/ai/embeddings/status");
export const fetchEmbeddingActivity = () =>
  api<EmbeddingEngineActivity>("/ai/embeddings/activity");
export const setEmbeddingEnabled = (enabled: boolean) =>
  api<EmbeddingEngineStatus>("/ai/embeddings/enabled", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
export const startEmbeddingEngine = () =>
  api<EmbeddingEngineStatus>("/ai/embeddings/start", { method: "POST" });
export const stopEmbeddingEngine = () =>
  api<EmbeddingEngineStatus>("/ai/embeddings/stop", { method: "POST" });

export const fetchAiChats = () => api<AiChat[]>("/ai/chats");
export const createAiChat = (title?: string) =>
  api<AiChat>("/ai/chats", { method: "POST", body: JSON.stringify({ title }) });
export const deleteAiChat = (id: string) =>
  api<{ ok: boolean }>(`/ai/chats/${id}`, { method: "DELETE" });
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
  api<{ ok: boolean; session: SharedChatSession }>(`/ai/chats/${chatId}/share`, {
    method: "POST",
    body: JSON.stringify({ agentId }),
  });

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
  return api<InferenceRunResult>("/inference/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
  api<{ ok: boolean }>("/ai/chat/confirm-tool", {
    method: "POST",
    body: JSON.stringify({ toolCallId, approved }),
  });

export const fetchAiAdapters = () => api<{ adapters: AiAdapter[] }>("/ai/adapters");
export const createAiAdapter = (body: {
  name: string;
  path: string;
  description?: string;
  domain?: string;
  defaultScale?: number;
}) => api<AiAdapter>("/ai/adapters", { method: "POST", body: JSON.stringify(body) });
export const updateAiAdapter = (
  id: string,
  patch: { enabled?: boolean; defaultScale?: number; description?: string }
) => api<AiAdapter>(`/ai/adapters/${id}`, { method: "PUT", body: JSON.stringify(patch) });
export const deleteAiAdapter = (id: string) =>
  api<{ ok: boolean }>(`/ai/adapters/${id}`, { method: "DELETE" });

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
}) => api<AiDataset>("/ai/datasets", { method: "POST", body: JSON.stringify(body) });

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
}) => api<AiDataset>("/ai/datasets/build", { method: "POST", body: JSON.stringify(body) });

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
  api<{ id: string; job: AiTrainingJob }>("/ai/training/jobs", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const cancelAiTrainingJob = (id: string) =>
  api<{ ok: boolean }>(`/ai/training/jobs/${id}/cancel`, { method: "POST" });

export const fetchAiLoraAdapters = () => api<AiLoraAdapter[]>("/ai/lora-adapters");
export const updateAiLoraAdapters = (adapters: Array<{ id: number; scale: number }>) =>
  api<AiLoraAdapter[]>("/ai/lora-adapters", {
    method: "POST",
    body: JSON.stringify(adapters),
  });

export const fetchAiQueue = () => api<{ jobs: AiQueueJob[] }>("/ai/queue");
export const fetchAiAgents = () => api<{ agents: AiAgent[] }>("/ai/agents");
export const fetchAiAgent = (id: string) => api<AiAgent>(`/ai/agents/${id}`);
export const createAiAgent = (body: {
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
}) => api<AiAgent>("/ai/agents", { method: "POST", body: JSON.stringify(body) });
export const cloneAiAgent = (id: string, name: string) =>
  api<AiAgent>(`/ai/agents/${id}/clone`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
export const updateAiAgent = (id: string, patch: Partial<AiAgent> & Record<string, unknown>) =>
  api<AiAgent>(`/ai/agents/${id}`, { method: "PUT", body: JSON.stringify(patch) });
export const deleteAiAgent = (id: string) =>
  api<{ ok: boolean }>(`/ai/agents/${id}`, { method: "DELETE" });

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
  api<{ account: AiAgentAccount }>(`/ai/agents/${agentId}/accounts/apikey`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const revokeAgentAccount = (agentId: string, accountId: string) =>
  api<{ ok: boolean }>(`/ai/agents/${agentId}/accounts/${accountId}`, {
    method: "DELETE",
  });

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
  api<{ reflection: AgentReflectionConfig }>(`/ai/agents/${agentId}/reflection`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const runAgentReflection = (agentId: string) =>
  api<{ ok: boolean; jobId: string }>(`/ai/agents/${agentId}/reflection/run`, {
    method: "POST",
  });

export const fetchReflectionProposals = (
  agentId: string,
  status: "pending" | "approved" | "rejected" | "all" = "pending"
) =>
  api<{ proposals: ReflectionProposal[] }>(
    `/ai/agents/${agentId}/reflection/proposals?status=${status}`
  );

export const approveReflectionProposal = (id: string) =>
  api<{ ok: boolean }>(`/ai/reflection/proposals/${id}/approve`, { method: "POST" });

export const rejectReflectionProposal = (id: string) =>
  api<{ ok: boolean }>(`/ai/reflection/proposals/${id}/reject`, { method: "POST" });

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
) =>
  api<{ ok: boolean; assignment: AiAgentAssignment | null }>(
    "/ai/agents/assignments",
    {
      method: "PUT",
      body: JSON.stringify({ scopeType, scopeId, agentId, role }),
    }
  );

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
  api<AiSecret>("/ai/secrets", { method: "POST", body: JSON.stringify({ name, value }) });
export const deleteAiSecret = (id: string) =>
  api<{ ok: boolean }>(`/ai/secrets/${id}`, { method: "DELETE" });

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
  api<{ ok: boolean; status: CursorAuthStatus }>("/ai/cursor/api-key", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
export const disconnectCursorApiKey = () =>
  api<{ ok: boolean; status: CursorAuthStatus }>("/ai/cursor/api-key", { method: "DELETE" });
export const fetchCursorModels = () =>
  api<{ models: CursorModelOption[] }>("/ai/cursor/models");
export const applyCursorToIntelligence = (model = "auto") =>
  api<{ ok: boolean }>("/ai/cursor/use-for-intelligence", {
    method: "POST",
    body: JSON.stringify({ model }),
  });

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
  api<{ ok: true; active: CatalogModel }>("/ai/select-model", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const truncateAiChat = (chatId: string, afterMessageId: string) =>
  api<{ deleted: number }>(`/ai/chats/${chatId}/truncate`, {
    method: "POST",
    body: JSON.stringify({ afterMessageId }),
  });

export const deleteAiChatMessage = (chatId: string, messageId: string) =>
  api<{ ok: boolean }>(`/ai/chats/${chatId}/messages/${messageId}`, {
    method: "DELETE",
  });

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
}) => api<AiQueueJob>("/ai/queue", { method: "POST", body: JSON.stringify(body) });
export const cancelAiQueueJob = (id: string) =>
  api<{ ok: boolean }>(`/ai/queue/${id}/cancel`, { method: "POST" });
export const fetchAiWorkflows = (agentId = "intelligence") =>
  api<{ workflows: AiWorkflow[] }>(
    `/ai/workflows?agentId=${encodeURIComponent(agentId)}`
  );
export const updateAiWorkflow = (id: string, patch: { name?: string; config?: unknown; enabled?: boolean }) =>
  api<AiWorkflow>(`/ai/workflows/${id}`, { method: "PUT", body: JSON.stringify(patch) });
export const createAiWorkflow = (name: string, config?: unknown, agentId = "intelligence") =>
  api<AiWorkflow>("/ai/workflows", {
    method: "POST",
    body: JSON.stringify({ name, config: config ?? { nodes: [], edges: [], triggers: [] }, agentId }),
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
  api<{ ok: boolean }>(`/ai/workflows/runs/${id}/resume`, {
    method: "POST",
    body: JSON.stringify({ decision, comments }),
  });
export const cancelWorkflowRun = (id: string) =>
  api<{ ok: boolean }>(`/ai/workflows/runs/${id}/cancel`, { method: "POST" });

export const fetchAiSchedules = () => api<{ schedules: AiSchedule[] }>("/ai/schedules");
export const createAiSchedule = (body: {
  workflowId: string;
  cronExpr: string;
  timezone?: string;
  enabled?: boolean;
}) => api<AiSchedule>("/ai/schedules", { method: "POST", body: JSON.stringify(body) });
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
  api<AiProjectCard>("/ai/projects/cards", { method: "POST", body: JSON.stringify(body) });
export const moveProjectCard = (id: string, columnId: string, sortOrder?: number) =>
  api<AiProjectCard>(`/ai/projects/cards/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ columnId, sortOrder }),
  });
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
  }
) =>
  api<AiProjectCard>(`/ai/projects/cards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
export const deleteProjectCard = (id: string) =>
  api<{ ok: boolean }>(`/ai/projects/cards/${id}`, { method: "DELETE" });
export const fetchCardSubtasks = (id: string) =>
  api<AiCardSubtasks>(`/ai/projects/cards/${id}/subtasks`);
export const fetchCardComments = (id: string) =>
  api<{ comments: AiCardComment[] }>(`/ai/projects/cards/${id}/comments`);
export const addCardComment = (id: string, body: string, author: "user" | "agent" = "user") =>
  api<AiCardComment>(`/ai/projects/cards/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, author }),
  });
export const fetchWorkflowComments = (id: string) =>
  api<{ comments: AiWorkflowComment[] }>(`/ai/workflows/${id}/comments`);
export const addWorkflowComment = (id: string, body: string, author: "user" | "agent" = "user") =>
  api<AiWorkflowComment>(`/ai/workflows/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, author }),
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
  api<AiCalendarEvent>("/ai/calendar/events", {
    method: "POST",
    body: JSON.stringify(body),
  });

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
  }
) =>
  api<AiCalendarEvent>(`/ai/calendar/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteCalendarEvent = (id: string) =>
  api<{ ok: boolean }>(`/ai/calendar/events/${id}`, { method: "DELETE" });

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
  api<AiCalendarEvent>("/user/calendar/events", {
    method: "POST",
    body: JSON.stringify(body),
  });

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
  api<AiCalendarEvent>(`/user/calendar/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteUserCalendarEvent = (id: string) =>
  api<{ ok: boolean }>(`/user/calendar/events/${id}`, { method: "DELETE" });

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

export const fetchUserProjects = (userId?: string) => {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return api<AiProjectsSnapshot & { role: UserProductivityRole; ownerUserId: string }>(
    `/user/projects${q}`
  );
};

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
}) =>
  api<AiProjectCard>("/user/projects/cards", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const moveUserProjectCard = (id: string, columnId: string, sortOrder?: number) =>
  api<AiProjectCard>(`/user/projects/cards/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ columnId, sortOrder }),
  });

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
  api<AiProjectCard>(`/user/projects/cards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteUserProjectCard = (id: string) =>
  api<{ ok: boolean }>(`/user/projects/cards/${id}`, { method: "DELETE" });

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
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return api<AiCardComment>(`/user/projects/cards/${id}/comments${q}`, {
    method: "POST",
    body: JSON.stringify({ body, author }),
  });
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
  return api<{ id: string; label: string; icon: string }>("/departments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateStructureDepartment(
  id: string,
  patch: { label?: string; icon?: string }
) {
  return api<{ ok: boolean }>(`/departments/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function deleteStructureDepartment(id: string) {
  return api<{ ok: boolean }>(`/departments/${id}`, { method: "DELETE" });
}

export async function createStructureDivision(
  departmentId: string,
  body: { id: string; label: string; icon?: string; rightSidebar?: string | null }
) {
  return api<{ id: string }>(`/departments/${departmentId}/divisions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateStructureDivision(
  departmentId: string,
  divisionId: string,
  patch: { label?: string; icon?: string; rightSidebar?: string | null }
) {
  return api<{ ok: boolean }>(`/divisions/${departmentId}/${divisionId}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function deleteStructureDivision(departmentId: string, divisionId: string) {
  return api<{ ok: boolean }>(`/divisions/${departmentId}/${divisionId}`, {
    method: "DELETE",
  });
}

export async function createStructurePage(
  departmentId: string,
  divisionId: string,
  body: { id: string; label: string; icon?: string; segment?: string }
) {
  return api<{ id: string }>(`/divisions/${departmentId}/${divisionId}/pages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateStructurePage(
  departmentId: string,
  divisionId: string,
  pageId: string,
  patch: { label?: string; icon?: string; segment?: string }
) {
  return api<{ ok: boolean }>(`/pages/${departmentId}/${divisionId}/${pageId}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function deleteStructurePage(
  departmentId: string,
  divisionId: string,
  pageId: string
) {
  return api<{ ok: boolean }>(`/pages/${departmentId}/${divisionId}/${pageId}`, {
    method: "DELETE",
  });
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
}) {
  return api<StructureNodeDto>("/nodes", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
  }
) {
  return api<{ ok: boolean }>(`/nodes/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function deleteStructureNode(id: string) {
  return api<{ ok: boolean }>(`/nodes/${id}`, { method: "DELETE" });
}

/** Move a node under a new parent (or to top-level with `null`). */
export async function reparentStructureNode(id: string, parentId: string | null) {
  return updateStructureNode(id, { parentId });
}

export async function reorderStructureNodes(
  parentId: string | null,
  orderedIds: string[]
) {
  return api<{ ok: boolean }>("/structure/reorder", {
    method: "POST",
    body: JSON.stringify({ parentId, orderedIds }),
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
  return api<{ ok: boolean }>("/structure/graph/layout", {
    method: "PUT",
    body: JSON.stringify({ layout }),
  });
}

/** Attach (or detach with `null`) an agent on a structure node. */
export async function setNodeAgent(nodeId: string, agentId: string | null) {
  if (agentId) {
    return api<{ ok: boolean }>(`/nodes/${nodeId}/agent`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
  }
  return api<{ ok: boolean }>(`/nodes/${nodeId}/agent`, { method: "DELETE" });
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
  return api<{ user: AuthUser; sessionToken?: string }>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }
  ).then((res) => {
    if (allowSessionTokenFallback && res.sessionToken) {
      clearActiveTenant();
      writeSessionToken(res.sessionToken);
    }
    return res;
  });
}

export function signupPassword(email: string, password: string, name: string) {
  return api<{ user: AuthUser; sessionToken?: string }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
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
  return api<{ user: AdminUserRow }>("/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminUser(userId: string, input: AdminUpdateUserInput) {
  return api<{ user: AdminUserRow }>(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAdminUser(userId: string) {
  return api<{ ok: boolean }>(`/admin/users/${userId}`, { method: "DELETE" });
}

export function createAdminTenantForUser(
  userId: string,
  name: string,
  slug?: string
) {
  return api<{ tenant: { id: string; name: string; slug: string }; user: AdminUserRow }>(
    `/admin/users/${userId}/tenants`,
    {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    }
  );
}

export function updateAdminTenant(
  tenantId: string,
  input: { name?: string; slug?: string }
) {
  return api<{ tenant: { id: string; name: string; slug: string; isOperator: boolean } }>(
    `/admin/tenants/${tenantId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export function deleteAdminTenant(tenantId: string) {
  return api<{ ok: boolean }>(`/admin/tenants/${tenantId}`, { method: "DELETE" });
}

export function fetchAuthTenants() {
  return api<{ tenants: TenantSummary[]; operatorTenantId: string }>("/auth/tenants");
}

export function createAuthTenant(name: string, slug?: string) {
  return api<{ id: string; slug: string }>("/auth/tenants", {
    method: "POST",
    body: JSON.stringify({ name, slug }),
  });
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
  return api<{ profile: UserProfile }>("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
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
  return api<{ connection: BridgeConnection }>("/connections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteBridgeConnection(id: string) {
  return api<{ ok: boolean }>(`/connections/${id}`, { method: "DELETE" });
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
  visibility: string;
  status: string;
  delivery_mode?: string;
  pricing_model?: string;
  price_period?: string | null;
  meter_unit?: string | null;
  meter_rate?: number | null;
  license?: string | null;
  inference_endpoint_id?: string | null;
  created_at: string;
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

export function fetchMarketplaceListings(params?: { q?: string; kind?: string }) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.kind) qs.set("kind", params.kind);
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
  return api<{ id: string }>("/marketplace/catalog/sources", {
    method: "POST",
    body: JSON.stringify({ name, url }),
  });
}

export function removeCatalogSource(id: string) {
  return api<{ ok: boolean }>(`/marketplace/catalog/sources/${id}`, { method: "DELETE" });
}

export function installCatalogEntry(entryId: string, sourceCatalog?: string) {
  return api<Record<string, unknown>>(`/marketplace/catalog/install/${entryId}`, {
    method: "POST",
    body: JSON.stringify({ sourceCatalog }),
  });
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
  return api<{
    pluginId: string;
    pluginRoot: string;
    name: string;
    version: string;
    installed: boolean;
    built: boolean;
  }>("/marketplace/catalog/local-plugins", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function removeLocalPlugin(path: string) {
  return api<{ ok: boolean }>("/marketplace/catalog/local-plugins", {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

export function installWorkspacePlugin(pluginId: string) {
  return api<{ ok: boolean; pluginId: string }>("/marketplace/catalog/plugins/install", {
    method: "POST",
    body: JSON.stringify({ pluginId }),
  });
}

export function uninstallWorkspacePlugin(pluginId: string) {
  return api<{ ok: boolean; pluginId: string }>("/marketplace/catalog/plugins/uninstall", {
    method: "POST",
    body: JSON.stringify({ pluginId }),
  });
}

export function fetchNetworkStatus() {
  return api<Record<string, unknown>>("/network/status");
}

export function enableTailscaleFederation() {
  return api<{ federationUrl: string | null; error?: string }>("/network/tailscale/enable", {
    method: "POST",
  });
}

export function fetchNetworkPeers() {
  return api<{ peers: Array<Record<string, unknown>> }>("/network/peers");
}

export function inviteNetworkPeer(email: string, remoteBridgeUrl?: string) {
  return api<{ inviteId: string }>("/network/peers/invite", {
    method: "POST",
    body: JSON.stringify({ email, remoteBridgeUrl }),
  });
}

export function refreshNetworkPeers() {
  return api<{ peers: Array<Record<string, unknown>> }>("/network/peers/refresh", {
    method: "POST",
  });
}

export function createFederatedShareInvite(body: {
  resourceKind: string;
  resourceId: string;
  inviteeEmail: string;
  role?: string;
}) {
  return api<{ inviteId: string; inviteToken: string; inviteUrl: string }>(
    "/network/share-invites",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function acceptFederatedShareInvite(inviteToken: string, ownerBridgeUrl: string) {
  return api<Record<string, unknown>>("/network/share-invites/accept", {
    method: "POST",
    body: JSON.stringify({ inviteToken, ownerBridgeUrl }),
  });
}

export function fetchBridgeHealth() {
  return api<{ ok: boolean; hub: boolean; deploymentMode: string; client?: boolean }>(
    "/health"
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
  return api<{ ok: boolean }>("/onboarding/llm/local", {
    method: "POST",
    body: JSON.stringify({ modelPath }),
  });
}

export function markOnboardingCloudReady() {
  return api<{ ok: boolean }>("/onboarding/llm/cloud-ready", { method: "POST" });
}

export function completeOnboarding() {
  return api<{ ok: boolean }>("/onboarding/complete", { method: "POST" });
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

export interface MarketplaceCheckoutResult {
  mode: "stripe" | "dev";
  clientSecret?: string;
  id?: string;
  usdCents?: number;
  credits: number;
  publishableKey?: string | null;
}

export function checkoutMarketplaceCredits(usdCents: number) {
  return api<MarketplaceCheckoutResult>("/marketplace/wallet/checkout", {
    method: "POST",
    body: JSON.stringify({ usdCents }),
  });
}

export function confirmMarketplacePurchase(opts: {
  amount: number;
  paymentIntentId?: string;
  usdCents?: number;
}) {
  return api<{ balance: number }>("/marketplace/wallet/purchase", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

/** @deprecated Use checkoutMarketplaceCredits + confirmMarketplacePurchase */
export function purchaseMarketplaceCredits(amount: number) {
  return confirmMarketplacePurchase({ amount });
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
  return api<PlatformBillingConfig>("/admin/billing", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function testAdminBillingConnection() {
  return api<{ ok: boolean; detail?: string }>("/admin/billing/test", {
    method: "POST",
  });
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
  deliveryMode?: "clone" | "live";
  pricingModel?: "one_time" | "subscription" | "metered";
  pricePeriod?: string;
  meterUnit?: string;
  meterRate?: number;
  license?: string;
  inferenceEndpointId?: string;
  bundleChildren?: unknown[];
}) {
  return api<{ id: string }>("/marketplace/listings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchMyMarketplaceListings() {
  return api<{ listings: MarketplaceListing[] }>("/marketplace/my/listings");
}

export function fetchMarketplaceEntitlements() {
  return api<{ entitlements: MarketplaceEntitlement[] }>("/marketplace/entitlements");
}

export function cancelMarketplaceEntitlement(entitlementId: string) {
  return api<{ ok: boolean }>(`/marketplace/entitlements/${entitlementId}/cancel`, {
    method: "POST",
  });
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
  return api<{ id: string }>("/marketplace/inference/endpoints", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function acquireMarketplaceListing(listingId: string) {
  return api<{
    ok: boolean;
    mode: "clone" | "live";
    import?: { kind: string; newId: string };
    entitlementId?: string;
    shareGrantId?: string;
    balance: number;
  }>(`/marketplace/listings/${listingId}/acquire`, { method: "POST" });
}

export function exportPortableEntity(kind: string, resourceId: string) {
  return api<{ bundle: unknown }>("/marketplace/export", {
    method: "POST",
    body: JSON.stringify({ kind, resourceId }),
  });
}

export function importPortableBundle(bundle: unknown) {
  return api<{ ok: boolean; kind: string; newId: string }>("/marketplace/import", {
    method: "POST",
    body: JSON.stringify({ bundle }),
  });
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
  return api<{ id: string }>("/shares/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeShareGrant(grantId: string) {
  return api<{ ok: boolean }>(`/shares/${grantId}`, { method: "DELETE" });
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
  return api<{ id: string; endpointId: string }>("/shares/model", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Models shared WITH me (incoming free `model` grants). */
export function fetchSharedModels() {
  return api<{ models: SharedModel[] }>("/shares/models");
}

export function cloneSharedResource(kind: string, resourceId: string) {
  return api<{ ok: boolean; kind: string; newId: string }>(
    `/shares/clone/${kind}/${encodeURIComponent(resourceId)}`,
    { method: "POST" }
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
  return api<{ conversation: DmConversation }>("/dm/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
  return api<{ message: DmMessage }>(
    `/dm/conversations/${conversationId}/messages`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function markDmConversationRead(
  conversationId: string,
  messageId?: string
) {
  return api<{ ok: boolean }>(`/dm/conversations/${conversationId}/read`, {
    method: "POST",
    body: JSON.stringify({ messageId }),
  });
}

export function addDmConversationMember(
  conversationId: string,
  body: { userId?: string; email?: string }
) {
  return api<{ member: DmConversationMember }>(
    `/dm/conversations/${conversationId}/members`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function removeDmConversationMember(
  conversationId: string,
  userId: string
) {
  return api<{ ok: boolean }>(
    `/dm/conversations/${conversationId}/members/${userId}`,
    { method: "DELETE" }
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
  return api<{
    grants: Array<{ granteeUserId: string; grantId: string }>;
  }>(`/dm/conversations/${conversationId}/share`, {
    method: "POST",
    body: JSON.stringify(body),
  });
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
  return api<{ updated: number; unreadCount: number }>("/notifications/read", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteNotification(id: string) {
  return api<{ ok: boolean; unreadCount: number }>(`/notifications/${id}`, {
    method: "DELETE",
  });
}

export function clearNotifications(input: { readOnly?: boolean } = {}) {
  return api<{ deleted: number; unreadCount: number }>("/notifications/clear", {
    method: "POST",
    body: JSON.stringify(input),
  });
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
  return api<{ hook: Hook }>("/hooks/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateHook(id: string, body: Partial<CreateHookBody>) {
  return api<{ hook: Hook }>(`/hooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteHook(id: string) {
  return api<{ ok: boolean }>(`/hooks/${id}`, { method: "DELETE" });
}

export function fetchHookRuns(id: string) {
  return api<{ runs: HookRun[] }>(`/hooks/${id}/runs`);
}

export function approveHookRun(runId: string) {
  return api<{ ok: boolean }>(`/hooks/runs/${runId}/approve`, { method: "POST" });
}

export function rejectHookRun(runId: string) {
  return api<{ ok: boolean }>(`/hooks/runs/${runId}/reject`, { method: "POST" });
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
}) {
  return api<{ ticket?: SupportTicket; redirectUrl?: string; kind?: string }>(
    "/support/tickets",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
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
  return api<{ message: SupportMessage }>(`/support/tickets/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
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
  return api<{ member: SupportGroupMember }>("/support/group/members", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeSupportGroupMember(body: {
  memberKind: "user" | "agent";
  memberId: string;
  tenantId?: string | null;
}) {
  return api<{ ok: boolean }>("/support/group/members", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

export function fetchAdminSupportTickets(status?: SupportTicketStatus) {
  const suffix = status ? `?status=${status}` : "";
  return api<{ tickets: SupportTicket[] }>(`/support/admin/tickets${suffix}`);
}

export function updateAdminSupportTicket(
  id: string,
  body: { status?: SupportTicketStatus; priority?: string | null }
) {
  return api<{ ticket: SupportTicket }>(`/support/admin/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
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
  return api<{ page: WikiPage }>("/wiki/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
  return api<{ page: WikiPage }>(`/wiki/pages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteWikiPage(id: string) {
  return api<{ ok: boolean }>(`/wiki/pages/${id}`, { method: "DELETE" });
}
