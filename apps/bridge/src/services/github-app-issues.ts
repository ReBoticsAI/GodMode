/**
 * Core GitHub issues via the platform GitHub App installation.
 * Create, search/list, comment, and comment-or-create for Agent Support.
 */
import { randomUUID } from "node:crypto";
import {
  createInstallationAccessToken,
  githubAppConfigured,
  resolvePlatformInstallationId,
} from "./github-app.js";

export const CORE_GITHUB_OWNER = "ReBoticsAI";
export const CORE_GITHUB_REPO = "GodMode";
const CORE_OWNER = CORE_GITHUB_OWNER;
const CORE_REPO = CORE_GITHUB_REPO;
const CORE_REPO_FULL = `${CORE_OWNER}/${CORE_REPO}`;

/** Dedicated branch for Support screenshot assets (keeps noise off main). */
export const SUPPORT_MEDIA_BRANCH = "godmode-support-media";
const SUPPORT_SCREENSHOT_DIR = ".github/godmode-support-screenshots";

export type CoreGithubIssueSummary = {
  number: number;
  htmlUrl: string;
  title: string;
  state: string;
  nodeId?: string;
};

async function installationToken(): Promise<string> {
  if (!githubAppConfigured()) {
    throw Object.assign(
      new Error("GitHub App is not configured on this host"),
      { status: 503 }
    );
  }
  const installationId = await resolvePlatformInstallationId();
  if (!installationId) {
    throw Object.assign(
      new Error(
        "Platform GitHub App installation not found. Install the App on ReBoticsAI and set GITHUB_APP_PLATFORM_INSTALLATION_ID if needed."
      ),
      { status: 503 }
    );
  }
  const { token } = await createInstallationAccessToken(installationId);
  return token;
}

function githubHeaders(token: string, extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "GodMode",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

function mapIssue(json: {
  number: number;
  html_url: string;
  title?: string;
  state?: string;
  node_id?: string;
}): CoreGithubIssueSummary {
  return {
    number: json.number,
    htmlUrl: json.html_url,
    title: String(json.title ?? ""),
    state: String(json.state ?? "open"),
    nodeId: json.node_id,
  };
}

function stripDataUrlBase64(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s);
  return (m?.[1] ?? trimmed).replace(/\s/g, "");
}

async function ensureSupportMediaBranch(token: string): Promise<void> {
  const refRes = await fetch(
    `https://api.github.com/repos/${CORE_REPO_FULL}/git/ref/heads/${encodeURIComponent(SUPPORT_MEDIA_BRANCH)}`,
    { headers: githubHeaders(token) }
  );
  if (refRes.ok) return;

  const repoRes = await fetch(`https://api.github.com/repos/${CORE_REPO_FULL}`, {
    headers: githubHeaders(token),
  });
  if (!repoRes.ok) {
    const text = await repoRes.text().catch(() => "");
    throw Object.assign(
      new Error(`Resolve Core repo failed (${repoRes.status}): ${text.slice(0, 200)}`),
      { status: 502 }
    );
  }
  const repo = (await repoRes.json()) as { default_branch?: string };
  const defaultBranch = String(repo.default_branch ?? "main");
  const baseRefRes = await fetch(
    `https://api.github.com/repos/${CORE_REPO_FULL}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
    { headers: githubHeaders(token) }
  );
  if (!baseRefRes.ok) {
    const text = await baseRefRes.text().catch(() => "");
    throw Object.assign(
      new Error(`Resolve default branch failed (${baseRefRes.status}): ${text.slice(0, 200)}`),
      { status: 502 }
    );
  }
  const baseRef = (await baseRefRes.json()) as { object?: { sha?: string } };
  const sha = baseRef.object?.sha;
  if (!sha) {
    throw Object.assign(new Error("Could not resolve default branch SHA"), {
      status: 502,
    });
  }
  const createRes = await fetch(
    `https://api.github.com/repos/${CORE_REPO_FULL}/git/refs`,
    {
      method: "POST",
      headers: githubHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        ref: `refs/heads/${SUPPORT_MEDIA_BRANCH}`,
        sha,
      }),
    }
  );
  if (!createRes.ok && createRes.status !== 422) {
    const text = await createRes.text().catch(() => "");
    throw Object.assign(
      new Error(`Create support-media branch failed (${createRes.status}): ${text.slice(0, 200)}`),
      { status: 502 }
    );
  }
}

/**
 * Upload a PNG/JPEG screenshot for Support issues via Contents API on
 * {@link SUPPORT_MEDIA_BRANCH}. Returns a public raw.githubusercontent.com URL
 * suitable for markdown image embedding in the issue body.
 */
export async function uploadCoreSupportScreenshot(opts: {
  /** Raw base64 or data:image/...;base64,... */
  imageBase64: string;
  /** Optional extension hint; defaults to png. */
  ext?: "png" | "jpg" | "jpeg" | "webp";
}): Promise<{ rawUrl: string; path: string; branch: string }> {
  const token = await installationToken();
  await ensureSupportMediaBranch(token);
  const b64 = stripDataUrlBase64(opts.imageBase64);
  if (!b64 || b64.length < 32) {
    throw Object.assign(new Error("Screenshot image data is empty"), {
      status: 400,
    });
  }
  // ~1.5MB decoded cap keeps Contents API / issue flow responsive.
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > 1_500_000) {
    throw Object.assign(
      new Error("Screenshot is too large (max ~1.5MB). Capture again at lower resolution."),
      { status: 400 }
    );
  }
  const ext = opts.ext === "jpg" || opts.ext === "jpeg" ? "jpg" : opts.ext === "webp" ? "webp" : "png";
  const path = `${SUPPORT_SCREENSHOT_DIR}/${randomUUID()}.${ext}`;
  const putRes = await fetch(
    `https://api.github.com/repos/${CORE_REPO_FULL}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "PUT",
      headers: githubHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: `chore(support): screenshot ${path.split("/").pop()}`,
        content: b64,
        branch: SUPPORT_MEDIA_BRANCH,
      }),
    }
  );
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    throw Object.assign(
      new Error(`Upload support screenshot failed (${putRes.status}): ${text.slice(0, 300)}`),
      { status: 502 }
    );
  }
  const rawUrl = `https://raw.githubusercontent.com/${CORE_REPO_FULL}/${SUPPORT_MEDIA_BRANCH}/${path}`;
  return { rawUrl, path, branch: SUPPORT_MEDIA_BRANCH };
}

/** Build markdown image block(s) from public screenshot URLs. */
export function supportScreenshotMarkdown(urls: string[]): string {
  const clean = urls.map((u) => u.trim()).filter(Boolean);
  if (!clean.length) return "";
  return [
    "",
    "### Screenshot",
    ...clean.map((url, i) => `![Support screenshot ${i + 1}](${url})`),
    "",
  ].join("\n");
}

export async function createCoreGithubIssue(opts: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<{ number: number; htmlUrl: string; nodeId: string }> {
  const token = await installationToken();
  const res = await fetch(
    `https://api.github.com/repos/${CORE_REPO_FULL}/issues`,
    {
      method: "POST",
      headers: githubHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        title: opts.title.slice(0, 200),
        body: opts.body.slice(0, 60_000),
        labels: opts.labels,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Create GitHub issue failed (${res.status}): ${text.slice(0, 300)}`),
      { status: 502 }
    );
  }
  const json = (await res.json()) as {
    number: number;
    html_url: string;
    node_id: string;
  };
  return {
    number: json.number,
    htmlUrl: json.html_url,
    nodeId: json.node_id,
  };
}

/** List open issues on the Core repo (newest first). */
export async function listCoreGithubIssues(opts?: {
  perPage?: number;
  labels?: string;
}): Promise<CoreGithubIssueSummary[]> {
  const token = await installationToken();
  const perPage = Math.min(Math.max(opts?.perPage ?? 30, 1), 100);
  const params = new URLSearchParams({
    state: "open",
    per_page: String(perPage),
    sort: "updated",
    direction: "desc",
  });
  if (opts?.labels?.trim()) params.set("labels", opts.labels.trim());
  const res = await fetch(
    `https://api.github.com/repos/${CORE_REPO_FULL}/issues?${params}`,
    { headers: githubHeaders(token) }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`List GitHub issues failed (${res.status}): ${text.slice(0, 300)}`),
      { status: 502 }
    );
  }
  const json = (await res.json()) as Array<{
    number: number;
    html_url: string;
    title?: string;
    state?: string;
    node_id?: string;
    pull_request?: unknown;
  }>;
  return json
    .filter((row) => !row.pull_request)
    .map((row) => mapIssue(row));
}

/**
 * Search open Core issues. Uses GitHub search API; falls back to list+filter
 * when search is unavailable.
 */
export async function searchCoreGithubIssues(opts: {
  query: string;
  perPage?: number;
}): Promise<CoreGithubIssueSummary[]> {
  const q = opts.query.trim();
  if (!q) return listCoreGithubIssues({ perPage: opts.perPage });
  const token = await installationToken();
  const perPage = Math.min(Math.max(opts.perPage ?? 10, 1), 30);
  const searchQ = [
    `repo:${CORE_REPO_FULL}`,
    "is:issue",
    "is:open",
    q.replace(/["]/g, " ").slice(0, 200),
  ].join(" ");
  const params = new URLSearchParams({
    q: searchQ,
    per_page: String(perPage),
    sort: "updated",
    order: "desc",
  });
  const res = await fetch(
    `https://api.github.com/search/issues?${params}`,
    { headers: githubHeaders(token) }
  );
  if (!res.ok) {
    // Fallback: list open + title/body keyword filter locally.
    const listed = await listCoreGithubIssues({ perPage: 50 });
    const tokens = q
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .slice(0, 8);
    if (tokens.length === 0) return listed.slice(0, perPage);
    return listed
      .filter((issue) => {
        const hay = issue.title.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      })
      .slice(0, perPage);
  }
  const json = (await res.json()) as {
    items?: Array<{
      number: number;
      html_url: string;
      title?: string;
      state?: string;
      node_id?: string;
      pull_request?: unknown;
    }>;
  };
  return (json.items ?? [])
    .filter((row) => !row.pull_request)
    .map((row) => mapIssue(row));
}

export async function commentCoreGithubIssue(opts: {
  issueNumber: number;
  body: string;
}): Promise<{ id: number; htmlUrl: string }> {
  const token = await installationToken();
  const body = opts.body.trim();
  if (!body) {
    throw Object.assign(new Error("Comment body required"), { status: 400 });
  }
  const res = await fetch(
    `https://api.github.com/repos/${CORE_REPO_FULL}/issues/${opts.issueNumber}/comments`,
    {
      method: "POST",
      headers: githubHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ body: body.slice(0, 60_000) }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(
        `Comment on GitHub issue failed (${res.status}): ${text.slice(0, 300)}`
      ),
      { status: 502 }
    );
  }
  const json = (await res.json()) as { id: number; html_url: string };
  return { id: json.id, htmlUrl: json.html_url };
}

function normalizeFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Exported for unit tests and skill docs. Score in [0, 1]. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeFingerprint(a).split(" ").filter((w) => w.length >= 3));
  const tb = new Set(normalizeFingerprint(b).split(" ").filter((w) => w.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap += 1;
  return overlap / Math.max(ta.size, tb.size);
}

/** Dedupe threshold used by reportOrUpdateCoreGithubIssue. */
export const ISSUE_DEDUPE_TITLE_SCORE = 0.55;

/**
 * Prefer commenting on a strong title match; otherwise create a new issue.
 */
export async function reportOrUpdateCoreGithubIssue(opts: {
  title: string;
  body: string;
  labels?: string[];
  /** Force create even when a similar issue exists. */
  forceNew?: boolean;
  /** Optional markdown (e.g. screenshot embeds) appended to body/comment. */
  mediaMarkdown?: string;
}): Promise<{
  action: "created" | "commented";
  number: number;
  htmlUrl: string;
  matchedTitle?: string;
}> {
  const title = opts.title.trim() || "GodMode support";
  const media = opts.mediaMarkdown?.trim() || "";
  const body = [
    opts.body?.trim() || "",
    media,
    "",
    "_Filed via GodMode Agent Support (GitHub App). Do not include secrets or PII._",
  ]
    .join("\n")
    .trim();

  if (!opts.forceNew) {
    const candidates = await searchCoreGithubIssues({
      query: title.slice(0, 120),
      perPage: 10,
    });
    let best: CoreGithubIssueSummary | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = titleSimilarity(title, c.title);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && bestScore >= ISSUE_DEDUPE_TITLE_SCORE) {
      const comment = await commentCoreGithubIssue({
        issueNumber: best.number,
        body: [
          `### Additional report`,
          ``,
          `**Subject:** ${title}`,
          ``,
          opts.body?.trim() || "(no body)",
          media,
          ``,
          `_Agent Support dedupe: commented on existing #${best.number} (score ${bestScore.toFixed(2)})._`,
        ].join("\n"),
      });
      return {
        action: "commented",
        number: best.number,
        htmlUrl: best.htmlUrl || comment.htmlUrl,
        matchedTitle: best.title,
      };
    }
  }

  const created = await createCoreGithubIssue({
    title,
    body,
    labels: opts.labels ?? ["support", "agent-reported"],
  });
  return {
    action: "created",
    number: created.number,
    htmlUrl: created.htmlUrl,
  };
}
