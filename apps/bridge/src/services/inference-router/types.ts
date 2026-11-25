import type { GodModeInferenceProvider } from "../godmode-inference-supply.js";

export type InferenceBand = "trivial" | "chat" | "tools" | "hard";

export const INFERENCE_BANDS: InferenceBand[] = [
  "trivial",
  "chat",
  "tools",
  "hard",
];

export type InferenceCapability = "tools" | "vision" | "long_context";

export type RosterTag = "fast" | "smart" | "coding" | "chat" | "local";

export type ToolPolicy = "none" | "light" | "full";

export type DecisionSource = "heuristic" | "model" | "embeddings" | "merged";

export type AutoPreference =
  | "auto"
  | "auto:fast"
  | "auto:smart"
  | "auto:chat"
  | "auto:coding";

export type RosterCaps = {
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
};

export type RosterEntry = {
  id: string;
  provider: GodModeInferenceProvider;
  model: string;
  band: InferenceBand;
  /** USD per 1k input tokens (0 for free routes). */
  costPer1kIn: number;
  /** USD per 1k output tokens (0 for free routes). */
  costPer1kOut: number;
  caps: RosterCaps;
  capabilities: InferenceCapability[];
  /** Prefer for classifier Decision/JEV calls. */
  classifier?: boolean;
  enabled?: boolean;
  /** Continuous capability score 0..1 (static seed until benches land). */
  capabilityScore?: number;
  tags?: RosterTag[];
};

export type ClassifyInput = {
  userMessage: string;
  chatMode?: string | null;
  hasTools?: boolean;
  hasImages?: boolean;
  historyChars?: number;
  preference?: AutoPreference | string | null;
};

export type ClassifyResult = {
  band: InferenceBand;
  reason: string;
  source: "model" | "heuristic";
  complexityScore?: number;
};

export type AutoRouteRequest = {
  userMessage: string;
  chatMode?: string | null;
  hasTools?: boolean;
  hasImages?: boolean;
  historyChars?: number;
  /** Exclude roster ids already tried this turn. */
  excludeIds?: string[];
  /** Force a starting band (skip classify). */
  band?: InferenceBand;
  /** Friend-style preference pin. Default auto. */
  preference?: AutoPreference | string | null;
};

export type AutoRouteResult = {
  rosterId: string;
  provider: GodModeInferenceProvider;
  modelId: string;
  transport: string;
  baseUrl: string;
  apiKeyRef: string;
  band: InferenceBand;
  classify: ClassifyResult;
  costPer1kIn: number;
  costPer1kOut: number;
  complexityScore: number;
  enableThinking: boolean;
  maxTokens: number;
  toolPolicy: ToolPolicy;
  confidence: number;
  source: DecisionSource;
  reasons: string[];
  /** Ranked failover roster ids (up to 3). */
  failover: string[];
};

export type RouteDecisionLog = {
  at: string;
  band: InferenceBand;
  classifySource: ClassifyResult["source"];
  classifyReason: string;
  chosenRosterId: string | null;
  chosenModel: string | null;
  chosenProvider: string | null;
  attempts: string[];
  error?: string;
  complexityScore?: number;
  enableThinking?: boolean;
  maxTokens?: number;
  toolPolicy?: ToolPolicy;
  confidence?: number;
  source?: DecisionSource;
  reasons?: string[];
  failover?: string[];
};
