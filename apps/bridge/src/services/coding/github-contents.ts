/**
 * GitHub Contents / Refs / Fork helpers for catalog submission (Vault Connect).
 */

const API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "GodMode",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson<T>(
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; json: T }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init?.headers as Record<string, string> | undefined) },
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, json };
}

export type GithubAuthenticatedUser = {
  login: string;
  id: number;
};

export async function getGithubAuthenticatedUser(
  token: string
): Promise<GithubAuthenticatedUser> {
  const { ok, json } = await githubJson<{ login?: string; id?: number; message?: string }>(
    token,
    "/user"
  );
  if (!ok || !json.login) {
    throw new Error(json.message ?? "GitHub user lookup failed");
  }
  return { login: json.login, id: Number(json.id ?? 0) };
}

export async function ensureGithubFork(
  token: string,
  upstreamOwner: string,
  upstreamRepo: string
): Promise<{ owner: string; repo: string; defaultBranch: string }> {
  const user = await getGithubAuthenticatedUser(token);
  const forkPath = `/repos/${encodeURIComponent(upstreamOwner)}/${encodeURIComponent(upstreamRepo)}/forks`;
  const forkRes = await githubJson<{ full_name?: string; default_branch?: string; message?: string }>(
    token,
    forkPath,
    { method: "POST", body: "{}" }
  );
  if (forkRes.ok && forkRes.json.default_branch) {
    return {
      owner: user.login,
      repo: upstreamRepo,
      defaultBranch: forkRes.json.default_branch,
    };
  }
  const existing = await githubJson<{ default_branch?: string; message?: string }>(
    token,
    `/repos/${encodeURIComponent(user.login)}/${encodeURIComponent(upstreamRepo)}`
  );
  if (!existing.ok || !existing.json.default_branch) {
    throw new Error(
      forkRes.json.message ??
        existing.json.message ??
        "Could not fork or access GodMode-Marketplace. Fork the repo on GitHub first."
    );
  }
  return {
    owner: user.login,
    repo: upstreamRepo,
    defaultBranch: existing.json.default_branch,
  };
}

export type GithubFileContent = {
  sha: string;
  content: string;
  encoding: string;
};

export async function getGithubFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<GithubFileContent> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const { ok, json } = await githubJson<{
    sha?: string;
    content?: string;
    encoding?: string;
    message?: string;
  }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}${q}`
  );
  if (!ok || !json.sha || !json.content) {
    throw new Error(json.message ?? `Could not read ${path}`);
  }
  return {
    sha: json.sha,
    content: json.content,
    encoding: String(json.encoding ?? "base64"),
  };
}

export function decodeGithubContent(file: GithubFileContent): string {
  if (file.encoding !== "base64") {
    throw new Error(`Unsupported GitHub content encoding: ${file.encoding}`);
  }
  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
}

export async function createGithubBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  fromSha: string
): Promise<void> {
  const { ok, json } = await githubJson<{ message?: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
    }
  );
  if (!ok) {
    throw new Error(json.message ?? `Could not create branch ${branch}`);
  }
}

export async function getGithubBranchSha(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const { ok, json } = await githubJson<{ object?: { sha?: string }; message?: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  if (!ok || !json.object?.sha) {
    throw new Error(json.message ?? `Could not resolve branch ${branch}`);
  }
  return json.object.sha;
}

export async function putGithubFileContent(opts: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  contentUtf8: string;
  sha?: string;
}): Promise<void> {
  const encoded = Buffer.from(opts.contentUtf8, "utf8").toString("base64");
  const { ok, json } = await githubJson<{ message?: string }>(
    opts.token,
    `/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/contents/${opts.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: opts.message,
        content: encoded,
        branch: opts.branch,
        sha: opts.sha,
      }),
    }
  );
  if (!ok) {
    throw new Error(json.message ?? `Could not update ${opts.path}`);
  }
}
