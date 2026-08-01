/**
 * GitHub Connect tokens for Projects sync (per-user Vault secret).
 * Prefers GitHub App user-to-server + installation id; falls back to classic OAuth.
 */
import type { AppDatabase } from "../db.js";
import {
  getSecretValue,
  listSecrets,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";
import { config } from "../config.js";
import { getUserOwnerTenantDb } from "./user-scope.js";
import {
  buildGithubAppInstallUrl,
  createInstallationAccessToken,
  githubAppConfigured,
  listGithubAppInstallations,
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

export function readGithubProjectsToken(db: AppDatabase): GithubProjectsToken | null {
  const byId = getSecretValue(db, GITHUB_PROJECTS_SECRET_ID);
  const raw =
    byId ??
    (() => {
      const named = listSecrets(db).find(
        (s) => s.name === GITHUB_PROJECTS_SECRET_NAME
      );
      return named ? getSecretValue(db, named.id) : null;
    })();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GithubProjectsToken;
    if (!parsed?.accessToken && !parsed?.installationId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function upsertGithubProjectsToken(
  db: AppDatabase,
  token: GithubProjectsToken
): void {
  db.prepare(`DELETE FROM ai_secrets WHERE id = ? OR name = ?`).run(
    GITHUB_PROJECTS_SECRET_ID,
    GITHUB_PROJECTS_SECRET_NAME
  );
  db.prepare(`INSERT INTO ai_secrets (id, name, value) VALUES (?, ?, ?)`).run(
    GITHUB_PROJECTS_SECRET_ID,
    GITHUB_PROJECTS_SECRET_NAME,
    encryptSecret(JSON.stringify(token))
  );
}

export function clearGithubProjectsToken(db: AppDatabase): void {
  db.prepare(`DELETE FROM ai_secrets WHERE id = ? OR name = ?`).run(
    GITHUB_PROJECTS_SECRET_ID,
    GITHUB_PROJECTS_SECRET_NAME
  );
}

export function githubProjectsStatus(db: AppDatabase): {
  connected: boolean;
  login: string | null;
  configured: boolean;
  githubApp: boolean;
  installationId: number | null;
  installUrl: string | null;
} {
  const token = readGithubProjectsToken(db);
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

/** Owner-tenant DB helper for routes that only have userId. */
export function ownerDbForUser(userId: string): AppDatabase {
  return getUserOwnerTenantDb(userId);
}

/**
 * Token for Projects GraphQL / REST.
 * Prefers installation access token when App + installationId are present.
 */
export async function resolveGithubProjectsAccessToken(
  db: AppDatabase
): Promise<string> {
  const stored = readGithubProjectsToken(db);
  if (!stored) {
    throw Object.assign(
      new Error("Connect GitHub in Settings before linking a Project"),
      { status: 400 }
    );
  }
  if (githubAppConfigured() && stored.installationId) {
    const { token } = await createInstallationAccessToken(stored.installationId);
    return token;
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
  throw Object.assign(
    new Error("Connect GitHub in Settings before linking a Project"),
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
      const installs = await listGithubAppInstallations();
      if (login) {
        const match = installs.find(
          (i) => i.accountLogin.toLowerCase() === login!.toLowerCase()
        );
        installationId = match?.id ?? installs[0]?.id ?? null;
      } else {
        installationId = installs[0]?.id ?? null;
      }
    } catch (err) {
      console.warn(
        "[github-integration] list installations failed:",
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
  if (source !== "github_app") {
    url.searchParams.set("scope", GITHUB_PROJECTS_OAUTH_SCOPES);
  }
  url.searchParams.set("state", state);
  return url.toString();
}
