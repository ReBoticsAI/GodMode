/**
 * Create a public GitHub repository via Vault GitHub Connect.
 * Create-only: this module never calls DELETE /repos.
 */
import { config } from "../../config.js";

const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

export type CreateGithubRepositoryInput = {
  accessToken: string;
  name: string;
  description?: string;
  /** Optional org login. Omit to create under the connected GitHub user. */
  owner?: string | null;
  homepage?: string;
};

export type CreateGithubRepositoryResult = {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string | null;
};

export function assertSafeGithubRepoName(raw: string): string {
  const name = String(raw ?? "").trim();
  if (!name) throw new Error("repository name required");
  if (name.length > 100) throw new Error("repository name too long");
  if (name === "." || name === "..") throw new Error("invalid repository name");
  if (!REPO_NAME_RE.test(name) || name.startsWith("-")) {
    throw new Error(
      "repository name may contain letters, numbers, dots, underscores, and hyphens"
    );
  }
  return name;
}

export function platformGithubAccountLogin(): string {
  return (config.githubApp.platformAccountLogin || "ReBoticsAI").trim();
}

export function isPlatformGithubOwner(owner: string): boolean {
  const platform = platformGithubAccountLogin().toLowerCase();
  if (!platform) return false;
  return owner.trim().toLowerCase() === platform;
}

export function assertNotPlatformGithubOwner(owner: string): void {
  if (isPlatformGithubOwner(owner)) {
    throw new Error(
      `Cannot create repositories on the platform GitHub account (${platformGithubAccountLogin()}). Use your personal GitHub user or a seller organization.`
    );
  }
}

async function githubJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; json: T }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "GodMode",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, json };
}

export async function lookupGithubUserLogin(accessToken: string): Promise<string> {
  const token = String(accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");
  const { ok, status, json } = await githubJson<{ login?: string; message?: string }>(
    "https://api.github.com/user",
    token
  );
  const login = String(json.login ?? "").trim();
  if (!ok || !login) {
    throw new Error(
      `GitHub user lookup failed: ${json.message || `HTTP ${status}`}`
    );
  }
  return login;
}

/**
 * Create a public repo under the connected GitHub user (or a non-platform org).
 * Never deletes. Community listings require public repos.
 */
export async function createGithubRepository(
  input: CreateGithubRepositoryInput
): Promise<CreateGithubRepositoryResult> {
  const token = String(input.accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");
  const name = assertSafeGithubRepoName(input.name);
  const description = String(input.description ?? "").trim();
  const homepage = String(input.homepage ?? "").trim();
  const requestedOwner = String(input.owner ?? "").trim();
  if (requestedOwner) assertNotPlatformGithubOwner(requestedOwner);

  const userLogin = await lookupGithubUserLogin(token);
  assertNotPlatformGithubOwner(userLogin);

  const owner = requestedOwner || userLogin;
  assertNotPlatformGithubOwner(owner);

  const body: Record<string, unknown> = {
    name,
    private: false,
    auto_init: false,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
  };
  if (description) body.description = description;
  if (homepage) body.homepage = homepage;

  const createUrl =
    owner.toLowerCase() === userLogin.toLowerCase()
      ? "https://api.github.com/user/repos"
      : `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`;

  const { ok, status, json } = await githubJson<{
    name?: string;
    full_name?: string;
    html_url?: string;
    clone_url?: string;
    private?: boolean;
    default_branch?: string;
    owner?: { login?: string };
    message?: string;
    errors?: Array<{ message?: string }>;
  }>(createUrl, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!ok) {
    const detail =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      json.message ||
      `HTTP ${status}`;
    throw new Error(`GitHub repository create failed: ${detail}`);
  }

  const repo = String(json.name ?? name).replace(/\.git$/i, "");
  const htmlUrl = String(json.html_url ?? "").trim();
  const cloneUrl = String(json.clone_url ?? "").trim();
  const fullName = String(json.full_name ?? `${owner}/${repo}`).trim();
  if (!htmlUrl || !cloneUrl) {
    throw new Error("GitHub repository create response missing html_url or clone_url");
  }
  return {
    owner: String(json.owner?.login ?? owner),
    repo,
    fullName,
    htmlUrl,
    cloneUrl,
    private: Boolean(json.private),
    defaultBranch: json.default_branch ? String(json.default_branch) : null,
  };
}
