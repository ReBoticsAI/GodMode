/**
 * Merge a GitHub PR (Connect or App token) after the caller validated the matrix.
 */
export type MergeGithubPullRequestInput = {
  accessToken: string;
  owner: string;
  repo: string;
  pullNumber: number;
  mergeMethod?: "merge" | "squash" | "rebase";
  commitTitle?: string;
  commitMessage?: string;
};

export type MergeGithubPullRequestResult = {
  merged: boolean;
  sha: string;
  message: string;
  htmlUrl?: string;
};

export async function mergeGithubPullRequest(
  input: MergeGithubPullRequestInput
): Promise<MergeGithubPullRequestResult> {
  const owner = String(input.owner ?? "").trim();
  const repo = String(input.repo ?? "")
    .trim()
    .replace(/\.git$/i, "");
  const pullNumber = Number(input.pullNumber);
  if (!owner || !repo) throw new Error("owner and repo required");
  if (!Number.isFinite(pullNumber) || pullNumber < 1) {
    throw new Error("pullNumber required");
  }
  const token = String(input.accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");
  const mergeMethod = input.mergeMethod ?? "squash";

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "GodMode",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        merge_method: mergeMethod,
        commit_title: input.commitTitle,
        commit_message: input.commitMessage,
      }),
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    merged?: boolean;
    sha?: string;
    message?: string;
    html_url?: string;
  };
  if (!res.ok) {
    throw new Error(
      json.message || `GitHub merge failed (HTTP ${res.status})`
    );
  }
  if (!json.merged || !json.sha) {
    throw new Error(json.message || "GitHub merge did not confirm merged+sha");
  }
  return {
    merged: true,
    sha: json.sha,
    message: String(json.message ?? "merged"),
    htmlUrl: json.html_url,
  };
}

export type GithubPullSnapshot = {
  number: number;
  htmlUrl: string;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  baseRef: string;
  authorLogin: string;
  labels: string[];
};

export async function fetchGithubPullSnapshot(opts: {
  accessToken: string;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<GithubPullSnapshot> {
  const { accessToken, owner, repo, pullNumber } = opts;
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "GodMode",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    number?: number;
    html_url?: string;
    title?: string;
    body?: string | null;
    state?: string;
    draft?: boolean;
    merged?: boolean;
    mergeable?: boolean | null;
    base?: { ref?: string };
    user?: { login?: string };
    labels?: Array<{ name?: string }>;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || `Fetch PR failed (HTTP ${res.status})`);
  }
  return {
    number: Number(json.number ?? pullNumber),
    htmlUrl: String(json.html_url ?? ""),
    title: String(json.title ?? ""),
    body: String(json.body ?? ""),
    state: String(json.state ?? ""),
    draft: Boolean(json.draft),
    merged: Boolean(json.merged),
    mergeable:
      json.mergeable === true ? true : json.mergeable === false ? false : null,
    baseRef: String(json.base?.ref ?? ""),
    authorLogin: String(json.user?.login ?? ""),
    labels: (json.labels ?? [])
      .map((l) => String(l.name ?? "").trim())
      .filter(Boolean),
  };
}

export async function fetchGithubPullFiles(opts: {
  accessToken: string;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<Array<{ filename: string; additions: number; deletions: number }>> {
  const { accessToken, owner, repo, pullNumber } = opts;
  const out: Array<{
    filename: string;
    additions: number;
    deletions: number;
  }> = [];
  let page = 1;
  for (;;) {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "GodMode",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    const json = (await res.json().catch(() => [])) as
      | Array<{
          filename?: string;
          additions?: number;
          deletions?: number;
        }>
      | { message?: string };
    if (!res.ok) {
      const msg =
        !Array.isArray(json) && json && typeof json === "object"
          ? String((json as { message?: string }).message ?? "")
          : "";
      throw new Error(msg || `Fetch PR files failed (HTTP ${res.status})`);
    }
    const rows = Array.isArray(json) ? json : [];
    if (!rows.length) break;
    for (const row of rows) {
      out.push({
        filename: String(row.filename ?? ""),
        additions: Number(row.additions) || 0,
        deletions: Number(row.deletions) || 0,
      });
    }
    if (rows.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return out;
}
