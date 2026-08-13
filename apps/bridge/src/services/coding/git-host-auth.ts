/**
 * GitHub Connect credentials for coding-root git host flows (#442).
 * Reuses Vault-stored Projects / Connect tokens; no parallel secret store.
 */
import type { AppDatabase } from "../../db.js";
import { resolveGithubProjectsAccessToken } from "../github-integration.js";

export type GithubHttpsRemote = {
  owner: string;
  repo: string;
  /** Canonical https://github.com/owner/repo.git form (no credentials). */
  httpsUrl: string;
};

const GITHUB_HTTPS_RE =
  /^https:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?(?:[?#].*)?$/i;

/** Parse a github.com HTTPS remote; ignore SSH and non-GitHub hosts. */
export function parseGithubHttpsRemote(raw: string): GithubHttpsRemote | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
    candidate = `https://github.com${u.pathname}`;
  } catch {
    /* fall through to regex */
  }
  const m = candidate.match(GITHUB_HTTPS_RE);
  if (!m) return null;
  const owner = decodeURIComponent(m[1] ?? "").trim();
  const repo = decodeURIComponent(m[2] ?? "").trim().replace(/\.git$/i, "");
  if (!owner || !repo || owner.includes(":") || repo.includes(":")) return null;
  return {
    owner,
    repo,
    httpsUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

/** Strip embedded credentials from a remote URL for logs / previews. */
export function redactRemoteUrl(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return u.toString();
    }
  } catch {
    /* keep original */
  }
  return trimmed.replace(/\/\/[^/@\s]+@/g, "//");
}

/**
 * Env overlay so `git` can authenticate to github.com without rewriting remotes.
 * Uses GIT_CONFIG_* so the token stays out of argv.
 */
export function githubHttpsAuthGitEnv(accessToken: string): NodeJS.ProcessEnv {
  const token = String(accessToken ?? "").trim();
  if (!token) {
    throw new Error("GitHub access token required");
  }
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export async function resolveCodingGithubAccessToken(
  db: AppDatabase
): Promise<string> {
  try {
    return await resolveGithubProjectsAccessToken(db);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 400) {
      throw Object.assign(
        new Error(
          "Connect GitHub in Vault → Integrations before clone, push, or opening a pull request"
        ),
        { status: 400 }
      );
    }
    throw err;
  }
}
