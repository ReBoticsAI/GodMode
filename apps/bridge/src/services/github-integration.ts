/**
 * GitHub integration OAuth tokens for Projects sync (per-user Vault secret).
 * Separate from login OAuth (read:user user:email only).
 */
import type { AppDatabase } from "../db.js";
import {
  getSecretValue,
  listSecrets,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";
import { config } from "../config.js";
import { getUserOwnerTenantDb } from "./user-scope.js";

export const GITHUB_PROJECTS_SECRET_ID = "github-projects-oauth";
export const GITHUB_PROJECTS_SECRET_NAME = "github_projects_oauth";

/** Scopes for Projects sync + issue field updates. */
export const GITHUB_PROJECTS_OAUTH_SCOPES = "read:user project repo";

export type GithubProjectsToken = {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  login?: string;
  connectedAt: string;
};

export function githubIntegrationOauthConfigured(): boolean {
  return Boolean(
    config.oauth.githubIntegration.clientId &&
      config.oauth.githubIntegration.clientSecret
  );
}

export function githubIntegrationClient(): {
  clientId: string;
  clientSecret: string;
} {
  const { clientId, clientSecret } = config.oauth.githubIntegration;
  if (!clientId || !clientSecret) {
    throw Object.assign(
      new Error("GitHub Projects OAuth is not configured on this host"),
      { status: 503 }
    );
  }
  return { clientId, clientSecret };
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
    if (!parsed?.accessToken) return null;
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
} {
  const token = readGithubProjectsToken(db);
  return {
    configured: githubIntegrationOauthConfigured(),
    connected: Boolean(token?.accessToken),
    login: token?.login ?? null,
  };
}

/** Owner-tenant DB helper for routes that only have userId. */
export function ownerDbForUser(userId: string): AppDatabase {
  return getUserOwnerTenantDb(userId);
}

export async function exchangeGithubIntegrationCode(
  code: string
): Promise<GithubProjectsToken> {
  const { clientId, clientSecret } = githubIntegrationClient();
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
  return {
    accessToken: tokenJson.access_token,
    tokenType: tokenJson.token_type,
    scope: tokenJson.scope,
    login,
    connectedAt: new Date().toISOString(),
  };
}

export function buildGithubIntegrationAuthorizeUrl(state: string): string {
  const { clientId } = githubIntegrationClient();
  const redirectUri = `${config.auth.publicUrl.replace(/\/$/, "")}/api/integrations/github/callback`;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", GITHUB_PROJECTS_OAUTH_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}
