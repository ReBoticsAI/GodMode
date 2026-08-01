/**
 * Exa-backed web_search / fetch_url (#218).
 *
 * Cloud SaaS: tenant/agent Exa BYOK only (Vault `exa_api_key` or AgentAccount
 * provider `exa`). No platform/shared key fallback; missing key and exhausted
 * credits hard-fail with actionable messages.
 *
 * Self-host / local: Exa is optional. When a key is present, tools use Exa;
 * otherwise DuckDuckGo / raw fetch remain available.
 */
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";
import { listSecrets, getSecretValue } from "./agents/agents-db.js";
import { resolveAgentCredential } from "./agents/agent-accounts.js";

export const EXA_PROVIDER = "exa";
export const EXA_API_KEY_SECRET_NAME = "exa_api_key";
export const EXA_SIGNUP_URL = "https://dashboard.exa.ai";
export const EXA_BILLING_URL = "https://dashboard.exa.ai/billing";
export const EXA_API_BASE = "https://api.exa.ai";

export interface ExaWebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type ExaErrorKind = "missing_key" | "auth" | "credits" | "http" | "network";

export class ExaApiError extends Error {
  readonly kind: ExaErrorKind;
  readonly status?: number;

  constructor(kind: ExaErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ExaApiError";
    this.kind = kind;
    this.status = status;
  }
}

/** Official Cloud SaaS requires Exa BYOK for agent web tools. */
export function cloudRequiresExaByok(): boolean {
  return config.isSaas;
}

/**
 * Resolve tenant/agent Exa key: agent account (provider `exa`) first, then
 * Vault secret named `exa_api_key`. Never reads a platform env key.
 */
export function resolveExaApiKey(db: AppDatabase, agentId: string): string | null {
  const fromAgent = resolveAgentCredential(db, agentId, { provider: EXA_PROVIDER });
  if (fromAgent?.trim()) return fromAgent.trim();

  const named = listSecrets(db).find(
    (s) => s.name.toLowerCase() === EXA_API_KEY_SECRET_NAME
  );
  if (named) {
    const value = getSecretValue(db, named.id);
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function missingExaKeyMessage(): string {
  return (
    `Exa API key required for web_search / fetch_url on GodMode Cloud. ` +
    `Sign up at ${EXA_SIGNUP_URL}, create an API key, then paste it into Vault ` +
    `as secret name "${EXA_API_KEY_SECRET_NAME}" (or add provider "${EXA_PROVIDER}" ` +
    `under the agent's API keys). There is no shared platform Exa key.`
  );
}

export function creditsExhaustedMessage(): string {
  return (
    `Exa reports insufficient credits or an over-budget key. ` +
    `Add credits or wait for the monthly free refresh at ${EXA_BILLING_URL}, ` +
    `or update the Exa key in Vault / agent accounts. GodMode will not retry against a dead balance.`
  );
}

function looksLikeCreditsFailure(status: number, body: string): boolean {
  if (status === 402) return true;
  const lower = body.toLowerCase();
  if (
    /insufficient[_\s-]?credit|out of credit|credit(?:s)?\s+(?:exhausted|depleted|empty)|over[_\s-]?budget|payment\s+required|billing/i.test(
      lower
    )
  ) {
    return true;
  }
  return false;
}

async function exaRequest(
  apiKey: string,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${EXA_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ExaApiError(
      "network",
      `Exa request failed: ${(err as Error).message}`
    );
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ExaApiError(
        "auth",
        `Exa rejected the API key (HTTP ${res.status}). Update the key in Vault (name "${EXA_API_KEY_SECRET_NAME}") or the agent's "${EXA_PROVIDER}" credential.`,
        res.status
      );
    }
    if (looksLikeCreditsFailure(res.status, text)) {
      throw new ExaApiError("credits", creditsExhaustedMessage(), res.status);
    }
    throw new ExaApiError(
      "http",
      `Exa HTTP ${res.status}: ${text.slice(0, 400) || res.statusText}`,
      res.status
    );
  }

  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ExaApiError("http", "Exa returned non-JSON response");
  }
}

function snippetFromResult(row: Record<string, unknown>): string {
  if (typeof row.summary === "string" && row.summary.trim()) return row.summary.trim();
  if (Array.isArray(row.highlights) && row.highlights.length > 0) {
    return row.highlights.map(String).join(" ").trim();
  }
  if (typeof row.text === "string" && row.text.trim()) {
    return row.text.trim().slice(0, 400);
  }
  return "";
}

/** Search via Exa `/search` (egress through Exa, not the VPS IP). */
export async function exaWebSearch(
  apiKey: string,
  opts: { query: string; limit: number }
): Promise<{ query: string; results: ExaWebSearchResult[]; provider: "exa" }> {
  const data = (await exaRequest(apiKey, "/search", {
    query: opts.query,
    numResults: opts.limit,
    type: "auto",
    contents: {
      highlights: true,
      text: { maxCharacters: 500 },
    },
  })) as { results?: Array<Record<string, unknown>> };

  const results: ExaWebSearchResult[] = (data.results ?? [])
    .map((row) => {
      const url = String(row.url ?? row.id ?? "").trim();
      const title = String(row.title ?? "").trim() || url;
      if (!url) return null;
      return {
        title,
        url,
        snippet: snippetFromResult(row),
      };
    })
    .filter((r): r is ExaWebSearchResult => r != null)
    .slice(0, opts.limit);

  return { query: opts.query, results, provider: "exa" };
}

/** Fetch URL contents via Exa `/contents` (egress through Exa). */
export async function exaFetchUrl(
  apiKey: string,
  opts: { url: string; maxChars: number }
): Promise<{
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  provider: "exa";
}> {
  const data = (await exaRequest(apiKey, "/contents", {
    urls: [opts.url],
    text: { maxCharacters: opts.maxChars },
  })) as {
    results?: Array<Record<string, unknown>>;
    statuses?: Array<{ id?: string; status?: string; error?: string }>;
  };

  const status = data.statuses?.[0];
  if (status && status.status && status.status !== "success") {
    throw new ExaApiError(
      "http",
      `Exa could not fetch ${opts.url}: ${status.error ?? status.status}`
    );
  }

  const row = data.results?.[0];
  if (!row) {
    throw new ExaApiError("http", `Exa returned no contents for ${opts.url}`);
  }

  const fullText = String(row.text ?? "").trim();
  const text = fullText.slice(0, opts.maxChars);
  return {
    url: String(row.url ?? opts.url),
    title: String(row.title ?? "").trim(),
    text,
    truncated: fullText.length > opts.maxChars,
    provider: "exa",
  };
}

/** Tool-facing error payload (no silent retries). */
export function exaErrorPayload(
  tool: "web_search" | "fetch_url",
  err: unknown,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  if (err instanceof ExaApiError) {
    return {
      error: err.message,
      code: `exa:${err.kind}`,
      tool,
      ...extra,
    };
  }
  return {
    error: (err as Error).message ?? String(err),
    code: "exa:http",
    tool,
    ...extra,
  };
}
