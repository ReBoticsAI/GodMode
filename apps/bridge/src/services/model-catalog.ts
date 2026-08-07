import { getAgent, listSecrets, updateAgent } from "./agents/agents-db.js";
import {
  isCursorSubscriptionReady,
  listCursorSubscriptionModelsForCatalog,
  formatCursorModelLabel,
} from "./cursor-subscription.js";
import {
  isOpenAiPlatformReady,
  isOpenAiVaultSecretId,
  OPENAI_API_KEY_SECRET_ID,
  OPENAI_API_KEY_SECRET_NAME,
} from "./openai-platform.js";
import {
  ANTHROPIC_API_KEY_SECRET_ID,
  ANTHROPIC_API_KEY_SECRET_NAME,
  isAnthropicPlatformReady,
  isAnthropicVaultSecretId,
} from "./anthropic-platform.js";
import {
  isOpenRouterAgentConfig,
  isOpenRouterPlatformReady,
  isOpenRouterVaultSecretId,
  OPENROUTER_API_BASE_URL,
  OPENROUTER_API_KEY_SECRET_ID,
  OPENROUTER_API_KEY_SECRET_NAME,
  OPENROUTER_TOP10_CATALOG,
} from "./openrouter-platform.js";
import {
  isGroqAgentConfig,
  isGroqPlatformReady,
  isGroqVaultSecretId,
  GROQ_API_BASE_URL,
  GROQ_API_KEY_SECRET_ID,
  GROQ_API_KEY_SECRET_NAME,
  GROQ_CHAT_CATALOG,
} from "./groq-platform.js";
import {
  isTogetherAgentConfig,
  isTogetherPlatformReady,
  isTogetherVaultSecretId,
  TOGETHER_API_BASE_URL,
  TOGETHER_API_KEY_SECRET_ID,
  TOGETHER_API_KEY_SECRET_NAME,
  TOGETHER_CHAT_CATALOG,
} from "./together-platform.js";
import {
  isFireworksAgentConfig,
  isFireworksPlatformReady,
  isFireworksVaultSecretId,
  FIREWORKS_API_BASE_URL,
  FIREWORKS_API_KEY_SECRET_ID,
  FIREWORKS_API_KEY_SECRET_NAME,
  FIREWORKS_CHAT_CATALOG,
} from "./fireworks-platform.js";
import {
  isDeepSeekAgentConfig,
  isDeepSeekPlatformReady,
  isDeepSeekVaultSecretId,
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_API_KEY_SECRET_ID,
  DEEPSEEK_API_KEY_SECRET_NAME,
  DEEPSEEK_CHAT_CATALOG,
} from "./deepseek-platform.js";
import {
  isGoogleAiAgentConfig,
  isGoogleAiPlatformReady,
  isGoogleAiVaultSecretId,
  GOOGLE_AI_API_BASE_URL,
  GOOGLE_AI_API_KEY_SECRET_ID,
  GOOGLE_AI_API_KEY_SECRET_NAME,
  GOOGLE_AI_CHAT_CATALOG,
} from "./google-ai-platform.js";
import {
  isXaiAgentConfig,
  isXaiPlatformReady,
  isXaiVaultSecretId,
  XAI_API_BASE_URL,
  XAI_API_KEY_SECRET_ID,
  XAI_API_KEY_SECRET_NAME,
  XAI_CHAT_CATALOG,
} from "./xai-platform.js";
import {
  isZaiAgentConfig,
  isZaiPlatformReady,
  isZaiVaultSecretId,
  ZAI_API_BASE_URL,
  ZAI_API_KEY_SECRET_ID,
  ZAI_API_KEY_SECRET_NAME,
  ZAI_CHAT_CATALOG,
} from "./zai-platform.js";
import {
  isMinimaxAgentConfig,
  isMinimaxPlatformReady,
  isMinimaxVaultSecretId,
  MINIMAX_API_BASE_URL,
  MINIMAX_API_KEY_SECRET_ID,
  MINIMAX_API_KEY_SECRET_NAME,
  MINIMAX_CHAT_CATALOG,
} from "./minimax-platform.js";
import {
  isCustomOpenAiAgentConfig,
  isCustomOpenAiPlatformReady,
  isCustomOpenAiVaultSecretId,
  resolveCustomOpenAiBaseUrl,
  CUSTOM_OPENAI_API_KEY_SECRET_ID,
  CUSTOM_OPENAI_API_KEY_SECRET_NAME,
  CUSTOM_OPENAI_BASE_URL_SECRET_NAME,
} from "./custom-openai-platform.js";
import {
  isZaiCodingAgentConfig,
  isZaiCodingPlatformReady,
  isZaiCodingVaultSecretId,
  ZAI_CODING_API_BASE_URL,
  ZAI_CODING_API_KEY_SECRET_ID,
  ZAI_CODING_API_KEY_SECRET_NAME,
  ZAI_CODING_CHAT_CATALOG,
} from "./zai-coding-platform.js";
import {
  isOpencodeGoAgentConfig,
  isOpencodeGoPlatformReady,
  isOpencodeGoVaultSecretId,
  OPENCODE_GO_API_BASE_URL,
  OPENCODE_GO_API_KEY_SECRET_ID,
  OPENCODE_GO_API_KEY_SECRET_NAME,
  OPENCODE_GO_CHAT_CATALOG,
} from "./opencode-go-platform.js";
import {
  isDigitalOceanInferenceAgentConfig,
  isDigitalOceanInferencePlatformReady,
  isDigitalOceanInferenceVaultSecretId,
  DIGITALOCEAN_INFERENCE_API_BASE_URL,
  DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID,
  DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME,
  DIGITALOCEAN_INFERENCE_CHAT_CATALOG,
} from "./digitalocean-inference-platform.js";
import {
  isSnowflakeCortexAgentConfig,
  isSnowflakeCortexPlatformReady,
  isSnowflakeCortexVaultSecretId,
  resolveSnowflakeCortexBaseUrl,
  SNOWFLAKE_CORTEX_API_KEY_SECRET_ID,
  SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME,
  SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME,
  SNOWFLAKE_CORTEX_CHAT_CATALOG,
} from "./snowflake-cortex-platform.js";
import {
  isMinimaxTokenAgentConfig,
  isMinimaxTokenPlatformReady,
  isMinimaxTokenVaultSecretId,
  MINIMAX_TOKEN_API_BASE_URL,
  MINIMAX_TOKEN_API_KEY_SECRET_ID,
  MINIMAX_TOKEN_API_KEY_SECRET_NAME,
  MINIMAX_TOKEN_CHAT_CATALOG,
} from "./minimax-token-platform.js";
import {
  isKimiCodeAgentConfig,
  isKimiCodePlatformReady,
  isKimiCodeVaultSecretId,
  KIMI_CODE_API_BASE_URL,
  KIMI_CODE_API_KEY_SECRET_ID,
  KIMI_CODE_API_KEY_SECRET_NAME,
  KIMI_CODE_CHAT_CATALOG,
} from "./kimi-code-platform.js";
import {
  isPoeAgentConfig,
  isPoePlatformReady,
  isPoeVaultSecretId,
  POE_API_BASE_URL,
  POE_API_KEY_SECRET_ID,
  POE_API_KEY_SECRET_NAME,
  POE_CHAT_CATALOG,
} from "./poe-platform.js";
import {
  isOpencodeZenAgentConfig,
  isOpencodeZenPlatformReady,
  isOpencodeZenVaultSecretId,
  OPENCODE_ZEN_API_BASE_URL,
  OPENCODE_ZEN_API_KEY_SECRET_ID,
  OPENCODE_ZEN_API_KEY_SECRET_NAME,
  OPENCODE_ZEN_CHAT_CATALOG,
} from "./opencode-zen-platform.js";
import type { AppDatabase } from "../db.js";
import type { CoreDatabase } from "../core-db.js";
import { isEmbeddingGguf, type LlmManager } from "./llm-manager.js";
import { markLlmReady } from "./onboarding.js";
import { listSharedModelsForUser } from "./share-service.js";
import {
  resolveHarnessProfile,
  type ModelHarnessProfile,
} from "./model-profiles/index.js";

export type CatalogModelSource = "local" | "cursor" | "provider" | "remote";

export interface CatalogModel {
  id: string;
  source: CatalogModelSource;
  label: string;
  /** Local GGUF absolute path */
  path?: string;
  /** Cursor / provider model id */
  model?: string;
  /** Marketplace / shared endpoint */
  endpointId?: string;
  provider?: "openai" | "anthropic" | "openai_compatible";
  /** openai_compatible transport: openrouter | groq */
  transport?: string;
  multimodal?: boolean;
  active?: boolean;
  /** Resolved harness profile id (display / debug). */
  harnessProfileId?: string;
}

const OPENAI_CATALOG = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "o3", label: "o3" },
  { id: "o4-mini", label: "o4-mini" },
];

const ANTHROPIC_CATALOG = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { id: "claude-haiku-4-20250514", label: "Claude Haiku 4" },
];

function secretLooksLike(name: string, needle: string): boolean {
  return name.toLowerCase().includes(needle);
}

function openRouterHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "openrouter",
    baseUrl: OPENROUTER_API_BASE_URL,
  };
}

function groqHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "groq",
    baseUrl: GROQ_API_BASE_URL,
  };
}

function togetherHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "together",
    baseUrl: TOGETHER_API_BASE_URL,
  };
}

function fireworksHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "fireworks",
    baseUrl: FIREWORKS_API_BASE_URL,
  };
}

function deepseekHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "deepseek",
    baseUrl: DEEPSEEK_API_BASE_URL,
  };
}

function googleAiHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "google_ai",
    baseUrl: GOOGLE_AI_API_BASE_URL,
  };
}

function xaiHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "xai",
    baseUrl: XAI_API_BASE_URL,
  };
}

function zaiHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "zai",
    baseUrl: ZAI_API_BASE_URL,
  };
}

function minimaxHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "minimax",
    baseUrl: MINIMAX_API_BASE_URL,
  };
}

function customOpenAiHarnessInput(model: string, baseUrl: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "custom_openai",
    baseUrl,
  };
}

function zaiCodingHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "zai_coding",
    baseUrl: ZAI_CODING_API_BASE_URL,
  };
}

function opencodeGoHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "opencode_go",
    baseUrl: OPENCODE_GO_API_BASE_URL,
  };
}

function digitalOceanInferenceHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "digitalocean_inference",
    baseUrl: DIGITALOCEAN_INFERENCE_API_BASE_URL,
  };
}

function snowflakeCortexHarnessInput(model: string, baseUrl: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "snowflake_cortex",
    baseUrl,
  };
}

function minimaxTokenHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "minimax_token",
    baseUrl: MINIMAX_TOKEN_API_BASE_URL,
  };
}

function kimiCodeHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "kimi_code",
    baseUrl: KIMI_CODE_API_BASE_URL,
  };
}

function poeHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "poe",
    baseUrl: POE_API_BASE_URL,
  };
}

function opencodeZenHarnessInput(model: string) {
  return {
    source: "provider" as const,
    model,
    provider: "openai_compatible" as const,
    transport: "opencode_zen",
    baseUrl: OPENCODE_ZEN_API_BASE_URL,
  };
}

export async function listModelCatalog(
  db: AppDatabase,
  llm: LlmManager,
  core?: CoreDatabase,
  userId?: string
): Promise<{ models: CatalogModel[]; active: CatalogModel | null }> {
  const agent = getAgent(db, "intelligence");
  const models: CatalogModel[] = [];

  const local = llm.scanModels().filter((m) => !m.isMmproj && !isEmbeddingGguf(m.name));
  const localStatus = llm.getStatus();
  for (const m of local) {
    const active =
      agent?.backend === "local" &&
      localStatus.state === "running" &&
      (agent.modelPath === m.path || localStatus.modelPath === m.path);
    models.push({
      id: `local:${m.path}`,
      source: "local",
      label: m.name.replace(/\.gguf$/i, ""),
      path: m.path,
      multimodal: m.isMultimodal,
      active,
    });
  }

  if (isCursorSubscriptionReady(db, agent?.id ?? "intelligence")) {
    try {
      const cursorModels = listCursorSubscriptionModelsForCatalog(
        db,
        agent?.id ?? "intelligence"
      );
      for (const m of cursorModels) {
        const harness = resolveHarnessProfile({ source: "cursor", model: m.id });
        models.push({
          id: `cursor:${m.id}`,
          source: "cursor",
          label: m.label || m.id,
          model: m.id,
          active: agent?.backend === "cursor_cloud" && agent.config?.model === m.id,
          harnessProfileId: harness.id,
        });
      }
    } catch {
      /* key missing / SDK error - omit Cursor section */
    }
  }

  const catalogAgentId = agent?.id ?? "intelligence";
  const secrets = [
    ...listSecrets(db, { kind: "platform" }),
    ...listSecrets(db, { kind: "agent", agentId: catalogAgentId }),
  ].filter(
    (s) =>
      s.name !== "cursor_api_key" &&
      s.name !== OPENAI_API_KEY_SECRET_NAME &&
      !isOpenAiVaultSecretId(s.id) &&
      s.name !== ANTHROPIC_API_KEY_SECRET_NAME &&
      !isAnthropicVaultSecretId(s.id) &&
      s.name !== OPENROUTER_API_KEY_SECRET_NAME &&
      !isOpenRouterVaultSecretId(s.id) &&
      s.name !== GROQ_API_KEY_SECRET_NAME &&
      !isGroqVaultSecretId(s.id) &&
      s.name !== TOGETHER_API_KEY_SECRET_NAME &&
      !isTogetherVaultSecretId(s.id) &&
      s.name !== FIREWORKS_API_KEY_SECRET_NAME &&
      !isFireworksVaultSecretId(s.id) &&
      s.name !== DEEPSEEK_API_KEY_SECRET_NAME &&
      !isDeepSeekVaultSecretId(s.id) &&
      s.name !== GOOGLE_AI_API_KEY_SECRET_NAME &&
      !isGoogleAiVaultSecretId(s.id) &&
      s.name !== XAI_API_KEY_SECRET_NAME &&
      !isXaiVaultSecretId(s.id) &&
      s.name !== ZAI_API_KEY_SECRET_NAME &&
      !isZaiVaultSecretId(s.id) &&
      s.name !== MINIMAX_API_KEY_SECRET_NAME &&
      !isMinimaxVaultSecretId(s.id) &&
      s.name !== CUSTOM_OPENAI_API_KEY_SECRET_NAME &&
      s.name !== CUSTOM_OPENAI_BASE_URL_SECRET_NAME &&
      !isCustomOpenAiVaultSecretId(s.id) &&
      s.name !== ZAI_CODING_API_KEY_SECRET_NAME &&
      !isZaiCodingVaultSecretId(s.id) &&
      s.name !== OPENCODE_GO_API_KEY_SECRET_NAME &&
      !isOpencodeGoVaultSecretId(s.id) &&
      s.name !== DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME &&
      !isDigitalOceanInferenceVaultSecretId(s.id) &&
      s.name !== SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME &&
      s.name !== SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME &&
      !isSnowflakeCortexVaultSecretId(s.id) &&
      s.name !== MINIMAX_TOKEN_API_KEY_SECRET_NAME &&
      !isMinimaxTokenVaultSecretId(s.id) &&
      s.name !== KIMI_CODE_API_KEY_SECRET_NAME &&
      !isKimiCodeVaultSecretId(s.id) &&
      s.name !== POE_API_KEY_SECRET_NAME &&
      !isPoeVaultSecretId(s.id) &&
      s.name !== OPENCODE_ZEN_API_KEY_SECRET_NAME &&
      !isOpencodeZenVaultSecretId(s.id)
  );
  const hasOpenAi =
    isOpenAiPlatformReady(db, catalogAgentId) ||
    secrets.some((s) => secretLooksLike(s.name, "openai") || secretLooksLike(s.name, "gpt"));
  const hasAnthropic =
    isAnthropicPlatformReady(db, catalogAgentId) ||
    secrets.some(
      (s) => secretLooksLike(s.name, "anthropic") || secretLooksLike(s.name, "claude")
    );
  const hasOpenRouter = isOpenRouterPlatformReady(db, catalogAgentId);
  const hasGroq = isGroqPlatformReady(db, catalogAgentId);
  const hasTogether = isTogetherPlatformReady(db, catalogAgentId);
  const hasFireworks = isFireworksPlatformReady(db, catalogAgentId);
  const hasDeepSeek = isDeepSeekPlatformReady(db, catalogAgentId);
  const hasGoogleAi = isGoogleAiPlatformReady(db, catalogAgentId);
  const hasXai = isXaiPlatformReady(db, catalogAgentId);
  const hasZai = isZaiPlatformReady(db, catalogAgentId);
  const hasMinimax = isMinimaxPlatformReady(db, catalogAgentId);
  const hasZaiCoding = isZaiCodingPlatformReady(db, catalogAgentId);
  const hasOpencodeGo = isOpencodeGoPlatformReady(db, catalogAgentId);
  const hasDigitalOceanInference = isDigitalOceanInferencePlatformReady(
    db,
    catalogAgentId
  );
  const hasSnowflakeCortex = isSnowflakeCortexPlatformReady(db, catalogAgentId);
  const hasMinimaxToken = isMinimaxTokenPlatformReady(db, catalogAgentId);
  const hasKimiCode = isKimiCodePlatformReady(db, catalogAgentId);
  const hasPoe = isPoePlatformReady(db, catalogAgentId);
  const hasOpencodeZen = isOpencodeZenPlatformReady(db, catalogAgentId);

  if (hasOpenAi) {
    for (const m of OPENAI_CATALOG) {
      const harness = resolveHarnessProfile({
        source: "provider",
        model: m.id,
        provider: "openai",
      });
      models.push({
        id: `provider:openai:${m.id}`,
        source: "provider",
        label: m.label,
        model: m.id,
        provider: "openai",
        active:
          agent?.backend === "provider" &&
          (agent.config?.provider ?? "openai") === "openai" &&
          agent.config?.model === m.id,
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasAnthropic) {
    for (const m of ANTHROPIC_CATALOG) {
      const harness = resolveHarnessProfile({
        source: "provider",
        model: m.id,
        provider: "anthropic",
      });
      models.push({
        id: `provider:anthropic:${m.id}`,
        source: "provider",
        label: m.label,
        model: m.id,
        provider: "anthropic",
        active:
          agent?.backend === "provider" &&
          agent.config?.provider === "anthropic" &&
          agent.config?.model === m.id,
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasOpenRouter) {
    const agentIsOpenRouter =
      agent?.backend === "provider" && isOpenRouterAgentConfig(agent.config);
    for (const m of OPENROUTER_TOP10_CATALOG) {
      const harness = resolveHarnessProfile(openRouterHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:${m.id}`,
        source: "provider",
        label: `OpenRouter · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "openrouter",
        active: Boolean(agentIsOpenRouter && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasGroq) {
    const agentIsGroq =
      agent?.backend === "provider" && isGroqAgentConfig(agent.config);
    for (const m of GROQ_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(groqHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:groq:${m.id}`,
        source: "provider",
        label: `Groq · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "groq",
        active: Boolean(agentIsGroq && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasTogether) {
    const agentIsTogether =
      agent?.backend === "provider" && isTogetherAgentConfig(agent.config);
    for (const m of TOGETHER_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(togetherHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:together:${m.id}`,
        source: "provider",
        label: `Together · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "together",
        active: Boolean(agentIsTogether && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasFireworks) {
    const agentIsFireworks =
      agent?.backend === "provider" && isFireworksAgentConfig(agent.config);
    for (const m of FIREWORKS_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(fireworksHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:fireworks:${m.id}`,
        source: "provider",
        label: `Fireworks · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "fireworks",
        active: Boolean(agentIsFireworks && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasDeepSeek) {
    const agentIsDeepSeek =
      agent?.backend === "provider" && isDeepSeekAgentConfig(agent.config);
    for (const m of DEEPSEEK_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(deepseekHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:deepseek:${m.id}`,
        source: "provider",
        label: `DeepSeek · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "deepseek",
        active: Boolean(agentIsDeepSeek && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasGoogleAi) {
    const agentIsGoogleAi =
      agent?.backend === "provider" && isGoogleAiAgentConfig(agent.config);
    for (const m of GOOGLE_AI_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(googleAiHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:google_ai:${m.id}`,
        source: "provider",
        label: `Google AI · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "google_ai",
        active: Boolean(agentIsGoogleAi && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasXai) {
    const agentIsXai =
      agent?.backend === "provider" && isXaiAgentConfig(agent.config);
    for (const m of XAI_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(xaiHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:xai:${m.id}`,
        source: "provider",
        label: `xAI · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "xai",
        active: Boolean(agentIsXai && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasZai) {
    const agentIsZai =
      agent?.backend === "provider" && isZaiAgentConfig(agent.config);
    for (const m of ZAI_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(zaiHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:zai:${m.id}`,
        source: "provider",
        label: `Z.AI · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "zai",
        active: Boolean(agentIsZai && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasMinimax) {
    const agentIsMinimax =
      agent?.backend === "provider" && isMinimaxAgentConfig(agent.config);
    for (const m of MINIMAX_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(minimaxHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:minimax:${m.id}`,
        source: "provider",
        label: `MiniMax · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "minimax",
        active: Boolean(agentIsMinimax && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasZaiCoding) {
    const agentIsZai =
      agent?.backend === "provider" && isZaiCodingAgentConfig(agent.config);
    for (const m of ZAI_CODING_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(zaiCodingHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:zai_coding:${m.id}`,
        source: "provider",
        label: `Z.AI Coding · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "zai_coding",
        active: Boolean(agentIsZai && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasOpencodeGo) {
    const agentIsOc =
      agent?.backend === "provider" && isOpencodeGoAgentConfig(agent.config);
    for (const m of OPENCODE_GO_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(opencodeGoHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:opencode_go:${m.id}`,
        source: "provider",
        label: `OpenCode Go · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "opencode_go",
        active: Boolean(agentIsOc && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasDigitalOceanInference) {
    const agentIsDo =
      agent?.backend === "provider" &&
      isDigitalOceanInferenceAgentConfig(agent.config);
    for (const m of DIGITALOCEAN_INFERENCE_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(
        digitalOceanInferenceHarnessInput(m.id)
      );
      models.push({
        id: `provider:openai_compatible:digitalocean_inference:${m.id}`,
        source: "provider",
        label: `DigitalOcean · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "digitalocean_inference",
        active: Boolean(agentIsDo && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasSnowflakeCortex) {
    const cortexBase =
      resolveSnowflakeCortexBaseUrl(db, catalogAgentId) ??
      "https://example.snowflakecomputing.com/api/v2/cortex/v1";
    const agentIsSf =
      agent?.backend === "provider" && isSnowflakeCortexAgentConfig(agent.config);
    for (const m of SNOWFLAKE_CORTEX_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(
        snowflakeCortexHarnessInput(m.id, cortexBase)
      );
      models.push({
        id: `provider:openai_compatible:snowflake_cortex:${m.id}`,
        source: "provider",
        label: `Snowflake Cortex · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "snowflake_cortex",
        active: Boolean(agentIsSf && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasMinimaxToken) {
    const agentIsMt =
      agent?.backend === "provider" && isMinimaxTokenAgentConfig(agent.config);
    for (const m of MINIMAX_TOKEN_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(minimaxTokenHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:minimax_token:${m.id}`,
        source: "provider",
        label: `MiniMax Token · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "minimax_token",
        active: Boolean(agentIsMt && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasKimiCode) {
    const agentIsKc =
      agent?.backend === "provider" && isKimiCodeAgentConfig(agent.config);
    for (const m of KIMI_CODE_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(kimiCodeHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:kimi_code:${m.id}`,
        source: "provider",
        label: `Kimi Code · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "kimi_code",
        active: Boolean(agentIsKc && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasPoe) {
    const agentIsPoe =
      agent?.backend === "provider" && isPoeAgentConfig(agent.config);
    for (const m of POE_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(poeHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:poe:${m.id}`,
        source: "provider",
        label: `Poe · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "poe",
        active: Boolean(agentIsPoe && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }
  if (hasOpencodeZen) {
    const agentIsOz =
      agent?.backend === "provider" && isOpencodeZenAgentConfig(agent.config);
    for (const m of OPENCODE_ZEN_CHAT_CATALOG) {
      const harness = resolveHarnessProfile(opencodeZenHarnessInput(m.id));
      models.push({
        id: `provider:openai_compatible:opencode_zen:${m.id}`,
        source: "provider",
        label: `OpenCode Zen · ${m.label}`,
        model: m.id,
        provider: "openai_compatible",
        transport: "opencode_zen",
        active: Boolean(agentIsOz && agent.config?.model === m.id),
        harnessProfileId: harness.id,
      });
    }
  }

  // Keep configured provider model visible even if not in the static list.
  if (
    agent?.backend === "provider" &&
    agent.config?.model &&
    !models.some((m) => m.source === "provider" && m.model === agent.config?.model)
  ) {
    const provider =
      (agent.config.provider as "openai" | "anthropic" | "openai_compatible") ?? "openai";
    const model = String(agent.config.model);
    const isOr = isOpenRouterAgentConfig(agent.config);
    const isGq = isGroqAgentConfig(agent.config);
    const isTg = isTogetherAgentConfig(agent.config);
    const isFw = isFireworksAgentConfig(agent.config);
    const isDs = isDeepSeekAgentConfig(agent.config);
    const isGa = isGoogleAiAgentConfig(agent.config);
    const isXaiCfg = isXaiAgentConfig(agent.config);
    const isZaiPayg = isZaiAgentConfig(agent.config);
    const isMinimax = isMinimaxAgentConfig(agent.config);
    const isMinimaxToken = isMinimaxTokenAgentConfig(agent.config);
    const isKimiCode = isKimiCodeAgentConfig(agent.config);
    const isPoe = isPoeAgentConfig(agent.config);
    const isOcZen = isOpencodeZenAgentConfig(agent.config);
    const isCustom = isCustomOpenAiAgentConfig(agent.config);
    const isZai = isZaiCodingAgentConfig(agent.config);
    const isOcGo = isOpencodeGoAgentConfig(agent.config);
    const isDoInf = isDigitalOceanInferenceAgentConfig(agent.config);
    const isSfCortex = isSnowflakeCortexAgentConfig(agent.config);
    const customBase =
      typeof agent.config.baseUrl === "string"
        ? agent.config.baseUrl
        : resolveCustomOpenAiBaseUrl(db, catalogAgentId) ?? "";
    const snowflakeBase =
      typeof agent.config.baseUrl === "string"
        ? agent.config.baseUrl
        : resolveSnowflakeCortexBaseUrl(db, catalogAgentId) ?? "";
    const harness = isOr
      ? resolveHarnessProfile(openRouterHarnessInput(model))
      : isGq
        ? resolveHarnessProfile(groqHarnessInput(model))
        : isTg
          ? resolveHarnessProfile(togetherHarnessInput(model))
          : isFw
            ? resolveHarnessProfile(fireworksHarnessInput(model))
            : isDs
              ? resolveHarnessProfile(deepseekHarnessInput(model))
              : isGa
                ? resolveHarnessProfile(googleAiHarnessInput(model))
                : isXaiCfg
                  ? resolveHarnessProfile(xaiHarnessInput(model))
                  : isZai
                    ? resolveHarnessProfile(zaiCodingHarnessInput(model))
                    : isOcGo
                      ? resolveHarnessProfile(opencodeGoHarnessInput(model))
                    : isDoInf
                      ? resolveHarnessProfile(
                          digitalOceanInferenceHarnessInput(model)
                        )
                    : isSfCortex && snowflakeBase
                      ? resolveHarnessProfile(
                          snowflakeCortexHarnessInput(model, snowflakeBase)
                        )
                    : isMinimaxToken
                      ? resolveHarnessProfile(minimaxTokenHarnessInput(model))
                    : isKimiCode
                      ? resolveHarnessProfile(kimiCodeHarnessInput(model))
                    : isPoe
                      ? resolveHarnessProfile(poeHarnessInput(model))
                    : isOcZen
                      ? resolveHarnessProfile(opencodeZenHarnessInput(model))
                    : isZaiPayg
                      ? resolveHarnessProfile(zaiHarnessInput(model))
                      : isMinimax
                        ? resolveHarnessProfile(minimaxHarnessInput(model))
                        : isCustom && customBase
                          ? resolveHarnessProfile(
                              customOpenAiHarnessInput(model, customBase)
                            )
                          : resolveHarnessProfile({
                              source: "provider",
                              model,
                              provider,
                            });
    const namespacedTransport = isGq
      ? "groq"
      : isTg
        ? "together"
        : isFw
          ? "fireworks"
          : isDs
            ? "deepseek"
            : isGa
              ? "google_ai"
              : isXaiCfg
                ? "xai"
                : isZai
                  ? "zai_coding"
                  : isOcGo
                    ? "opencode_go"
                  : isDoInf
                    ? "digitalocean_inference"
                  : isSfCortex
                    ? "snowflake_cortex"
                  : isMinimaxToken
                    ? "minimax_token"
                  : isKimiCode
                    ? "kimi_code"
                  : isPoe
                    ? "poe"
                  : isOcZen
                    ? "opencode_zen"
                  : isZaiPayg
                    ? "zai"
                    : isMinimax
                      ? "minimax"
                      : isCustom
                        ? "custom_openai"
                        : null;
    models.push({
      id: namespacedTransport
        ? `provider:openai_compatible:${namespacedTransport}:${model}`
        : `provider:${provider}:${model}`,
      source: "provider",
      label: isOr
        ? `OpenRouter · ${model}`
        : namespacedTransport
          ? `${
              namespacedTransport === "groq"
                ? "Groq"
                : namespacedTransport === "together"
                  ? "Together"
                  : namespacedTransport === "fireworks"
                    ? "Fireworks"
                    : namespacedTransport === "deepseek"
                      ? "DeepSeek"
                      : namespacedTransport === "google_ai"
                        ? "Google AI"
                        : namespacedTransport === "xai"
                          ? "xAI"
                          : namespacedTransport === "zai"
                            ? "Z.AI"
                            : namespacedTransport === "minimax"
                              ? "MiniMax"
                              : namespacedTransport === "minimax_token"
                                ? "MiniMax Token"
                              : namespacedTransport === "kimi_code"
                                ? "Kimi Code"
                              : namespacedTransport === "poe"
                                ? "Poe"
                              : namespacedTransport === "opencode_zen"
                                ? "OpenCode Zen"
                              : namespacedTransport === "custom_openai"
                                ? "Custom"
                                : namespacedTransport === "opencode_go"
                                  ? "OpenCode Go"
                                : namespacedTransport === "digitalocean_inference"
                                  ? "DigitalOcean"
                                : namespacedTransport === "snowflake_cortex"
                                  ? "Snowflake Cortex"
                                : "Z.AI Coding"
            } · ${model}`
          : model,
      model,
      provider,
      transport: isOr ? "openrouter" : namespacedTransport ?? undefined,
      active: true,
      harnessProfileId: harness.id,
    });
  }

  if (core && userId) {
    try {
      const shared = listSharedModelsForUser(core, userId);
      for (const row of shared) {
        models.push({
          id: `remote:${row.endpointId}`,
          source: "remote",
          label: row.name || row.baseModelName || row.endpointId,
          endpointId: row.endpointId,
          active: agent?.backend === "remote" && agent.config?.endpointId === row.endpointId,
        });
      }
    } catch {
      /* share tables may not exist */
    }
  }

  const active = models.find((m) => m.active) ?? null;
  if (active) {
    const profile = resolveHarnessProfile({
      source: active.source,
      path: active.path,
      model: active.model,
      provider: active.provider,
      ...(active.transport === "openrouter"
        ? { transport: "openrouter", baseUrl: OPENROUTER_API_BASE_URL }
        : active.transport === "groq"
          ? { transport: "groq", baseUrl: GROQ_API_BASE_URL }
          : active.transport === "together"
            ? { transport: "together", baseUrl: TOGETHER_API_BASE_URL }
            : active.transport === "fireworks"
              ? { transport: "fireworks", baseUrl: FIREWORKS_API_BASE_URL }
              : active.transport === "deepseek"
                ? { transport: "deepseek", baseUrl: DEEPSEEK_API_BASE_URL }
                : active.transport === "google_ai"
                  ? { transport: "google_ai", baseUrl: GOOGLE_AI_API_BASE_URL }
                  : active.transport === "xai"
                    ? { transport: "xai", baseUrl: XAI_API_BASE_URL }
                  : active.transport === "zai"
                    ? { transport: "zai", baseUrl: ZAI_API_BASE_URL }
                  : active.transport === "minimax"
                    ? { transport: "minimax", baseUrl: MINIMAX_API_BASE_URL }
                  : active.transport === "custom_openai"
                    ? {
                        transport: "custom_openai",
                        baseUrl:
                          resolveCustomOpenAiBaseUrl(db, "intelligence") ??
                          undefined,
                      }
                  : active.transport === "zai_coding"
                    ? { transport: "zai_coding", baseUrl: ZAI_CODING_API_BASE_URL }
                  : active.transport === "opencode_go"
                    ? { transport: "opencode_go", baseUrl: OPENCODE_GO_API_BASE_URL }
                  : active.transport === "digitalocean_inference"
                    ? {
                        transport: "digitalocean_inference",
                        baseUrl: DIGITALOCEAN_INFERENCE_API_BASE_URL,
                      }
                  : active.transport === "snowflake_cortex"
                    ? {
                        transport: "snowflake_cortex",
                        baseUrl:
                          resolveSnowflakeCortexBaseUrl(db, "intelligence") ??
                          undefined,
                      }
                  : active.transport === "minimax_token"
                    ? { transport: "minimax_token", baseUrl: MINIMAX_TOKEN_API_BASE_URL }
                  : active.transport === "kimi_code"
                    ? { transport: "kimi_code", baseUrl: KIMI_CODE_API_BASE_URL }
                  : active.transport === "poe"
                    ? { transport: "poe", baseUrl: POE_API_BASE_URL }
                  : active.transport === "opencode_zen"
                    ? { transport: "opencode_zen", baseUrl: OPENCODE_ZEN_API_BASE_URL }
                    : {}),
    });
    active.harnessProfileId = profile.id;
  }
  return { models, active };
}

export interface SelectModelInput {
  source: CatalogModelSource;
  path?: string;
  model?: string;
  provider?: "openai" | "anthropic" | "openai_compatible";
  endpointId?: string;
  apiKeyRef?: string;
  baseUrl?: string;
  transport?: string;
}

function applyProfileToAgentPatch(
  agent: NonNullable<ReturnType<typeof getAgent>>,
  profile: ModelHarnessProfile,
  configExtra: Record<string, unknown>
) {
  return {
    thinking: {
      ...agent.thinking,
      enableThinking: profile.enableThinkingDefault,
      nativeTools: profile.toolMode !== "none",
    },
    sampling: {
      ...agent.sampling,
      temperature: profile.sampling.temperature,
      topP: profile.sampling.topP,
      topK: profile.sampling.topK,
    },
    config: {
      ...agent.config,
      ...configExtra,
      harnessProfileId: profile.id,
      knowsUser: agent.config?.knowsUser !== false,
      codeAccess: agent.config?.codeAccess !== false,
    },
  };
}

export async function selectIntelligenceModel(
  db: AppDatabase,
  llm: LlmManager,
  input: SelectModelInput
): Promise<{ ok: true; active: CatalogModel }> {
  const agent = getAgent(db, "intelligence");
  if (!agent) throw new Error("Intelligence agent not found");

  if (input.source === "local") {
    const path = input.path?.trim();
    if (!path) throw new Error("Local model path required");
    const profile = resolveHarnessProfile({ source: "local", path });
    const patch = applyProfileToAgentPatch(agent, profile, {});
    updateAgent(db, "intelligence", {
      backend: "local",
      modelPath: path,
      ...patch,
    });
    const status = llm.getStatus();
    if (status.state === "running" && status.modelPath !== path) {
      await llm.restart(path);
    } else if (status.state !== "running") {
      await llm.start(path);
    }
    markLlmReady(db);
    return {
      ok: true,
      active: {
        id: `local:${path}`,
        source: "local",
        label: path.split(/[/\\]/).pop()?.replace(/\.gguf$/i, "") ?? path,
        path,
        active: true,
        harnessProfileId: profile.id,
      },
    };
  }

  if (input.source === "cursor") {
    if (!isCursorSubscriptionReady(db, "intelligence")) {
      throw new Error("Connect Cursor with an API key first");
    }
    const model = input.model?.trim() || "auto";
    const profile = resolveHarnessProfile({ source: "cursor", model });
    const patch = applyProfileToAgentPatch(agent, profile, { model });
    updateAgent(db, "intelligence", {
      backend: "cursor_cloud",
      ...patch,
    });
    markLlmReady(db);
    return {
      ok: true,
      active: {
        id: `cursor:${model}`,
        source: "cursor",
        label: formatCursorModelLabel(model),
        model,
        active: true,
        harnessProfileId: profile.id,
      },
    };
  }

  if (input.source === "provider") {
    const model = input.model?.trim();
    if (!model) throw new Error("Provider model id required");
    const provider = input.provider ?? "openai";
    const secrets = [
      ...listSecrets(db, { kind: "platform" }),
      ...listSecrets(db, { kind: "agent", agentId: "intelligence" }),
    ].filter(
      (s) =>
        s.name !== "cursor_api_key" &&
        s.name !== OPENAI_API_KEY_SECRET_NAME &&
        !isOpenAiVaultSecretId(s.id) &&
        s.name !== ANTHROPIC_API_KEY_SECRET_NAME &&
        !isAnthropicVaultSecretId(s.id) &&
        s.name !== OPENROUTER_API_KEY_SECRET_NAME &&
        !isOpenRouterVaultSecretId(s.id) &&
        s.name !== GROQ_API_KEY_SECRET_NAME &&
        !isGroqVaultSecretId(s.id) &&
        s.name !== TOGETHER_API_KEY_SECRET_NAME &&
        !isTogetherVaultSecretId(s.id) &&
        s.name !== FIREWORKS_API_KEY_SECRET_NAME &&
        !isFireworksVaultSecretId(s.id) &&
        s.name !== DEEPSEEK_API_KEY_SECRET_NAME &&
        !isDeepSeekVaultSecretId(s.id) &&
        s.name !== GOOGLE_AI_API_KEY_SECRET_NAME &&
        !isGoogleAiVaultSecretId(s.id) &&
        s.name !== XAI_API_KEY_SECRET_NAME &&
        !isXaiVaultSecretId(s.id) &&
        s.name !== ZAI_API_KEY_SECRET_NAME &&
        !isZaiVaultSecretId(s.id) &&
        s.name !== MINIMAX_API_KEY_SECRET_NAME &&
        !isMinimaxVaultSecretId(s.id) &&
        s.name !== CUSTOM_OPENAI_API_KEY_SECRET_NAME &&
        s.name !== CUSTOM_OPENAI_BASE_URL_SECRET_NAME &&
        !isCustomOpenAiVaultSecretId(s.id) &&
        s.name !== ZAI_CODING_API_KEY_SECRET_NAME &&
        !isZaiCodingVaultSecretId(s.id) &&
        s.name !== OPENCODE_GO_API_KEY_SECRET_NAME &&
        !isOpencodeGoVaultSecretId(s.id) &&
        s.name !== DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME &&
        !isDigitalOceanInferenceVaultSecretId(s.id) &&
        s.name !== SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME &&
        s.name !== SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME &&
        !isSnowflakeCortexVaultSecretId(s.id) &&
        s.name !== MINIMAX_TOKEN_API_KEY_SECRET_NAME &&
        !isMinimaxTokenVaultSecretId(s.id) &&
        s.name !== KIMI_CODE_API_KEY_SECRET_NAME &&
        !isKimiCodeVaultSecretId(s.id) &&
        s.name !== POE_API_KEY_SECRET_NAME &&
        !isPoeVaultSecretId(s.id) &&
        s.name !== OPENCODE_ZEN_API_KEY_SECRET_NAME &&
        !isOpencodeZenVaultSecretId(s.id)
    );
    const openAiReady = isOpenAiPlatformReady(db, "intelligence");
    const anthropicReady = isAnthropicPlatformReady(db, "intelligence");
    const openRouterReady = isOpenRouterPlatformReady(db, "intelligence");
    const groqReady = isGroqPlatformReady(db, "intelligence");
    const togetherReady = isTogetherPlatformReady(db, "intelligence");
    const fireworksReady = isFireworksPlatformReady(db, "intelligence");
    const deepseekReady = isDeepSeekPlatformReady(db, "intelligence");
    const googleAiReady = isGoogleAiPlatformReady(db, "intelligence");
    const xaiReady = isXaiPlatformReady(db, "intelligence");
    const zaiReady = isZaiPlatformReady(db, "intelligence");
    const minimaxReady = isMinimaxPlatformReady(db, "intelligence");
    const customOpenAiReady = isCustomOpenAiPlatformReady(db, "intelligence");
    const zaiCodingReady = isZaiCodingPlatformReady(db, "intelligence");
    const opencodeGoReady = isOpencodeGoPlatformReady(db, "intelligence");
    const digitalOceanInferenceReady = isDigitalOceanInferencePlatformReady(
      db,
      "intelligence"
    );
    const snowflakeCortexReady = isSnowflakeCortexPlatformReady(
      db,
      "intelligence"
    );
    const minimaxTokenReady = isMinimaxTokenPlatformReady(db, "intelligence");
    const kimiCodeReady = isKimiCodePlatformReady(db, "intelligence");
    const poeReady = isPoePlatformReady(db, "intelligence");
    const opencodeZenReady = isOpencodeZenPlatformReady(db, "intelligence");

    let preferredId: string | undefined;
    let compatibleTransport:
      | "openrouter"
      | "groq"
      | "together"
      | "fireworks"
      | "deepseek"
      | "google_ai"
      | "xai"
      | "zai"
      | "minimax"
      | "custom_openai"
      | "zai_coding"
      | "opencode_go"
      | "digitalocean_inference"
      | "snowflake_cortex"
      | "minimax_token"
      | "kimi_code"
      | "poe"
      | "opencode_zen"
      | null = null;
    if (provider === "openai") {
      if (openAiReady) {
        preferredId = OPENAI_API_KEY_SECRET_ID;
      } else {
        preferredId = secrets.find(
          (s) => secretLooksLike(s.name, "openai") || secretLooksLike(s.name, "gpt")
        )?.id;
      }
      if (!preferredId) {
        throw new Error("Connect OpenAI Platform in Vault before using OpenAI models");
      }
    } else if (provider === "anthropic") {
      if (anthropicReady) {
        preferredId = ANTHROPIC_API_KEY_SECRET_ID;
      } else {
        preferredId = secrets.find(
          (s) => secretLooksLike(s.name, "anthropic") || secretLooksLike(s.name, "claude")
        )?.id;
      }
      if (!preferredId) {
        throw new Error("Connect Anthropic Console in Vault before using Anthropic models");
      }
    } else if (provider === "openai_compatible") {
      const transport = (input.transport ?? "").toLowerCase();
      const base = (input.baseUrl ?? "").toLowerCase();
      const keyHint = input.apiKeyRef ?? "";
      const wantsOpenRouter =
        transport === "openrouter" ||
        base.includes("openrouter.ai") ||
        keyHint === OPENROUTER_API_KEY_SECRET_ID;
      const wantsGroq =
        transport === "groq" ||
        base.includes("api.groq.com") ||
        keyHint === GROQ_API_KEY_SECRET_ID;
      const wantsTogether =
        transport === "together" ||
        base.includes("api.together.ai") ||
        base.includes("api.together.xyz") ||
        keyHint === TOGETHER_API_KEY_SECRET_ID;
      const wantsFireworks =
        transport === "fireworks" ||
        base.includes("api.fireworks.ai") ||
        keyHint === FIREWORKS_API_KEY_SECRET_ID;
      const wantsDeepSeek =
        transport === "deepseek" ||
        base.includes("api.deepseek.com") ||
        keyHint === DEEPSEEK_API_KEY_SECRET_ID;
      const wantsGoogleAi =
        transport === "google_ai" ||
        base.includes("generativelanguage.googleapis.com") ||
        keyHint === GOOGLE_AI_API_KEY_SECRET_ID;
      const wantsXai =
        transport === "xai" ||
        base.includes("api.x.ai") ||
        keyHint === XAI_API_KEY_SECRET_ID;
      const wantsZaiCoding =
        transport === "zai_coding" ||
        base.includes("api.z.ai/api/coding/") ||
        keyHint === ZAI_CODING_API_KEY_SECRET_ID;
      const wantsOpencodeGo =
        transport === "opencode_go" ||
        base.includes("opencode.ai/zen/go") ||
        keyHint === OPENCODE_GO_API_KEY_SECRET_ID;
      const wantsDigitalOceanInference =
        transport === "digitalocean_inference" ||
        base.includes("inference.do-ai.run") ||
        keyHint === DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID;
      const wantsSnowflakeCortex =
        transport === "snowflake_cortex" ||
        (base.includes("snowflakecomputing.com") &&
          base.includes("/api/v2/cortex")) ||
        keyHint === SNOWFLAKE_CORTEX_API_KEY_SECRET_ID;
      const wantsMinimaxToken =
        transport === "minimax_token" ||
        keyHint === MINIMAX_TOKEN_API_KEY_SECRET_ID;
      const wantsKimiCode =
        transport === "kimi_code" ||
        base.includes("api.kimi.com/coding") ||
        keyHint === KIMI_CODE_API_KEY_SECRET_ID;
      const wantsPoe =
        transport === "poe" ||
        base.includes("api.poe.com") ||
        keyHint === POE_API_KEY_SECRET_ID;
      const wantsOpencodeZen =
        transport === "opencode_zen" ||
        (base.includes("opencode.ai/zen") && !base.includes("opencode.ai/zen/go")) ||
        keyHint === OPENCODE_ZEN_API_KEY_SECRET_ID;
      const wantsZai =
        transport === "zai" ||
        (base.includes("api.z.ai/api/paas") && !base.includes("/api/coding/")) ||
        keyHint === ZAI_API_KEY_SECRET_ID;
      const wantsMinimax =
        transport === "minimax" ||
        keyHint === MINIMAX_API_KEY_SECRET_ID ||
        (base.includes("api.minimax.io") &&
          transport !== "minimax_token" &&
          keyHint !== MINIMAX_TOKEN_API_KEY_SECRET_ID);
      const wantsCustomOpenAi =
        transport === "custom_openai" ||
        keyHint === CUSTOM_OPENAI_API_KEY_SECRET_ID;
      if (wantsOpenRouter) {
        if (!openRouterReady) {
          throw new Error("Connect OpenRouter in Vault before using OpenRouter models");
        }
        preferredId = OPENROUTER_API_KEY_SECRET_ID;
        compatibleTransport = "openrouter";
      } else if (wantsGroq) {
        if (!groqReady) {
          throw new Error("Connect Groq in Vault before using Groq models");
        }
        preferredId = GROQ_API_KEY_SECRET_ID;
        compatibleTransport = "groq";
      } else if (wantsTogether) {
        if (!togetherReady) {
          throw new Error("Connect Together in Vault before using Together models");
        }
        preferredId = TOGETHER_API_KEY_SECRET_ID;
        compatibleTransport = "together";
      } else if (wantsFireworks) {
        if (!fireworksReady) {
          throw new Error("Connect Fireworks in Vault before using Fireworks models");
        }
        preferredId = FIREWORKS_API_KEY_SECRET_ID;
        compatibleTransport = "fireworks";
      } else if (wantsDeepSeek) {
        if (!deepseekReady) {
          throw new Error("Connect DeepSeek in Vault before using DeepSeek models");
        }
        preferredId = DEEPSEEK_API_KEY_SECRET_ID;
        compatibleTransport = "deepseek";
      } else if (wantsGoogleAi) {
        if (!googleAiReady) {
          throw new Error(
            "Connect Google AI Studio in Vault before using Gemini models"
          );
        }
        preferredId = GOOGLE_AI_API_KEY_SECRET_ID;
        compatibleTransport = "google_ai";
      } else if (wantsXai) {
        if (!xaiReady) {
          throw new Error("Connect xAI Console in Vault before using xAI models");
        }
        preferredId = XAI_API_KEY_SECRET_ID;
        compatibleTransport = "xai";
      } else if (wantsZaiCoding) {
        if (!zaiCodingReady) {
          throw new Error(
            "Connect Z.AI GLM Coding Plan in Vault before using Coding Plan models"
          );
        }
        preferredId = ZAI_CODING_API_KEY_SECRET_ID;
        compatibleTransport = "zai_coding";
      } else if (wantsOpencodeGo) {
        if (!opencodeGoReady) {
          throw new Error("Connect OpenCode Go in Vault before using OpenCode Go models");
        }
        preferredId = OPENCODE_GO_API_KEY_SECRET_ID;
        compatibleTransport = "opencode_go";
      } else if (wantsDigitalOceanInference) {
        if (!digitalOceanInferenceReady) {
          throw new Error(
            "Connect DigitalOcean Inference in Vault before using DigitalOcean models"
          );
        }
        preferredId = DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID;
        compatibleTransport = "digitalocean_inference";
      } else if (wantsSnowflakeCortex) {
        if (!snowflakeCortexReady) {
          throw new Error(
            "Connect Snowflake Cortex in Vault before using Cortex models"
          );
        }
        preferredId = SNOWFLAKE_CORTEX_API_KEY_SECRET_ID;
        compatibleTransport = "snowflake_cortex";
      } else if (wantsMinimaxToken) {
        if (!minimaxTokenReady) {
          throw new Error(
            "Connect MiniMax Token Plan in Vault before using Token Plan models"
          );
        }
        preferredId = MINIMAX_TOKEN_API_KEY_SECRET_ID;
        compatibleTransport = "minimax_token";
      } else if (wantsKimiCode) {
        if (!kimiCodeReady) {
          throw new Error("Connect Kimi Code in Vault before using Kimi Code models");
        }
        preferredId = KIMI_CODE_API_KEY_SECRET_ID;
        compatibleTransport = "kimi_code";
      } else if (wantsPoe) {
        if (!poeReady) {
          throw new Error("Connect Poe in Vault before using Poe models");
        }
        preferredId = POE_API_KEY_SECRET_ID;
        compatibleTransport = "poe";
      } else if (wantsOpencodeZen) {
        if (!opencodeZenReady) {
          throw new Error("Connect OpenCode Zen in Vault before using OpenCode Zen models");
        }
        preferredId = OPENCODE_ZEN_API_KEY_SECRET_ID;
        compatibleTransport = "opencode_zen";
      } else if (wantsZai) {
        if (!zaiReady) {
          throw new Error("Connect Z.AI Platform in Vault before using Z.AI models");
        }
        preferredId = ZAI_API_KEY_SECRET_ID;
        compatibleTransport = "zai";
      } else if (wantsMinimax) {
        if (!minimaxReady) {
          throw new Error("Connect MiniMax in Vault before using MiniMax models");
        }
        preferredId = MINIMAX_API_KEY_SECRET_ID;
        compatibleTransport = "minimax";
      } else if (wantsCustomOpenAi) {
        if (!customOpenAiReady) {
          throw new Error(
            "Connect a custom OpenAI-compatible endpoint in Vault before using it"
          );
        }
        preferredId = CUSTOM_OPENAI_API_KEY_SECRET_ID;
        compatibleTransport = "custom_openai";
      } else {
        preferredId =
          secrets.find(
            (s) => secretLooksLike(s.name, "openai") || secretLooksLike(s.name, "gpt")
          )?.id ?? secrets[0]?.id;
        if (!preferredId) {
          throw new Error("Add an API key in Vault → Inference before using cloud provider models");
        }
      }
    } else {
      preferredId =
        secrets.find(
          (s) => secretLooksLike(s.name, "openai") || secretLooksLike(s.name, "gpt")
        )?.id ?? secrets[0]?.id;
      if (!preferredId) {
        throw new Error("Add an API key in Vault → Inference before using cloud provider models");
      }
    }

    const apiKeyRef = input.apiKeyRef || agent.config?.apiKeyRef || preferredId;
    const transportBase =
      compatibleTransport === "openrouter"
        ? { transport: "openrouter" as const, baseUrl: OPENROUTER_API_BASE_URL }
        : compatibleTransport === "groq"
          ? { transport: "groq" as const, baseUrl: GROQ_API_BASE_URL }
          : compatibleTransport === "together"
            ? { transport: "together" as const, baseUrl: TOGETHER_API_BASE_URL }
            : compatibleTransport === "fireworks"
              ? { transport: "fireworks" as const, baseUrl: FIREWORKS_API_BASE_URL }
              : compatibleTransport === "deepseek"
                ? { transport: "deepseek" as const, baseUrl: DEEPSEEK_API_BASE_URL }
                : compatibleTransport === "google_ai"
                  ? {
                      transport: "google_ai" as const,
                      baseUrl: GOOGLE_AI_API_BASE_URL,
                    }
                  : compatibleTransport === "xai"
                    ? {
                        transport: "xai" as const,
                        baseUrl: XAI_API_BASE_URL,
                      }
                  : compatibleTransport === "zai"
                    ? {
                        transport: "zai" as const,
                        baseUrl: ZAI_API_BASE_URL,
                      }
                  : compatibleTransport === "minimax"
                    ? {
                        transport: "minimax" as const,
                        baseUrl: MINIMAX_API_BASE_URL,
                      }
                  : compatibleTransport === "custom_openai"
                    ? (() => {
                        const url = resolveCustomOpenAiBaseUrl(db, "intelligence");
                        if (!url) {
                          throw new Error(
                            "Custom OpenAI-compatible base URL is missing from Vault"
                          );
                        }
                        return {
                          transport: "custom_openai" as const,
                          baseUrl: url,
                        };
                      })()
                  : compatibleTransport === "zai_coding"
                    ? {
                        transport: "zai_coding" as const,
                        baseUrl: ZAI_CODING_API_BASE_URL,
                      }
                  : compatibleTransport === "opencode_go"
                    ? {
                        transport: "opencode_go" as const,
                        baseUrl: OPENCODE_GO_API_BASE_URL,
                      }
                  : compatibleTransport === "digitalocean_inference"
                    ? {
                        transport: "digitalocean_inference" as const,
                        baseUrl: DIGITALOCEAN_INFERENCE_API_BASE_URL,
                      }
                  : compatibleTransport === "snowflake_cortex"
                    ? (() => {
                        const url = resolveSnowflakeCortexBaseUrl(
                          db,
                          "intelligence"
                        );
                        if (!url) {
                          throw new Error(
                            "Snowflake Cortex base URL is missing from Vault"
                          );
                        }
                        return {
                          transport: "snowflake_cortex" as const,
                          baseUrl: url,
                        };
                      })()
                  : compatibleTransport === "minimax_token"
                    ? {
                        transport: "minimax_token" as const,
                        baseUrl: MINIMAX_TOKEN_API_BASE_URL,
                      }
                  : compatibleTransport === "kimi_code"
                    ? {
                        transport: "kimi_code" as const,
                        baseUrl: KIMI_CODE_API_BASE_URL,
                      }
                  : compatibleTransport === "poe"
                    ? {
                        transport: "poe" as const,
                        baseUrl: POE_API_BASE_URL,
                      }
                  : compatibleTransport === "opencode_zen"
                    ? {
                        transport: "opencode_zen" as const,
                        baseUrl: OPENCODE_ZEN_API_BASE_URL,
                      }
                    : null;
    const profile = resolveHarnessProfile({
      source: "provider",
      model,
      provider,
      ...(transportBase ?? {}),
    });
    const clearFlags = {
      openrouter: undefined,
      groq: undefined,
      together: undefined,
      fireworks: undefined,
      deepseek: undefined,
      googleAi: undefined,
      xai: undefined,
      zai: undefined,
      minimax: undefined,
      customOpenai: undefined,
      zaiCoding: undefined,
      opencodeGo: undefined,
      digitaloceanInference: undefined,
      snowflakeCortex: undefined,
      minimaxToken: undefined,
      kimiCode: undefined,
      poe: undefined,
      opencodeZen: undefined,
    };
    const patch = applyProfileToAgentPatch(agent, profile, {
      provider,
      model,
      apiKeyRef,
      ...(transportBase
        ? {
            ...clearFlags,
            baseUrl: transportBase.baseUrl,
            transport: transportBase.transport,
            ...(transportBase.transport === "openrouter"
              ? { openrouter: true }
              : transportBase.transport === "zai_coding"
                ? { zaiCoding: true }
                : transportBase.transport === "opencode_go"
                  ? { opencodeGo: true }
                : transportBase.transport === "digitalocean_inference"
                  ? { digitaloceanInference: true }
                : transportBase.transport === "snowflake_cortex"
                  ? { snowflakeCortex: true }
                : transportBase.transport === "minimax_token"
                  ? { minimaxToken: true }
                : transportBase.transport === "kimi_code"
                  ? { kimiCode: true }
                : transportBase.transport === "poe"
                  ? { poe: true }
                : transportBase.transport === "opencode_zen"
                  ? { opencodeZen: true }
                : transportBase.transport === "google_ai"
                  ? { googleAi: true, google_ai: true }
                  : transportBase.transport === "custom_openai"
                    ? { customOpenai: true }
                  : { [transportBase.transport]: true }),
          }
        : {
            baseUrl: undefined,
            transport: undefined,
            ...clearFlags,
          }),
    });
    updateAgent(db, "intelligence", {
      backend: "provider",
      modelPath: null,
      ...patch,
    });
    markLlmReady(db);
    const transportLabel =
      compatibleTransport === "openrouter"
        ? "OpenRouter"
        : compatibleTransport === "groq"
          ? "Groq"
          : compatibleTransport === "together"
            ? "Together"
            : compatibleTransport === "fireworks"
              ? "Fireworks"
              : compatibleTransport === "deepseek"
                ? "DeepSeek"
                : compatibleTransport === "google_ai"
                  ? "Google AI"
                  : compatibleTransport === "xai"
                    ? "xAI"
                  : compatibleTransport === "zai"
                    ? "Z.AI"
                  : compatibleTransport === "minimax"
                    ? "MiniMax"
                  : compatibleTransport === "custom_openai"
                    ? "Custom"
                  : compatibleTransport === "zai_coding"
                    ? "Z.AI Coding"
                  : compatibleTransport === "opencode_go"
                    ? "OpenCode Go"
                  : compatibleTransport === "digitalocean_inference"
                    ? "DigitalOcean"
                  : compatibleTransport === "snowflake_cortex"
                    ? "Snowflake Cortex"
                  : compatibleTransport === "minimax_token"
                    ? "MiniMax Token"
                  : compatibleTransport === "kimi_code"
                    ? "Kimi Code"
                  : compatibleTransport === "poe"
                    ? "Poe"
                  : compatibleTransport === "opencode_zen"
                    ? "OpenCode Zen"
                    : null;
    return {
      ok: true,
      active: {
        id:
          compatibleTransport && compatibleTransport !== "openrouter"
            ? `provider:openai_compatible:${compatibleTransport}:${model}`
            : `provider:${provider}:${model}`,
        source: "provider",
        label: transportLabel ? `${transportLabel} · ${model}` : model,
        model,
        provider,
        transport: compatibleTransport ?? undefined,
        active: true,
        harnessProfileId: profile.id,
      },
    };
  }

  if (input.source === "remote") {
    const endpointId = input.endpointId?.trim();
    if (!endpointId) throw new Error("Remote endpoint id required");
    const profile = resolveHarnessProfile({ source: "remote" });
    const patch = applyProfileToAgentPatch(agent, profile, { endpointId });
    updateAgent(db, "intelligence", {
      backend: "remote",
      modelPath: null,
      ...patch,
    });
    markLlmReady(db);
    return {
      ok: true,
      active: {
        id: `remote:${endpointId}`,
        source: "remote",
        label: endpointId,
        endpointId,
        active: true,
        harnessProfileId: profile.id,
      },
    };
  }

  throw new Error(`Unknown model source: ${input.source}`);
}
