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
 */

import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../core-db.js";
import { encryptSecret, decryptSecret } from "./holdings/crypto-box.js";

const META_DEEPSEEK = "godmode_inference.deepseek_api_key_enc";
const META_ZAI = "godmode_inference.zai_api_key_enc";
const META_ZAI_CODING = "godmode_inference.zai_coding_api_key_enc";
const META_DASHSCOPE = "godmode_inference.dashscope_api_key_enc";

/** Keep in sync with *-platform.ts secret ids (avoid circular imports). */
const DEEPSEEK_SECRET_ID = "deepseek-api-key";
const ZAI_SECRET_ID = "zai-api-key";
const ZAI_CODING_SECRET_ID = "zai-coding-api-key";
const DASHSCOPE_SECRET_ID = "dashscope-api-key";

export type GodModeInferenceProvider =
  | "deepseek"
  | "zai"
  | "zai_coding"
  | "dashscope";

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
  }
}

export function isGodModeInferenceSupplyReady(): boolean {
  if (
    process.env.GODMODE_INFERENCE_DISABLE_SUPPLY === "1" ||
    process.env.GODMODE_INFERENCE_DISABLE_SUPPLY === "true"
  ) {
    return false;
  }
  return (
    resolveGodModeInferenceSupplyKey("deepseek") != null ||
    resolveGodModeInferenceSupplyKey("zai") != null ||
    resolveGodModeInferenceSupplyKey("zai_coding") != null ||
    resolveGodModeInferenceSupplyKey("dashscope") != null
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
      getPlatformSupplyDashScopeKey()
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
  return {
    configured:
      deepseek.connected ||
      zai.connected ||
      zaiCoding.connected ||
      dashscope.connected,
    deepseek,
    zai,
    zaiCoding,
    dashscope,
  };
}

export function setGodModeInferenceSupplyKeys(opts: {
  deepseekApiKey?: string;
  zaiApiKey?: string;
  zaiCodingApiKey?: string;
  dashscopeApiKey?: string;
}): GodModeInferenceSupplyStatus {
  writeEncryptedMeta(META_DEEPSEEK, opts.deepseekApiKey);
  writeEncryptedMeta(META_ZAI, opts.zaiApiKey);
  writeEncryptedMeta(META_ZAI_CODING, opts.zaiCodingApiKey);
  writeEncryptedMeta(META_DASHSCOPE, opts.dashscopeApiKey);
  return getGodModeInferenceSupplyStatus();
}

/** Fixed secret ids that may fall back to platform supply at chat time. */
export function isGodModeInferenceSupplySecretId(id: string): boolean {
  const base = id.includes("__agent__") ? id.split("__agent__")[0]! : id;
  return (
    base === DEEPSEEK_SECRET_ID ||
    base === ZAI_SECRET_ID ||
    base === ZAI_CODING_SECRET_ID ||
    base === DASHSCOPE_SECRET_ID
  );
}

export function resolveGodModeInferenceSupplyBySecretId(
  secretId: string
): string | null {
  const base = secretId.includes("__agent__")
    ? secretId.split("__agent__")[0]!
    : secretId;
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
  return null;
}

export type GodModeInferenceApplyTarget = {
  provider: GodModeInferenceProvider;
  modelId: string;
  transport: string;
  baseUrl: string;
  apiKeyRef: string;
};

/**
 * Prefer DeepSeek → Z.AI payg → Z.AI Coding → DashScope for signup-guide.
 */
export function pickGodModeInferenceSupplyTarget(): GodModeInferenceApplyTarget | null {
  if (resolveGodModeInferenceSupplyKey("deepseek")) {
    return {
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      transport: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyRef: DEEPSEEK_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("zai")) {
    return {
      provider: "zai",
      modelId: "glm-5.3-flash",
      transport: "zai",
      baseUrl: "https://api.z.ai/api/paas/v4",
      apiKeyRef: ZAI_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("zai_coding")) {
    return {
      provider: "zai_coding",
      modelId: "glm-5.1",
      transport: "zai_coding",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      apiKeyRef: ZAI_CODING_SECRET_ID,
    };
  }
  if (resolveGodModeInferenceSupplyKey("dashscope")) {
    return {
      provider: "dashscope",
      modelId: "qwen-plus",
      transport: "dashscope",
      baseUrl:
        process.env.DASHSCOPE_API_BASE_URL?.trim() ||
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      apiKeyRef: DASHSCOPE_SECRET_ID,
    };
  }
  return null;
}
