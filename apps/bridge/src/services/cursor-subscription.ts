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
import { spawn } from "node:child_process";

/** Fixed secret id/name for the user's Cursor subscription API key. */
export const CURSOR_API_KEY_SECRET_ID = "cursor-api-key";
export const CURSOR_API_KEY_SECRET_NAME = "cursor_api_key";

export type CursorAuthSource = "env" | "vault" | "none";

export interface CursorAuthStatus {
  connected: boolean;
  source: CursorAuthSource;
  masked?: string;
  cliAuthenticated?: boolean;
  cliDetail?: string;
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
  return removePlatformVaultSecret(db, {
    baseId: CURSOR_API_KEY_SECRET_ID,
    name: CURSOR_API_KEY_SECRET_NAME,
    agentId,
  });
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

export async function probeCursorCliAuth(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const command = resolveCursorAgentCommand();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(command, ["status"], {
      shell: process.platform === "win32",
      env: { ...process.env },
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ ok: false, detail: "cursor-agent status timed out" });
    }, 15_000);
    proc.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, detail: "cursor-agent not installed" });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const text = (stdout || stderr).trim();
      if (code === 0 && /authenticated|logged in/i.test(text)) {
        resolve({ ok: true, detail: text.slice(0, 500) });
        return;
      }
      resolve({
        ok: false,
        detail: text || `cursor-agent status exited ${code}`,
      });
    });
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

/** List models available on the user's Cursor subscription. */
export async function listCursorSubscriptionModels(
  db: AppDatabase,
  agentId?: string | null
): Promise<CursorModelOption[]> {
  const apiKey = resolveCursorApiKey(db, agentId);
  if (!apiKey) throw new Error("Cursor not connected — add an API key first");

  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
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
