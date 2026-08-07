import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import type { AppDatabase } from "../db.js";
import {
  findSecretByName,
  getPlatformVaultSecretInScope,
  getSecretValue,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";
import { resolveCursorAgentCommand } from "./agents/cursor-backend.js";

/** Fixed secret id/name for the user's Cursor subscription API key. */
export const CURSOR_API_KEY_SECRET_ID = "cursor-api-key";
export const CURSOR_API_KEY_SECRET_NAME = "cursor_api_key";

/** Warm TTL for successful / in-progress CLI status results. */
export const CURSOR_CLI_PROBE_TTL_MS = 60_000;
/** Shorter TTL for negatives / timeouts so we do not respawn on every status hit. */
export const CURSOR_CLI_PROBE_NEGATIVE_TTL_MS = 30_000;
/** Warm TTL for Cursor.models.list catalog rows. */
export const CURSOR_MODELS_TTL_MS = 5 * 60_000;

export type CursorAuthSource = "env" | "vault" | "none";

export interface CursorAuthStatus {
  connected: boolean;
  source: CursorAuthSource;
  masked?: string;
  cliAuthenticated?: boolean;
  cliDetail?: string;
}

export type CursorCliProbeResult = {
  ok: boolean;
  detail: string;
};

type CliProbeCache = {
  at: number;
  ttlMs: number;
  result: CursorCliProbeResult;
};

type ModelsCache = {
  at: number;
  models: CursorModelOption[];
};

let cliProbeCache: CliProbeCache | null = null;
let cliProbeInFlight: Promise<CursorCliProbeResult> | null = null;

const modelsCacheByKeyFp = new Map<string, ModelsCache>();
const modelsInFlightByKeyFp = new Map<string, Promise<CursorModelOption[]>>();

/** @internal test helper */
export function clearCursorSubscriptionCachesForTests(): void {
  cliProbeCache = null;
  cliProbeInFlight = null;
  modelsCacheByKeyFp.clear();
  modelsInFlightByKeyFp.clear();
}

export function apiKeyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export function resolveCursorApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.CURSOR_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: CURSOR_API_KEY_SECRET_ID,
    name: CURSOR_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function invalidateCursorModelsCache(apiKey?: string | null): void {
  if (apiKey?.trim()) {
    modelsCacheByKeyFp.delete(apiKeyFingerprint(apiKey.trim()));
    modelsInFlightByKeyFp.delete(apiKeyFingerprint(apiKey.trim()));
    return;
  }
  modelsCacheByKeyFp.clear();
  modelsInFlightByKeyFp.clear();
}

export function upsertCursorApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: CURSOR_API_KEY_SECRET_ID,
    name: CURSOR_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
  invalidateCursorModelsCache();
}

/**
 * If the key only exists as a manually-added `cursor_api_key` secret (UUID id)
 * in the Platform Vault, rewrite it to the fixed Cursor subscription secret id.
 */
export function normalizeCursorVaultSecret(db: AppDatabase): void {
  if (getPlatformVaultSecretInScope(db, {
    baseId: CURSOR_API_KEY_SECRET_ID,
    name: CURSOR_API_KEY_SECRET_NAME,
    agentId: null,
  })) {
    return;
  }
  const named = findSecretByName(db, CURSOR_API_KEY_SECRET_NAME, null);
  if (!named || named.id === CURSOR_API_KEY_SECRET_ID) return;
  const value = getSecretValue(db, named.id);
  if (!value) return;
  upsertCursorApiKey(db, value, null);
}

export function removeCursorApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  const removed = removePlatformVaultSecret(db, {
    baseId: CURSOR_API_KEY_SECRET_ID,
    name: CURSOR_API_KEY_SECRET_NAME,
    agentId,
  });
  if (removed) invalidateCursorModelsCache();
  return removed;
}

function maskCursorKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function getCursorAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): CursorAuthStatus {
  const env = process.env.CURSOR_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskCursorKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: CURSOR_API_KEY_SECRET_ID,
    name: CURSOR_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskCursorKey(value) };
  }
  return { connected: false, source: "none" };
}

/** True when Intelligence can run without a local llama-server. */
export function isCursorSubscriptionReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveCursorApiKey(db, agentId) != null;
}

function readWarmCliProbe(now = Date.now()): CursorCliProbeResult | null {
  if (!cliProbeCache) return null;
  if (now - cliProbeCache.at >= cliProbeCache.ttlMs) return null;
  return cliProbeCache.result;
}

/** Cached CLI probe if still within TTL; does not spawn. */
export function peekCachedCursorCliAuth(): CursorCliProbeResult | null {
  return readWarmCliProbe();
}

function cacheCliProbe(result: CursorCliProbeResult): CursorCliProbeResult {
  cliProbeCache = {
    at: Date.now(),
    ttlMs: result.ok ? CURSOR_CLI_PROBE_TTL_MS : CURSOR_CLI_PROBE_NEGATIVE_TTL_MS,
    result,
  };
  return result;
}

/** Uncached spawn of `cursor-agent status` (15s kill timeout). */
export function runCursorCliAuthProbeOnce(): Promise<CursorCliProbeResult> {
  const command = resolveCursorAgentCommand();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CursorCliProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const proc = spawn(command, ["status"], {
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ ok: false, detail: "cursor-agent status timed out" });
    }, 15_000);
    proc.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on("error", () => {
      clearTimeout(timer);
      finish({ ok: false, detail: "cursor-agent not installed" });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const text = (stdout || stderr).trim();
      if (code === 0 && /authenticated|logged in/i.test(text)) {
        finish({ ok: true, detail: text.slice(0, 500) });
        return;
      }
      finish({
        ok: false,
        detail: text || `cursor-agent status exited ${code}`,
      });
    });
  });
}

/**
 * CLI auth probe with TTL cache + single-flight coalescing.
 * Prefer {@link peekCachedCursorCliAuth} + {@link refreshCursorCliAuthInBackground}
 * on hot request paths so Intelligence boot never awaits a 15s spawn.
 */
export async function probeCursorCliAuth(): Promise<CursorCliProbeResult> {
  const warm = readWarmCliProbe();
  if (warm) return warm;
  if (cliProbeInFlight) return cliProbeInFlight;

  cliProbeInFlight = runCursorCliAuthProbeOnce()
    .then((result) => cacheCliProbe(result))
    .catch((err) =>
      cacheCliProbe({
        ok: false,
        detail: err instanceof Error ? err.message : "cursor-agent unavailable",
      })
    )
    .finally(() => {
      cliProbeInFlight = null;
    });

  return cliProbeInFlight;
}

/** Fire-and-forget warm of the CLI probe cache (no await on request path). */
export function refreshCursorCliAuthInBackground(): void {
  if (readWarmCliProbe() || cliProbeInFlight) return;
  void probeCursorCliAuth().catch(() => {
    /* cached inside probeCursorCliAuth */
  });
}

export interface CursorModelOption {
  id: string;
  label: string;
}

/** Soft human label when the SDK only exposes a slug id. */
export function formatCursorModelLabel(
  id: string,
  displayName?: string | null
): string {
  const fromSdk = displayName?.trim();
  if (fromSdk) return fromSdk;
  const raw = id.trim();
  if (!raw) return id;
  if (/^auto$/i.test(raw)) return "Auto (Cursor picks)";
  // composer-2.5 / composer-2-fast → Composer 2.5 / Composer 2 Fast
  const composer = raw.match(/^composer[-_]?(.+)$/i);
  if (composer) {
    const rest = composer[1]!
      .split(/[-_]/)
      .filter(Boolean)
      .map((p) => (p.toLowerCase() === "fast" ? "Fast" : p))
      .join(" ");
    return rest ? `Composer ${rest}` : "Composer";
  }
  const grok = raw.match(/^grok[-_]?(.*)$/i);
  if (grok) {
    const rest = grok[1]!
      .split(/[-_]/)
      .filter(Boolean)
      .join(" ");
    return rest ? `Grok ${rest}` : "Grok";
  }
  // generic kebab → Title Case words
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function cursorModelSortRank(id: string): number {
  if (/^auto$/i.test(id)) return 0;
  if (/grok/i.test(id)) return 1;
  if (/composer/i.test(id)) return 2;
  return 3;
}

async function fetchCursorSubscriptionModels(
  apiKey: string
): Promise<CursorModelOption[]> {
  const { Cursor } = await import("@cursor/sdk");
  const listed = await Promise.race([
    Cursor.models.list({ apiKey }),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Cursor.models.list timed out")),
        12_000
      );
    }),
  ]);
  const models = listed;
  const out: CursorModelOption[] = [
    { id: "auto", label: "Auto (Cursor picks)" },
  ];
  const seen = new Set<string>(["auto"]);
  const named: CursorModelOption[] = [];
  for (const m of models) {
    const id = String(m.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const row = m as unknown as { displayName?: unknown; name?: unknown };
    const display =
      typeof row.displayName === "string"
        ? row.displayName
        : typeof row.name === "string"
          ? row.name
          : null;
    named.push({ id, label: formatCursorModelLabel(id, display) });
  }
  named.sort((a, b) => {
    const rank = cursorModelSortRank(a.id) - cursorModelSortRank(b.id);
    if (rank !== 0) return rank;
    return a.label.localeCompare(b.label);
  });
  out.push(...named);
  return out;
}

const AUTO_ONLY_MODELS: CursorModelOption[] = [
  { id: "auto", label: "Auto (Cursor picks)" },
];

/** Warm models cache for this key, if any. Does not network. */
export function peekCachedCursorSubscriptionModels(
  db: AppDatabase,
  agentId?: string | null
): CursorModelOption[] | null {
  const apiKey = resolveCursorApiKey(db, agentId);
  if (!apiKey) return null;
  const fp = apiKeyFingerprint(apiKey);
  const warm = modelsCacheByKeyFp.get(fp);
  if (!warm) return null;
  if (Date.now() - warm.at >= CURSOR_MODELS_TTL_MS) return null;
  return warm.models;
}

/**
 * Fire-and-forget warm of models cache. Safe on Intelligence boot:
 * does not block the request that kicked it.
 */
export function refreshCursorSubscriptionModelsInBackground(
  db: AppDatabase,
  agentId?: string | null
): void {
  const apiKey = resolveCursorApiKey(db, agentId);
  if (!apiKey) return;
  const fp = apiKeyFingerprint(apiKey);
  if (modelsInFlightByKeyFp.has(fp)) return;
  const warm = modelsCacheByKeyFp.get(fp);
  if (warm && Date.now() - warm.at < CURSOR_MODELS_TTL_MS) return;
  void listCursorSubscriptionModels(db, agentId).catch(() => {
    /* leave cache empty; next open retries */
  });
}

/**
 * Catalog-friendly: return warm models immediately, or Auto-only while a
 * background refresh fills the cache. Never awaits a cold Cursor.models.list.
 */
export function listCursorSubscriptionModelsForCatalog(
  db: AppDatabase,
  agentId?: string | null
): CursorModelOption[] {
  const warm = peekCachedCursorSubscriptionModels(db, agentId);
  if (warm) return warm;
  refreshCursorSubscriptionModelsInBackground(db, agentId);
  return AUTO_ONLY_MODELS;
}

/** List models available on the user's Cursor subscription (TTL + single-flight). */
export async function listCursorSubscriptionModels(
  db: AppDatabase,
  agentId?: string | null
): Promise<CursorModelOption[]> {
  const apiKey = resolveCursorApiKey(db, agentId);
  if (!apiKey) throw new Error("Cursor not connected. Add an API key first.");

  const fp = apiKeyFingerprint(apiKey);
  const now = Date.now();
  const warm = modelsCacheByKeyFp.get(fp);
  if (warm && now - warm.at < CURSOR_MODELS_TTL_MS) {
    return warm.models;
  }

  const inflight = modelsInFlightByKeyFp.get(fp);
  if (inflight) return inflight;

  const pending = fetchCursorSubscriptionModels(apiKey)
    .then((models) => {
      modelsCacheByKeyFp.set(fp, { at: Date.now(), models });
      return models;
    })
    .finally(() => {
      modelsInFlightByKeyFp.delete(fp);
    });
  modelsInFlightByKeyFp.set(fp, pending);
  return pending;
}

/**
 * Start browser login for cursor-agent (CLI session). Returns a URL for the user
 * to open. Note: @cursor/sdk billing uses CURSOR_API_KEY — CLI login alone does
 * not enable the in-app Cursor Cloud backend.
 */
export async function startCursorCliLoginUrl(): Promise<{ url: string | null; raw: string }> {
  const command = resolveCursorAgentCommand();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(command, ["login"], {
      shell: process.platform === "win32",
      env: { ...process.env, NO_OPEN_BROWSER: "1" },
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("cursor-agent login timed out"));
    }, 120_000);
    proc.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", () => {
      clearTimeout(timer);
      const raw = (stdout + stderr).trim();
      const urlMatch = raw.match(/https:\/\/[^\s]+/);
      resolve({ url: urlMatch?.[0] ?? null, raw: raw.slice(0, 2000) });
    });
  });
}
