/**
 * Scrub Vault / credential plaintext out of model-bound tool transcripts.
 * Bridge still decrypts in-process for API clients; this keeps secrets out of
 * chat history, tool results, and terminal/FS payloads the model sees.
 */

import type { AppDatabase } from "../db.js";
import {
  listSecrets,
  getSecretValue,
  type VaultOwner,
} from "./agents/agents-db.js";
import { decryptSecret } from "./holdings/crypto-box.js";

/** Common provider / GitHub / Slack-style secret shapes. */
export const SECRETISH =
  /\b(?:sk-[a-zA-Z0-9_-]{10,}|sk-ant-[a-zA-Z0-9_-]{10,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|ghu_[a-zA-Z0-9]{20,}|ghs_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|xai-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|key-[a-zA-Z0-9]{16,})\b/g;

const SENSITIVE_ARG_KEYS = new Set([
  "value",
  "api_key",
  "apiKey",
  "secret",
  "token",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "password",
  "client_secret",
  "clientSecret",
  "authorization",
  "Authorization",
]);

export type SecretScrubEntry = { ref: string; value: string };

function tryDecryptStored(value: string): string | null {
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

/**
 * Collect plaintext values the agent can resolve (agent vault + platform vault
 * + agent account tokens) for known-value scrubbing.
 */
export function collectAgentSecretPlaintexts(
  db: AppDatabase,
  agentId?: string | null
): SecretScrubEntry[] {
  const entries: SecretScrubEntry[] = [];
  const seen = new Set<string>();

  const push = (ref: string, value: string | null | undefined) => {
    if (!value || value.length < 8) return;
    if (seen.has(value)) return;
    seen.add(value);
    entries.push({ ref, value });
  };

  const owners: VaultOwner[] = [{ kind: "platform" }];
  if (agentId) {
    owners.push({ kind: "agent", agentId });
  }

  for (const owner of owners) {
    for (const item of listSecrets(db, owner)) {
      const plain = getSecretValue(db, item.id);
      push(item.name || item.id, plain);
    }
  }

  if (agentId) {
    try {
      const rows = db
        .prepare(
          `SELECT id, provider, access_token, refresh_token FROM ai_agent_accounts
           WHERE agent_id = ? AND status = 'active'`
        )
        .all(agentId) as Array<{
        id: string;
        provider: string | null;
        access_token: string | null;
        refresh_token: string | null;
      }>;
      for (const row of rows) {
        const ref = row.provider
          ? `account:${row.provider}`
          : `account:${row.id}`;
        if (row.access_token) {
          push(ref, tryDecryptStored(row.access_token));
        }
        if (row.refresh_token) {
          push(`${ref}:refresh`, tryDecryptStored(row.refresh_token));
        }
      }
    } catch {
      // Table may be absent in minimal test DBs.
    }
  }

  return entries;
}

/** Replace known vault values then SECRETISH patterns. */
export function scrubSecretsInText(
  text: string,
  known: SecretScrubEntry[] = []
): string {
  let out = text ?? "";
  // Longest first so partial overlaps prefer full secrets
  const sorted = [...known].sort((a, b) => b.value.length - a.value.length);
  for (const { ref, value } of sorted) {
    if (!value) continue;
    if (!out.includes(value)) continue;
    out = out.split(value).join(`[secret:${ref}]`);
  }
  out = out.replace(SECRETISH, "[redacted]");
  return out;
}

export function scrubSecretsForAgent(
  db: AppDatabase,
  agentId: string | null | undefined,
  text: string
): string {
  return scrubSecretsInText(text, collectAgentSecretPlaintexts(db, agentId));
}

/** Redact sensitive keys in tool-call argument objects before UI / history. */
export function scrubSensitiveToolArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (SENSITIVE_ARG_KEYS.has(key) && typeof val === "string" && val.length > 0) {
      out[key] = "[redacted]";
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = scrubSensitiveToolArgs(val as Record<string, unknown>);
      continue;
    }
    out[key] = val;
  }
  return out;
}

export function scrubToolCallArgumentsJson(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return JSON.stringify(
        scrubSensitiveToolArgs(parsed as Record<string, unknown>)
      );
    }
  } catch {
    /* keep regex scrub below */
  }
  return scrubSecretsInText(argumentsJson);
}

/**
 * Serialize a tool result for the model: known-value scrub, pattern scrub, then
 * length budget.
 */
export function budgetAndScrubToolResult(
  result: unknown,
  opts?: {
    db?: AppDatabase;
    agentId?: string | null;
    maxChars?: number;
    known?: SecretScrubEntry[];
  }
): string {
  const maxChars = opts?.maxChars ?? 12_000;
  let content = typeof result === "string" ? result : JSON.stringify(result);
  const known =
    opts?.known ??
    (opts?.db
      ? collectAgentSecretPlaintexts(opts.db, opts.agentId)
      : undefined);
  if (known) {
    content = scrubSecretsInText(content, known);
  } else {
    content = scrubSecretsInText(content);
  }
  if (content.length <= maxChars) return content;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.floor(maxChars * 0.3);
  const omitted = content.length - head - tail;
  return (
    content.slice(0, head) +
    `\n\n[... ${omitted} chars omitted ...]\n\n` +
    content.slice(-tail)
  );
}
