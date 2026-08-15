/**
 * GitHub Connect tokens for Projects sync (per-user Vault secret).
 * Prefers GitHub App user-to-server + installation id; falls back to classic OAuth.
 */
import type { AppDatabase } from "../db.js";
import { getCloudDb } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { getUserDb } from "../user-registry.js";
import {
  getSecretValue,
  resolveVaultAccountUserId,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";
import { config } from "../config.js";
import {
  buildGithubAppInstallUrl,
  createInstallationAccessToken,
  githubAppConfigured,
  listGithubUserInstallations,
  pickGithubInstallationId,
  resolveGithubOauthClient,
} from "./github-app.js";

export const GITHUB_PROJECTS_SECRET_ID = "github-projects-oauth";
export const GITHUB_PROJECTS_SECRET_NAME = "github_projects_oauth";

/** Legacy OAuth App scopes (ignored by GitHub App user auth; permissions come from the App). */
export const GITHUB_PROJECTS_OAUTH_SCOPES =
  "read:user read:org project repo";

export type GithubProjectsToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
  login?: string;
  installationId?: number | null;
  source?: "github_app" | "oauth_app";
  connectedAt: string;
};

export function githubIntegrationOauthConfigured(): boolean {
  try {
    resolveGithubOauthClient();
    return true;
  } catch {
    return false;
  }
}

function parseGithubProjectsToken(raw: string | null): GithubProjectsToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GithubProjectsToken;
    if (!parsed?.accessToken && !parsed?.installationId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readGithubProjectsTokenFromDb(db: AppDatabase): GithubProjectsToken | null {
  const byId = getSecretValue(db, GITHUB_PROJECTS_SECRET_ID);
  if (byId) return parseGithubProjectsToken(byId);
  const named = db
    .prepare(
      `SELECT id FROM ai_secrets
        WHERE owner_kind = 'user' AND agent_id IS NULL AND LOWER(name) = LOWER(?)
        LIMIT 1`
    )
    .get(GITHUB_PROJECTS_SECRET_NAME) as { id: string } | undefined;
  return named ? parseGithubProjectsToken(getSecretValue(db, named.id)) : null;
}

function writeGithubProjectsTokenToDb(
  db: AppDatabase,
  token: GithubProjectsToken
): void {
  db.prepare(
    `DELETE FROM ai_secrets
      WHERE owner_kind = 'user' AND agent_id IS NULL
        AND (id = ? OR name = ?)`
  ).run(GITHUB_PROJECTS_SECRET_ID, GITHUB_PROJECTS_SECRET_NAME);
  db.prepare(
    `INSERT INTO ai_secrets (id, name, value, agent_id, owner_kind) VALUES (?, ?, ?, NULL, 'user')`
  ).run(
    GITHUB_PROJECTS_SECRET_ID,
    GITHUB_PROJECTS_SECRET_NAME,
    encryptSecret(JSON.stringify(token))
  );
}

function deleteGithubProjectsTokenFromDb(db: AppDatabase): void {
  db.prepare(
    `DELETE FROM ai_secrets
      WHERE owner_kind = 'user' AND agent_id IS NULL
        AND (id = ? OR name = ?)`
  ).run(GITHUB_PROJECTS_SECRET_ID, GITHUB_PROJECTS_SECRET_NAME);
}

function ownedWorkspaceIds(userId: string): string[] {
  try {
    const rows = getCloudDb()
      .prepare(
        `SELECT id FROM tenants
         WHERE owner_user_id = ? AND is_operator = 0
         ORDER BY updated_at DESC`
      )
      .all(userId) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Copy GitHub Connect from an owned workspace SQLite file onto the User DB.
 * Idempotent; never crosses accounts. Fixes Connect that landed on a tenant
 * before Personal Vault GitHub was account-scoped.
 */
export function migrateGithubConnectToUserVault(userId: string): GithubProjectsToken | null {
  const userDb = getUserDb(userId);
  const existing = readGithubProjectsTokenFromDb(userDb);
  if (existing) return existing;

  for (const tenantId of ownedWorkspaceIds(userId)) {
    let workspaceDb: AppDatabase;
    try {
      workspaceDb = getTenantDb(tenantId);
    } catch {
      continue;
    }
    const token = readGithubProjectsTokenFromDb(workspaceDb);
    if (!token) continue;
    writeGithubProjectsTokenToDb(userDb, token);
    return token;
  }
  return null;
}

export function readGithubProjectsToken(
  db: AppDatabase,
  userId?: string | null
): GithubProjectsToken | null {
  const accountId = resolveVaultAccountUserId(db, userId);
  if (accountId) {
    migrateGithubConnectToUserVault(accountId);
    const fromUser = readGithubProjectsTokenFromDb(getUserDb(accountId));
    if (fromUser) return fromUser;
  }
  return readGithubProjectsTokenFromDb(db);
}

export function upsertGithubProjectsToken(
  db: AppDatabase,
  token: GithubProjectsToken,
  userId?: string | null
): void {
  const accountId = resolveVaultAccountUserId(db, userId);
  writeGithubProjectsTokenToDb(accountId ? getUserDb(accountId) : db, token);
}

export function clearGithubProjectsToken(
  db: AppDatabase,
  userId?: string | null
): void {
  const accountId = resolveVaultAccountUserId(db, userId);
  if (accountId) {
    deleteGithubProjectsTokenFromDb(getUserDb(accountId));
    for (const tenantId of ownedWorkspaceIds(accountId)) {
      try {
        deleteGithubProjectsTokenFromDb(getTenantDb(tenantId));
      } catch {
        /* workspace file may be missing */
      }
    }
    return;
  }
  deleteGithubProjectsTokenFromDb(db);
}

export function githubProjectsStatus(
  db: AppDatabase,
  userId?: string | null
): {
  connected: boolean;
  login: string | null;
  configured: boolean;
  githubApp: boolean;
  installationId: number | null;
  installUrl: string | null;
} {
  const token = readGithubProjectsToken(db, userId);
  const app = githubAppConfigured();
  return {
    configured: githubIntegrationOauthConfigured(),
    connected: Boolean(token?.accessToken || token?.installationId),
    login: token?.login ?? null,
    githubApp: app,
    installationId: token?.installationId ?? null,
    installUrl: app ? buildGithubAppInstallUrl() : null,
  };
}

/** Account User DB for GitHub Connect (shared across that user's workspaces). */
export function ownerDbForUser(userId: string): AppDatabase {
  return getUserDb(userId);
}

/**
 * Token for Projects GraphQL / REST.
 * Prefers user-to-server token (covers user-owned Projects). Falls back to
 * installation token when only the install id is stored.
 */
export async function resolveGithubProjectsAccessToken(
  db: AppDatabase
): Promise<string> {
  const stored = readGithubProjectsToken(db);
  if (!stored) {
    throw Object.assign(
      new Error("Connect GitHub in Personal Vault → Integrations before linking a Project"),
      { status: 400 }
    );
  }
  if (stored.accessToken) {
    if (stored.expiresAt && stored.refreshToken && githubAppConfigured()) {
      const exp = Date.parse(stored.expiresAt);
      if (Number.isFinite(exp) && exp < Date.now() + 60_000) {
        const refreshed = await refreshGithubUserToken(stored.refreshToken);
        upsertGithubProjectsToken(db, {
          ...stored,
          ...refreshed,
          installationId: stored.installationId,
          login: stored.login,
          connectedAt: stored.connectedAt,
        });
        return refreshed.accessToken;
      }
    }
    return stored.accessToken;
  }
  if (githubAppConfigured() && stored.installationId) {
    const { token } = await createInstallationAccessToken(stored.installationId);
    return token;
  }
  throw Object.assign(
    new Error("Connect GitHub in Personal Vault → Integrations before linking a Project"),
    { status: 400 }
  );
}

async function refreshGithubUserToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
  source: "github_app";
}> {
  const { clientId, clientSecret } = resolveGithubOauthClient();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw Object.assign(new Error("GitHub token refresh failed"), { status: 502 });
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
  };
  if (!json.access_token) {
    throw Object.assign(new Error(json.error || "GitHub refresh returned no token"), {
      status: 502,
    });
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt:
      typeof json.expires_in === "number"
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : undefined,
    tokenType: json.token_type,
    scope: json.scope,
    source: "github_app",
  };
}

export async function exchangeGithubIntegrationCode(
  code: string
): Promise<GithubProjectsToken> {
  const { clientId, clientSecret, source } = resolveGithubOauthClient();
  const redirectUri = `${config.auth.publicUrl.replace(/\/$/, "")}/api/integrations/github/callback`;
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    throw Object.assign(new Error("GitHub token exchange failed"), {
      status: 502,
    });
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenJson.access_token) {
    throw Object.assign(
      new Error(
        tokenJson.error_description ||
          tokenJson.error ||
          "GitHub did not return an access token"
      ),
      { status: 502 }
    );
  }
  let login: string | undefined;
  try {
    const me = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "GodMode",
      },
    });
    if (me.ok) {
      const profile = (await me.json()) as { login?: string };
      login = profile.login;
    }
  } catch {
    /* optional */
  }

  let installationId: number | null = null;
  if (source === "github_app" && githubAppConfigured()) {
    try {
      // User-visible installs only. Never list the App-wide catalog and take [0]
      // (that bound Cloud Connect to the platform org install).
      const installs = await listGithubUserInstallations(tokenJson.access_token);
      installationId = pickGithubInstallationId(installs, login);
    } catch (err) {
      console.warn(
        "[github-integration] list user installations failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt:
      typeof tokenJson.expires_in === "number"
        ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
        : undefined,
    tokenType: tokenJson.token_type,
    scope: tokenJson.scope,
    login,
    installationId,
    source,
    connectedAt: new Date().toISOString(),
  };
}

export function buildGithubIntegrationAuthorizeUrl(state: string): string {
  const { clientId, source } = resolveGithubOauthClient();
  const redirectUri = `${config.auth.publicUrl.replace(/\/$/, "")}/api/integrations/github/callback`;
  // Always use the user OAuth authorize URL for Connect.
  // The App install URL (`/apps/.../installations/new`) only runs OAuth on a *new*
  // install; when the App is already installed it opens the configure page and
  // never returns `code` + `installation_id` to our callback. After OAuth,
  // exchangeGithubIntegrationCode lists installations and stores installationId.
  // First-time install remains a separate link via status.installUrl.
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // Force the account chooser so a cached GitHub session (e.g. platform org
  // owner) does not silently bind Connect to the wrong identity.
  url.searchParams.set("prompt", "select_account");
  if (source !== "github_app") {
    url.searchParams.set("scope", GITHUB_PROJECTS_OAUTH_SCOPES);
  }
  url.searchParams.set("state", state);
  return url.toString();
}
