import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";
import { resolveGodModeInferenceSupplyKey } from "../godmode-inference-supply.js";
import type { InferenceBand, RosterEntry, RosterTag } from "./types.js";
import { INFERENCE_BANDS } from "./types.js";

const META_ROSTER = "godmode_inference.auto_roster_json";

const VALID_TAGS = new Set<string>([
  "fast",
  "smart",
  "coding",
  "chat",
  "local",
]);

/** Default FreeLLMAPI-shaped free/cheap roster (#816). Admin may override. */
export const DEFAULT_INFERENCE_ROSTER: RosterEntry[] = [
  {
    id: "or-free-router",
    provider: "openrouter",
    model: "openrouter/free",
    band: "trivial",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 20, rpd: 50 },
    capabilities: [],
    classifier: true,
    capabilityScore: 0.45,
    tags: ["fast"],
  },
  {
    id: "groq-llama-8b",
    provider: "groq",
    model: "llama-3.1-8b-instant",
    band: "trivial",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 30, rpd: 14400 },
    capabilities: ["tools"],
    capabilityScore: 0.55,
    tags: ["fast"],
  },
  {
    id: "gemini-flash",
    provider: "google_ai",
    model: "gemini-2.5-flash",
    band: "chat",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 15, rpd: 1500 },
    capabilities: ["tools", "vision", "long_context"],
    capabilityScore: 0.62,
    tags: ["chat", "fast"],
  },
  {
    id: "zai-glm-flash",
    provider: "zai",
    model: "glm-5.3-flash",
    band: "chat",
    costPer1kIn: 0.05,
    costPer1kOut: 0.15,
    caps: { rpm: 60, rpd: 10000 },
    capabilities: ["tools", "vision", "long_context"],
    capabilityScore: 0.6,
    tags: ["chat"],
  },
  {
    id: "deepseek-flash",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    band: "chat",
    costPer1kIn: 0.05,
    costPer1kOut: 0.15,
    caps: { rpm: 60, rpd: 10000 },
    capabilities: ["tools"],
    capabilityScore: 0.58,
    tags: ["chat", "fast"],
  },
  {
    id: "zai-glm-flash-tools",
    provider: "zai",
    model: "glm-5.3-flash",
    band: "tools",
    costPer1kIn: 0.05,
    costPer1kOut: 0.15,
    caps: { rpm: 60, rpd: 10000 },
    capabilities: ["tools", "vision", "long_context"],
    capabilityScore: 0.7,
    tags: ["coding"],
  },
  {
    id: "deepseek-flash-tools",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    band: "tools",
    costPer1kIn: 0.05,
    costPer1kOut: 0.15,
    caps: { rpm: 60, rpd: 10000 },
    capabilities: ["tools"],
    capabilityScore: 0.68,
    tags: ["coding", "fast"],
  },
  {
    id: "gemini-flash-tools",
    provider: "google_ai",
    model: "gemini-2.5-flash",
    band: "tools",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 15, rpd: 1500 },
    capabilities: ["tools", "vision", "long_context"],
    capabilityScore: 0.72,
    tags: ["coding", "fast"],
  },
  {
    id: "or-free-tools",
    provider: "openrouter",
    model: "openrouter/free",
    band: "tools",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 20, rpd: 50 },
    capabilities: ["tools"],
    capabilityScore: 0.55,
    tags: ["fast"],
  },
  {
    id: "zai-glm-53",
    provider: "zai",
    model: "glm-5.3",
    band: "hard",
    costPer1kIn: 0.2,
    costPer1kOut: 0.6,
    caps: { rpm: 30, rpd: 2000 },
    capabilities: ["tools", "vision", "long_context"],
    capabilityScore: 0.82,
    tags: ["smart", "coding"],
  },
  {
    id: "gemini-pro",
    provider: "google_ai",
    model: "gemini-2.5-pro",
    band: "hard",
    costPer1kIn: 0,
    costPer1kOut: 0,
    caps: { rpm: 5, rpd: 100 },
    capabilities: ["tools", "vision", "long_context"],
    capabilityScore: 0.85,
    tags: ["smart"],
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    model: "deepseek-chat",
    band: "hard",
    costPer1kIn: 0.14,
    costPer1kOut: 0.28,
    caps: { rpm: 60, rpd: 10000 },
    capabilities: ["tools", "long_context"],
    capabilityScore: 0.78,
    tags: ["smart", "coding"],
  },
];

function isBand(v: unknown): v is InferenceBand {
  return typeof v === "string" && (INFERENCE_BANDS as string[]).includes(v);
}

function normalizeTags(raw: unknown): RosterTag[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tags = raw.filter(
    (t): t is RosterTag => typeof t === "string" && VALID_TAGS.has(t)
  );
  return tags.length > 0 ? tags : undefined;
}

function normalizeEntry(raw: unknown): RosterEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const provider = typeof o.provider === "string" ? o.provider.trim() : "";
  const model = typeof o.model === "string" ? o.model.trim() : "";
  if (!id || !provider || !model || !isBand(o.band)) return null;
  const capsRaw =
    o.caps && typeof o.caps === "object"
      ? (o.caps as Record<string, unknown>)
      : {};
  const caps = {
    rpm: Number.isFinite(Number(capsRaw.rpm)) ? Number(capsRaw.rpm) : undefined,
    rpd: Number.isFinite(Number(capsRaw.rpd)) ? Number(capsRaw.rpd) : undefined,
    tpm: Number.isFinite(Number(capsRaw.tpm)) ? Number(capsRaw.tpm) : undefined,
    tpd: Number.isFinite(Number(capsRaw.tpd)) ? Number(capsRaw.tpd) : undefined,
  };
  const capabilities = Array.isArray(o.capabilities)
    ? (o.capabilities.filter(
        (c) => c === "tools" || c === "vision" || c === "long_context"
      ) as RosterEntry["capabilities"])
    : [];
  const capabilityScore = Number.isFinite(Number(o.capabilityScore))
    ? Math.min(1, Math.max(0, Number(o.capabilityScore)))
    : undefined;
  const tags = normalizeTags(o.tags);
  return {
    id,
    provider: provider as RosterEntry["provider"],
    model,
    band: o.band,
    costPer1kIn: Number.isFinite(Number(o.costPer1kIn))
      ? Number(o.costPer1kIn)
      : 0,
    costPer1kOut: Number.isFinite(Number(o.costPer1kOut))
      ? Number(o.costPer1kOut)
      : 0,
    caps,
    capabilities,
    classifier: o.classifier === true,
    enabled: o.enabled !== false,
    capabilityScore,
    tags,
  };
}

export function getInferenceRoster(): RosterEntry[] {
  try {
    const raw = getPlatformMeta(getCloudDb(), META_ROSTER);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const entries = parsed
          .map(normalizeEntry)
          .filter((e): e is RosterEntry => e != null);
        if (entries.length > 0) return entries;
      }
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_INFERENCE_ROSTER.map((e) => ({ ...e, tags: e.tags ? [...e.tags] : undefined }));
}

export function setInferenceRoster(entries: RosterEntry[]): RosterEntry[] {
  const normalized = entries
    .map(normalizeEntry)
    .filter((e): e is RosterEntry => e != null);
  const toStore = normalized.length > 0 ? normalized : DEFAULT_INFERENCE_ROSTER;
  setPlatformMeta(getCloudDb(), META_ROSTER, JSON.stringify(toStore));
  return toStore;
}

export function resetInferenceRoster(): RosterEntry[] {
  try {
    getCloudDb()
      .prepare(`DELETE FROM platform_meta WHERE key=?`)
      .run(META_ROSTER);
  } catch {
    // ignore
  }
  return DEFAULT_INFERENCE_ROSTER.map((e) => ({
    ...e,
    tags: e.tags ? [...e.tags] : undefined,
  }));
}

/** Entries whose provider key is configured and enabled. */
export function listAvailableRosterEntries(
  roster: RosterEntry[] = getInferenceRoster()
): RosterEntry[] {
  return roster.filter(
    (e) =>
      e.enabled !== false && resolveGodModeInferenceSupplyKey(e.provider) != null
  );
}

export function pickClassifierEntry(
  roster: RosterEntry[] = listAvailableRosterEntries()
): RosterEntry | null {
  const marked = roster.find((e) => e.classifier && e.band === "trivial");
  if (marked) return marked;
  const trivial = roster
    .filter((e) => e.band === "trivial")
    .sort(
      (a, b) =>
        a.costPer1kIn + a.costPer1kOut - (b.costPer1kIn + b.costPer1kOut)
    );
  return trivial[0] ?? null;
}
