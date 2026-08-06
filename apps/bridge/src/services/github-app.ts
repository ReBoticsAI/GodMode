/**
 * GitHub App auth: JWT, installation tokens, shared OAuth client resolution.
 * Secrets come from env / key file only (never committed).
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { config } from "../config.js";

export type GithubAppInstallation = {
  id: number;
  accountLogin: string;
  accountType: string;
  targetType: string;
};

function b64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

export function githubAppOauthConfigured(): boolean {
  return Boolean(config.githubApp.clientId && config.githubApp.clientSecret);
}

export function githubAppConfigured(): boolean {
  const app = config.githubApp;
  return Boolean(
    githubAppOauthConfigured() &&
      app.appId &&
      (app.privateKey.trim() || app.privateKeyPath.trim())
  );
}

export function resolveGithubOauthClient(): {
  clientId: string;
  clientSecret: string;
  source: "github_app" | "oauth_app";
} {
  if (githubAppOauthConfigured()) {
    return {
      clientId: config.githubApp.clientId,
      clientSecret: config.githubApp.clientSecret,
      source: "github_app",
    };
  }
  const login = config.oauth.github;
  if (login.clientId && login.clientSecret) {
    return {
      clientId: login.clientId,
      clientSecret: login.clientSecret,
      source: "oauth_app",
    };
  }
  const integration = config.oauth.githubIntegration;
  if (integration.clientId && integration.clientSecret) {
    return {
      clientId: integration.clientId,
      clientSecret: integration.clientSecret,
      source: "oauth_app",
    };
  }
  throw Object.assign(new Error("GitHub OAuth / App is not configured on this host"), {
    status: 503,
  });
}

export function loadGithubAppPrivateKey(): string {
  const path = config.githubApp.privateKeyPath.trim();
  if (path) {
    return fs.readFileSync(path, "utf8");
  }
  const raw = config.githubApp.privateKey.trim();
  if (!raw) {
    throw Object.assign(new Error("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH required"), {
      status: 503,
    });
  }
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/** Short-lived JWT to authenticate as the GitHub App. */
export function signGithubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    })
  );
  const data = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${data}.${b64url(sig)}`;
}

export function createGithubAppJwt(): string {
  if (!config.githubApp.appId) {
    throw Object.assign(new Error("GITHUB_APP_ID required"), { status: 503 });
  }
  return signGithubAppJwt(config.githubApp.appId, loadGithubAppPrivateKey());
}

async function githubAppApi<T>(
  path: string,
  init?: RequestInit & { token?: string }
): Promise<T> {
  const token = init?.token ?? createGithubAppJwt();
  const { token: _t, ...rest } = init ?? {};
  const res = await fetch(`https://api.github.com${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "GodMode",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`GitHub App API ${path} failed (${res.status}): ${body.slice(0, 200)}`),
      { status: res.status === 401 || res.status === 403 ? 403 : 502 }
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function mapGithubInstallations(
  rows: Array<{
    id: number;
    target_type?: string;
    account?: { login?: string; type?: string };
  }> | null | undefined
): GithubAppInstallation[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    accountLogin: r.account?.login ?? "",
    accountType: r.account?.type ?? "",
    targetType: r.target_type ?? "",
  }));
}

export async function listGithubAppInstallations(): Promise<GithubAppInstallation[]> {
  const rows = await githubAppApi<
    Array<{
      id: number;
      target_type?: string;
      account?: { login?: string; type?: string };
    }>
  >("/app/installations");
  return mapGithubInstallations(rows);
}

/**
 * Installations visible to a user-to-server token (not the full App install list).
 * Prefer this after Connect OAuth so we never default to a platform org install.
 */
export async function listGithubUserInstallations(
  userAccessToken: string
): Promise<GithubAppInstallation[]> {
  const data = await githubAppApi<{
    installations?: Array<{
      id: number;
      target_type?: string;
      account?: { login?: string; type?: string };
    }>;
  }>("/user/installations", { token: userAccessToken });
  return mapGithubInstallations(data?.installations);
}

/**
 * Pick an App installation for Connect storage.
 * Never falls back to "first install on the App" (that was the platform org on Cloud).
 */
export function pickGithubInstallationId(
  installs: Array<{ id: number; accountLogin: string }>,
  login: string | undefined | null
): number | null {
  if (!installs.length) return null;
  const needle = login?.trim().toLowerCase();
  if (needle) {
    const match = installs.find(
      (i) => i.accountLogin.trim().toLowerCase() === needle
    );
    if (match) return match.id;
  }
  if (installs.length === 1) return installs[0]!.id;
  return null;
}

export async function createInstallationAccessToken(
  installationId: number
): Promise<{ token: string; expiresAt: string }> {
  const jwt = createGithubAppJwt();
  const data = await githubAppApi<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST", token: jwt }
  );
  return { token: data.token, expiresAt: data.expires_at };
}

/** Prefer platform account install (Core Support / operator Projects). */
export async function resolvePlatformInstallationId(): Promise<number | null> {
  const configured = Number(config.githubApp.platformInstallationId);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const login = (config.githubApp.platformAccountLogin || "ReBoticsAI").toLowerCase();
  const installs = await listGithubAppInstallations();
  const hit = installs.find((i) => i.accountLogin.toLowerCase() === login);
  return hit?.id ?? null;
}

export function buildGithubAppInstallUrl(state?: string): string {
  const slug = config.githubApp.slug.trim() || "godmode-cloud";
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function verifyGithubWebhookSignatureWithSecret(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!secret) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(received, "utf8")
    );
  } catch {
    return false;
  }
}

export function verifyGithubWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined
): boolean {
  return verifyGithubWebhookSignatureWithSecret(
    rawBody,
    signatureHeader,
    config.githubApp.webhookSecret
  );
}
