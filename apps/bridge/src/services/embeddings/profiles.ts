/**
 * Embedding profiles (#69): memory vs code jobs sharing one local server by default.
 */
import path from "node:path";
import { config } from "../../config.js";

export type EmbedProfileId = "memory" | "code";

export interface EmbedProfileConfig {
  id: EmbedProfileId;
  /** Human label for status UI. */
  label: string;
  /** Consumers that use this profile. */
  consumers: string[];
  modelPath: string;
  port: number;
  ctxSize: number;
  pooling: "mean" | "cls" | "none";
  /** Observed embedding dimension after first successful embed (runtime). */
  dim?: number;
}

export function listEmbedProfileIds(): EmbedProfileId[] {
  return ["memory", "code"];
}

export function resolveEmbedProfile(id: EmbedProfileId): EmbedProfileConfig {
  const base = config.embeddings;
  const overlay =
    id === "code" ? base.profiles.code : base.profiles.memory;
  return {
    id,
    label: id === "code" ? "Code" : "Memory",
    consumers:
      id === "code"
        ? ["codebase_search", "code_index"]
        : ["memories", "wiki", "capabilities", "chat_rag"],
    modelPath: overlay.modelPath || base.embedderModelPath,
    port: overlay.port || base.embedderPort,
    ctxSize: overlay.ctxSize || base.embedderCtxSize,
    pooling: overlay.pooling || "mean",
  };
}

export function embedProfileModelId(profile: EmbedProfileConfig): string {
  return path.basename(profile.modelPath).replace(/\.gguf$/i, "") || profile.id;
}

/** True when code profile needs a distinct llama-server from memory. */
export function codeProfileUsesSeparateServer(): boolean {
  const memory = resolveEmbedProfile("memory");
  const code = resolveEmbedProfile("code");
  return (
    memory.modelPath !== code.modelPath ||
    memory.port !== code.port
  );
}
