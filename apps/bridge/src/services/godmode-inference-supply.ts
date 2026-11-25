/**
 * Platform-wide GodMode Inference supply (Admin → GodMode Inference).
 *
 * Encrypted in Cloud.sqlite `platform_meta` (same pattern as Stripe billing).
 * These keys power managed GodMode Inference chat only (Intelligence + active
 * grant). They are not personal BYOK and must not appear as Platform Vault
 * secrets or resolve for other agents.
 *
 * Chat resolution: personal Vault BYOK first. Supply only via
 * resolveGodModeInferenceSupplyForManagedChat (see godmode-inference-grants).
 * Auto (`godmode/auto`) resolves per turn via inference-router.
 */

import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../core-db.js";
import { encryptSecret, decryptSecret } from "./holdings/crypto-box.js";

const META_DEEPSEEK = "godmode_inference.deepseek_api_key_enc";
const META_ZAI = "godmode_inference.zai_api_key_enc";
const META_ZAI_CODING = "godmode_inference.zai_coding_api_key_enc";
const META_DASHSCOPE = "godmode_inference.dashscope_api_key_enc";
const META_OPENROUTER = "godmode_inference.openrouter_api_key_enc";
const META_GROQ = "godmode_inference.groq_api_key_enc";
const META_GOOGLE_AI = "godmode_inference.google_ai_api_key_enc";

/** Keep in sync with *-platform.ts secret ids (avoid circular imports). */
const DEEPSEEK_SECRET_ID = "deepseek-api-key";
const ZAI_SECRET_ID = "zai-api-key";
const ZAI_CODING_SECRET_ID = "zai-coding-api-key";
const DASHSCOPE_SECRET_ID = "dashscope-api-key";
const OPENROUTER_SECRET_ID = "openrouter-api-key";
const GROQ_SECRET_ID = "groq-api-key";
const GOOGLE_AI_SECRET_ID = "google-ai-api-key";

/** Catalog / agent selection for GodMode Inference Auto (#816). */
export const GODMODE_AUTO_SECRET_ID = "godmode-auto";
export const GODMODE_AUTO_MODEL_ID = "godmode/auto";
export const GODMODE_AUTO_TRANSPORT = "godmode_auto";

export type GodModeInferenceProvider =
  | "deepseek"
  | "zai"
  | "zai_coding"
  | "dashscope"
  | "openrouter"
  | "groq"
  | "google_ai";

export const GODMODE_INFERENCE_PROVIDERS: GodModeInferenceProvider[] = [
  "deepseek",
  "zai",
  "zai_coding",
  "dashscope",
  "openrouter",
  "groq",
  "google_ai",
];

export interface GodModeInferenceProviderStatus {
  connected: boolean;
  source: "platform" | "env" | "none";
  masked?: string;
}

export interface GodModeInferenceSupplyStatus {
  configured: boolean;
  deepseek: GodModeInferenceProviderStatus;
  zai: GodModeInferenceProviderStatus;
  zaiCoding: GodModeInferenceProviderStatus;
  dashscope: GodModeInferenceProviderStatus;
  openrouter: GodModeInferenceProviderStatus;
  groq: GodModeInferenceProviderStatus;
  googleAi: GodModeInferenceProviderStatus;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

function readEncryptedMeta(key: string): string | null {
  try {
    const enc = getPlatformMeta(getCloudDb(), key);
    if (!enc) return null;
    try {
      const plain = decryptSecret(enc).trim();
      return plain || null;
    } catch {
      return null;
    }
  } catch {
    // Cloud DB may be unavailable in unit tests or early boot.
    return null;
  }
}

function writeEncryptedMeta(key: string, value: string | undefined): void {
  if (value === undefined) return;
  const core = getCloudDb();
  const trimmed = value.trim();
  if (trimmed) {
    setPlatformMeta(core, key, encryptSecret(trimmed));
  } else {
    core.prepare(`DELETE FROM platform_meta WHERE key=?`).run(key);
  }
}

function providerStatus(
  platformValue: string | null,
  envValue: string | null
): GodModeInferenceProviderStatus {
  if (platformValue) {
    return {
      connected: true,
      source: "platform",
      masked: maskKey(platformValue),
    };
  }
  if (envValue) {
    return { connected: true, source: "env", masked: maskKey(envValue) };
  }
  return { connected: false, source: "none" };
}

/** Decrypt platform_meta only (no env). Used after personal vault miss. */
export function getPlatformSupplyDeepSeekKey(): string | null {
  return readEncryptedMeta(META_DEEPSEEK);
}

export function getPlatformSupplyZaiKey(): string | null {
  return readEncryptedMeta(META_ZAI);
}

export function getPlatformSupplyZaiCodingKey(): string | null {
  return readEncryptedMeta(META_ZAI_CODING);
}

export function getPlatformSupplyDashScopeKey(): string | null {
  return readEncryptedMeta(META_DASHSCOPE);
}

export function getPlatformSupplyOpenRouterKey(): string | null {
  return readEncryptedMeta(META_OPENROUTER);
}

export function getPlatformSupplyGroqKey(): string | null {
  return readEncryptedMeta(META_GROQ);
}

export function getPlatformSupplyGoogleAiKey(): string | null {
  return readEncryptedMeta(META_GOOGLE_AI);
}

/**
 * Platform supply or ops env for GodMode Inference (not personal vault).
 * Prefer platform_meta, then process env dual-write.
 */
export function resolveGodModeInferenceSupplyKey(
  provider: GodModeInferenceProvider
): string | null {
  switch (provider) {
    case "deepseek":
      return (
        getPlatformSupplyDeepSeekKey() ||
        process.env.DEEPSEEK_API_KEY?.trim() ||
        null
      );
    case "zai":
      return (
        getPlatformSupplyZaiKey() || process.env.ZAI_API_KEY?.trim() || null
      );
    case "zai_coding":
      return (
        getPlatformSupplyZaiCodingKey() ||
        process.env.ZAI_CODING_API_KEY?.trim() ||
        null
      );
    case "dashscope":
      return (
        getPlatformSupplyDashScopeKey() ||
        process.env.DASHSCOPE_API_KEY?.trim() ||
        process.env.QWEN_API_KEY?.trim() ||
        null
      );
    case "openrouter":
      return (
        getPlatformSupplyOpenRouterKey() ||
        process.env.OPENROUTER_API_KEY?.trim() ||
        process.env.TRIAL_PLATFORM_API_KEY?.trim() ||
        null
      );
    case "groq":
      return (
        getPlatformSupplyGroqKey() || process.env.GROQ_API_KEY?.trim() || null
      );
    case "google_ai":
      return (
        getPlatformSupplyGoogleAiKey() ||
        process.env.GOOGLE_AI_API_KEY?.trim() ||
        process.env.GEMINI_API_KEY?.trim() ||
        null
      );
  }
}

export function isGodModeInferenceSupplyReady(): boolean {
  if (
    process.env.GODMODE_INFERENCE_DISABLE_SUPPLY === "1" ||
    process.env.GODMODE_INFERENCE_DISABLE_SUPPLY === "true"
  ) {
    return false;
  }
  return GODMODE_INFERENCE_PROVIDERS.some(
    (p) => resolveGodModeInferenceSupplyKey(p) != null
  );
}

/**
 * Admin-persisted supply only (platform_meta). Used for onboarding llmReady so
 * local GGUF wizard is not skipped by leftover process env keys.
 */
export function hasAdminGodModeInferenceSupply(): boolean {
  return Boolean(
    getPlatformSupplyDeepSeekKey() ||
      getPlatformSupplyZaiKey() ||
      getPlatformSupplyZaiCodingKey() ||
      getPlatformSupplyDashScopeKey() ||
      getPlatformSupplyOpenRouterKey() ||
      getPlatformSupplyGroqKey() ||
      getPlatformSupplyGoogleAiKey()
  );
}

export function getGodModeInferenceSupplyStatus(): GodModeInferenceSupplyStatus {
  const deepseek = providerStatus(
    getPlatformSupplyDeepSeekKey(),
    process.env.DEEPSEEK_API_KEY?.trim() || null
  );
  const zai = providerStatus(
    getPlatformSupplyZaiKey(),
    process.env.ZAI_API_KEY?.trim() || null
  );
  const zaiCoding = providerStatus(
    getPlatformSupplyZaiCodingKey(),
    process.env.ZAI_CODING_API_KEY?.trim() || null
  );
  const dashscope = providerStatus(
    getPlatformSupplyDashScopeKey(),
    process.env.DASHSCOPE_API_KEY?.trim() ||
      process.env.QWEN_API_KEY?.trim() ||
      null
  );
  const openrouter = providerStatus(
    getPlatformSupplyOpenRouterKey(),
    process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.TRIAL_PLATFORM_API_KEY?.trim() ||
      null
  );
  const groq = providerStatus(
    getPlatformSupplyGroqKey(),
    process.env.GROQ_API_KEY?.trim() || null
  );
  const googleAi = providerStatus(
    getPlatformSupplyGoogleAiKey(),
    process.env.GOOGLE_AI_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      null
  );
  return {
    configured:
      deepseek.connected ||
      zai.connected ||
      zaiCoding.connected ||
      dashscope.connected ||
      openrouter.connected ||
      groq.connected ||
      googleAi.connected,
    deepseek,
    zai,
    zaiCoding,
    dashscope,
    openrouter,
    groq,
    googleAi,
  };
}

export function setGodModeInferenceSupplyKeys(opts: {
  deepseekApiKey?: string;
  zaiApiKey?: string;
  zaiCodingApiKey?: string;
  dashscopeApiKey?: string;
  openrouterApiKey?: string;
  groqApiKey?: string;
  googleAiApiKey?: string;
}): GodModeInferenceSupplyStatus {
  writeEncryptedMeta(META_DEEPSEEK, opts.deepseekApiKey);
  writeEncryptedMeta(META_ZAI, opts.zaiApiKey);
  writeEncryptedMeta(META_ZAI_CODING, opts.zaiCodingApiKey);
  writeEncryptedMeta(META_DASHSCOPE, opts.dashscopeApiKey);
  writeEncryptedMeta(META_OPENROUTER, opts.openrouterApiKey);
  writeEncryptedMeta(META_GROQ, opts.groqApiKey);
  writeEncryptedMeta(META_GOOGLE_AI, opts.googleAiApiKey);
  return getGodModeInferenceSupplyStatus();
}

/** Fixed secret ids that may fall back to platform supply at chat time. */
export function isGodModeInferenceSupplySecretId(id: string): boolean {
  const base = id.includes("__agent__") ? id.split("__agent__")[0]! : id;
  return (
    base === GODMODE_AUTO_SECRET_ID ||
    base === DEEPSEEK_SECRET_ID ||
    base === ZAI_SECRET_ID ||
    base === ZAI_CODING_SECRET_ID ||
    base === DASHSCOPE_SECRET_ID ||
    base === OPENROUTER_SECRET_ID ||
    base === GROQ_SECRET_ID ||
    base === GOOGLE_AI_SECRET_ID
  );
}

export function isGodModeAutoSecretId(id: string): boolean {
  const base = id.includes("__agent__") ? id.split("__agent__")[0]! : id;
  return base === GODMODE_AUTO_SECRET_ID;
}

export function isGodModeAutoModelId(model: string | null | undefined): boolean {
  const m = (model ?? "").trim().toLowerCase();
  return m === GODMODE_AUTO_MODEL_ID || m === "auto" || m === "godmode-auto";
}

export function resolveGodModeInferenceSupplyBySecretId(
  secretId: string
): string | null {
  const base = secretId.includes("__agent__")
    ? secretId.split("__agent__")[0]!
    : secretId;
  if (base === GODMODE_AUTO_SECRET_ID) {
    // Auto resolves a concrete upstream key per turn via inference-router.
    return null;
  }
  if (base === DEEPSEEK_SECRET_ID) {
    return resolveGodModeInferenceSupplyKey("deepseek");
  }
  if (base === ZAI_SECRET_ID) {
    return resolveGodModeInferenceSupplyKey("zai");
  }
  if (base === ZAI_CODING_SECRET_ID) {
    return resolveGodModeInferenceSupplyKey("zai_coding");
  }
  if (base === DASHSCOPE_SECRET_ID) {
    return resolveGodModeInferenceSupplyKey("dashscope");
  }
  if (base === OPENROUTER_SECRET_ID) {
    return resolveGodModeInferenceSupplyKey("openrouter");
  }
  if (base === GROQ_SECRET_ID) {
    return resolveGodModeInferenceSupplyKey("groq");
  }
  if (base === GOOGLE_AI_SECRET_ID) {
    return resolveGodModeInferenceSupplyKey("google_ai");
  }
  return null;
}

export function supplySecretIdForProvider(
  provider: GodModeInferenceProvider
): string {
  switch (provider) {
    case "deepseek":
      return DEEPSEEK_SECRET_ID;
    case "zai":
      return ZAI_SECRET_ID;
    case "zai_coding":
      return ZAI_CODING_SECRET_ID;
    case "dashscope":
      return DASHSCOPE_SECRET_ID;
    case "openrouter":
      return OPENROUTER_SECRET_ID;
    case "groq":
      return GROQ_SECRET_ID;
    case "google_ai":
      return GOOGLE_AI_SECRET_ID;
  }
}

export function supplyBaseUrlForProvider(
  provider: GodModeInferenceProvider
): string {
  switch (provider) {
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "zai":
      return "https://api.z.ai/api/paas/v4";
    case "zai_coding":
      return "https://api.z.ai/api/coding/paas/v4";
    case "dashscope":
      return (
        process.env.DASHSCOPE_API_BASE_URL?.trim() ||
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
      );
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "google_ai":
      return "https://generativelanguage.googleapis.com/v1beta/openai";
  }
}

export type GodModeInferenceApplyTarget = {
  provider: GodModeInferenceProvider | "auto";
  modelId: string;
  transport: string;
  baseUrl: string;
  apiKeyRef: string;
};

/**
 * Default managed selection for signup / ensure: GodMode Inference Auto when
 * any supply key is present. Concrete upstream is chosen per turn.
 */
export function pickGodModeInferenceSupplyTarget(): GodModeInferenceApplyTarget | null {
  if (!isGodModeInferenceSupplyReady()) return null;
  return {
    provider: "auto",
    modelId: GODMODE_AUTO_MODEL_ID,
    transport: GODMODE_AUTO_TRANSPORT,
    baseUrl: supplyBaseUrlForProvider("openrouter"),
    apiKeyRef: GODMODE_AUTO_SECRET_ID,
  };
}

/** Legacy static pin (tests / ops). Prefer Auto via pickGodModeInferenceSupplyTarget. */
export function pickStaticGodModeInferenceSupplyTarget(): GodModeInferenceApplyTarget | null {
  if (resolveGodModeInferenceSupplyKey("zai")) {
    return {
      provider: "zai",
      modelId: "glm-5.3-flash",
      transport: "zai",
      baseUrl: supplyBaseUrlForProvider("zai"),
      apiKeyRef: ZAI_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("deepseek")) {
    return {
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      transport: "deepseek",
      baseUrl: supplyBaseUrlForProvider("deepseek"),
      apiKeyRef: DEEPSEEK_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("openrouter")) {
    return {
      provider: "openrouter",
      modelId: "openrouter/free",
      transport: "openrouter",
      baseUrl: supplyBaseUrlForProvider("openrouter"),
      apiKeyRef: OPENROUTER_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("groq")) {
    return {
      provider: "groq",
      modelId: "llama-3.1-8b-instant",
      transport: "groq",
      baseUrl: supplyBaseUrlForProvider("groq"),
      apiKeyRef: GROQ_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("google_ai")) {
    return {
      provider: "google_ai",
      modelId: "gemini-2.5-flash",
      transport: "google_ai",
      baseUrl: supplyBaseUrlForProvider("google_ai"),
      apiKeyRef: GOOGLE_AI_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("zai_coding")) {
    return {
      provider: "zai_coding",
      modelId: "glm-5.1",
      transport: "zai_coding",
      baseUrl: supplyBaseUrlForProvider("zai_coding"),
      apiKeyRef: ZAI_CODING_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("dashscope")) {
    return {
      provider: "dashscope",
      modelId: "qwen-plus",
      transport: "dashscope",
      baseUrl: supplyBaseUrlForProvider("dashscope"),
      apiKeyRef: DASHSCOPE_SECRET_ID,
    };
  }
  return null;
}
