import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../../db.js";
import { encryptSecret, decryptSecret } from "../holdings/crypto-box.js";
import { maskSecret } from "./agents-db.js";

export type AgentAccountKind = "oauth" | "apikey";
export type AgentAccountStatus = "active" | "revoked";

export interface AgentAccountRow {
  id: string;
  agent_id: string;
  kind: AgentAccountKind;
  provider: string | null;
  provider_user_id: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  scopes_json: string | null;
  status: AgentAccountStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentAccount {
  id: string;
  agentId: string;
  kind: AgentAccountKind;
  provider: string | null;
  providerUserId: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  status: AgentAccountStatus;
  maskedToken: string | null;
  createdAt: string;
  updatedAt: string;
}

function readTokenPlain(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

function writeTokenPlain(value: string): string {
  return encryptSecret(value);
}

function rowToAccount(row: AgentAccountRow): AgentAccount {
  const plain = readTokenPlain(row.access_token);
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    scopes: row.scopes_json ? (JSON.parse(row.scopes_json) as string[]) : [],
    status: row.status,
    maskedToken: plain ? maskSecret(plain) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAgentAccounts(db: AppDatabase, agentId: string): AgentAccount[] {
  const rows = db
    .prepare(
      `SELECT * FROM ai_agent_accounts WHERE agent_id=? AND status='active' ORDER BY created_at DESC`
    )
    .all(agentId) as AgentAccountRow[];
  return rows.map(rowToAccount);
}

export function getAgentAccount(db: AppDatabase, id: string): AgentAccount | null {
  const row = db.prepare(`SELECT * FROM ai_agent_accounts WHERE id=?`).get(id) as
    | AgentAccountRow
    | undefined;
  return row ? rowToAccount(row) : null;
}

export function upsertAgentOAuthAccount(
  db: AppDatabase,
  input: {
    agentId: string;
    provider: string;
    providerUserId: string;
    email?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    scopes?: string[];
  }
): AgentAccount {
  const existing = db
    .prepare(
      `SELECT id FROM ai_agent_accounts
       WHERE agent_id=? AND kind='oauth' AND provider=? AND provider_user_id=?`
    )
    .get(input.agentId, input.provider, input.providerUserId) as { id: string } | undefined;

  const id = existing?.id ?? uuidv4();
  const scopesJson = JSON.stringify(input.scopes ?? []);

  if (existing) {
    db.prepare(
      `UPDATE ai_agent_accounts SET
        email=?, display_name=?, avatar_url=?,
        access_token=?, refresh_token=?, scopes_json=?,
        status='active', updated_at=datetime('now')
       WHERE id=?`
    ).run(
      input.email ?? null,
      input.displayName ?? null,
      input.avatarUrl ?? null,
      writeTokenPlain(input.accessToken),
      input.refreshToken ? writeTokenPlain(input.refreshToken) : null,
      scopesJson,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO ai_agent_accounts (
        id, agent_id, kind, provider, provider_user_id, email, display_name, avatar_url,
        access_token, refresh_token, scopes_json, status
      ) VALUES (?, ?, 'oauth', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      id,
      input.agentId,
      input.provider,
      input.providerUserId,
      input.email ?? null,
      input.displayName ?? null,
      input.avatarUrl ?? null,
      writeTokenPlain(input.accessToken),
      input.refreshToken ? writeTokenPlain(input.refreshToken) : null,
      scopesJson
    );
  }
  return getAgentAccount(db, id)!;
}

export function createAgentApiKeyAccount(
  db: AppDatabase,
  input: {
    agentId: string;
    provider: string;
    label?: string;
    apiKey: string;
  }
): AgentAccount {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_agent_accounts (
      id, agent_id, kind, provider, provider_user_id, display_name,
      access_token, status
    ) VALUES (?, ?, 'apikey', ?, ?, ?, ?, 'active')`
  ).run(
    id,
    input.agentId,
    input.provider,
    input.label ?? input.provider,
    input.label ?? `${input.provider} key`,
    writeTokenPlain(input.apiKey)
  );
  return getAgentAccount(db, id)!;
}

export function revokeAgentAccount(db: AppDatabase, id: string, agentId: string): boolean {
  return (
    db
      .prepare(
        `UPDATE ai_agent_accounts SET status='revoked', updated_at=datetime('now')
         WHERE id=? AND agent_id=?`
      )
      .run(id, agentId).changes > 0
  );
}

/** Resolve OAuth/API key for provider backends: agent account first, then tenant secret id. */
export function resolveAgentCredential(
  db: AppDatabase,
  agentId: string,
  opts: { provider?: string; secretId?: string }
): string | null {
  if (opts.provider) {
    const row = db
      .prepare(
        `SELECT access_token FROM ai_agent_accounts
         WHERE agent_id=? AND status='active' AND kind='oauth' AND provider=?
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(agentId, opts.provider) as { access_token: string | null } | undefined;
    const oauth = readTokenPlain(row?.access_token ?? null);
    if (oauth) return oauth;

    const apiRow = db
      .prepare(
        `SELECT access_token FROM ai_agent_accounts
         WHERE agent_id=? AND status='active' AND kind='apikey' AND provider=?
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(agentId, opts.provider) as { access_token: string | null } | undefined;
    const apiKey = readTokenPlain(apiRow?.access_token ?? null);
    if (apiKey) return apiKey;
  }

  if (opts.secretId) {
    const row = db
      .prepare(`SELECT value FROM ai_secrets WHERE id=?`)
      .get(opts.secretId) as { value: string } | undefined;
    if (row) return readTokenPlain(row.value);
  }

  return null;
}

export function getAgentOAuthAccessToken(
  db: AppDatabase,
  agentId: string,
  provider: string
): string | null {
  return resolveAgentCredential(db, agentId, { provider });
}
