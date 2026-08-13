/**
 * Open a GitHub pull request using Vault GitHub Connect (#442).
 */
import {
  parseGithubHttpsRemote,
  type GithubHttpsRemote,
} from "./git-host-auth.js";

const CURSOR_ATTRIBUTION_LINE =
  /^(Co-authored-by:\s*Cursor\s*<[^>\n]*cursor\.com>|Made-with:\s*Cursor|Made with Cursor)\s*$/gim;

export function stripCursorPrAttribution(text: string): string {
  return String(text ?? "")
    .replace(CURSOR_ATTRIBUTION_LINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type CreateGithubPullRequestInput = {
  accessToken: string;
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base?: string;
  draft?: boolean;
};

export type CreateGithubPullRequestResult = {
  number: number;
  url: string;
  htmlUrl: string;
  state: string;
  title: string;
};

function assertSafeRef(value: string, label: string): string {
  const v = value.trim();
  if (!v) throw new Error(`${label} required`);
  if (v.startsWith("-") || v.includes("..") || /[\0\n\r]/.test(v)) {
    throw new Error(`invalid ${label}`);
  }
  return v;
}

export function resolveGithubRemoteFromUrl(remoteUrl: string): GithubHttpsRemote {
  const parsed = parseGithubHttpsRemote(remoteUrl);
  if (!parsed) {
    throw new Error(
      "Remote must be an https://github.com/owner/repo URL. Connect GitHub and use an HTTPS remote."
    );
  }
  return parsed;
}

export async function createGithubPullRequest(
  input: CreateGithubPullRequestInput
): Promise<CreateGithubPullRequestResult> {
  const owner = assertSafeRef(input.owner, "owner");
  const repo = assertSafeRef(input.repo, "repo").replace(/\.git$/i, "");
  const title = stripCursorPrAttribution(String(input.title ?? ""));
  if (!title) throw new Error("title required");
  const head = assertSafeRef(input.head, "head");
  const base = assertSafeRef(String(input.base ?? "main"), "base");
  const body = stripCursorPrAttribution(String(input.body ?? ""));
  const token = String(input.accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "GodMode",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title,
        head,
        base,
        body: body || undefined,
        draft: Boolean(input.draft),
      }),
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    number?: number;
    html_url?: string;
    url?: string;
    state?: string;
    title?: string;
    message?: string;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok) {
    const detail =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      json.message ||
      `HTTP ${res.status}`;
    throw new Error(`GitHub pull request failed: ${detail}`);
  }
  if (!json.number || !json.html_url) {
    throw new Error("GitHub pull request response missing number or html_url");
  }
  return {
    number: json.number,
    url: json.html_url,
    htmlUrl: json.html_url,
    state: String(json.state ?? "open"),
    title: String(json.title ?? title),
  };
}
