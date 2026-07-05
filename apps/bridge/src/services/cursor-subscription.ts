import type { AppDatabase } from "../db.js";
import {
  deleteSecret,
  getSecretValue,
  listSecrets,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";
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

export function resolveCursorApiKey(db: AppDatabase): string | null {
  const env = process.env.CURSOR_API_KEY?.trim();
  if (env) return env;
  const stored =
    getSecretValue(db, CURSOR_API_KEY_SECRET_ID) ??
    listSecrets(db).find((s) => s.name === CURSOR_API_KEY_SECRET_NAME)?.id;
  if (!stored) return null;
  return getSecretValue(db, stored);
}

export function upsertCursorApiKey(db: AppDatabase, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key required");
  db.prepare(`DELETE FROM ai_secrets WHERE id = ? OR name = ?`).run(
    CURSOR_API_KEY_SECRET_ID,
    CURSOR_API_KEY_SECRET_NAME
  );
  db.prepare(`INSERT INTO ai_secrets (id, name, value) VALUES (?, ?, ?)`).run(
    CURSOR_API_KEY_SECRET_ID,
    CURSOR_API_KEY_SECRET_NAME,
    encryptSecret(trimmed)
  );
}

export function removeCursorApiKey(db: AppDatabase): boolean {
  return deleteSecret(db, CURSOR_API_KEY_SECRET_ID);
}

export function getCursorAuthStatus(db: AppDatabase): CursorAuthStatus {
  const env = process.env.CURSOR_API_KEY?.trim();
  if (env) {
    return {
      connected: true,
      source: "env",
      masked: env.length > 8 ? `${env.slice(0, 4)}…${env.slice(-4)}` : "****",
    };
  }
  const stored = getSecretValue(db, CURSOR_API_KEY_SECRET_ID);
  if (stored) {
    return {
      connected: true,
      source: "vault",
      masked:
        stored.length > 8 ? `${stored.slice(0, 4)}…${stored.slice(-4)}` : "****",
    };
  }
  return { connected: false, source: "none" };
}

/** True when Intelligence can run without a local llama-server. */
export function isCursorSubscriptionReady(db: AppDatabase): boolean {
  return getCursorAuthStatus(db).connected;
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

/** List models available on the user's Cursor subscription. */
export async function listCursorSubscriptionModels(
  db: AppDatabase
): Promise<CursorModelOption[]> {
  const apiKey = resolveCursorApiKey(db);
  if (!apiKey) throw new Error("Cursor not connected — add an API key first");

  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  const out: CursorModelOption[] = [{ id: "auto", label: "Auto" }];
  const seen = new Set<string>(["auto"]);
  for (const m of models) {
    const id = String(m.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
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
