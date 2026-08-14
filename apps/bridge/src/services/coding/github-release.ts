/**
 * GitHub Releases submit helpers for the Near store/release loop (#445).
 * Uses Vault GitHub Connect (same token path as clone / PR).
 */
import { stripCursorPrAttribution } from "./github-pr.js";

/** Vault Integrations deep link for reconnect after permission upgrades. */
export const GITHUB_CONNECT_VAULT_PATH = "/vault?tab=integrations";

/**
 * GitHub App installation lacks the permission for this REST call
 * (typical: Contents write for Releases).
 */
export function isGithubIntegrationPermissionError(
  message: string | null | undefined
): boolean {
  const m = String(message ?? "");
  return (
    /Resource not accessible by integration/i.test(m) ||
    (/HTTP 403/.test(m) && /releas/i.test(m)) ||
    (/403/.test(m) && /not accessible by integration/i.test(m))
  );
}

/** User-facing guidance when release create/publish fails on App permissions. */
export function formatGithubReleasePermissionError(
  detail: string
): string {
  const base = String(detail ?? "").trim() || "GitHub release request failed";
  if (!isGithubIntegrationPermissionError(base)) return base;
  return (
    `${base}. Reconnect GitHub in Vault → Integrations and accept ` +
    `Contents write (Read and write) on the App installation, then retry.`
  );
}

export type GithubReleaseAssetInput = {
  name: string;
  /** Base64-encoded file bytes (small Near-proof assets). */
  contentBase64: string;
  contentType?: string;
};

export type PrepareGithubReleaseInput = {
  owner: string;
  repo: string;
  tag: string;
  name?: string;
  body?: string;
  targetCommitish?: string;
  /** Default true: stage for human-final publish. */
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubReleaseAssetInput[];
};

export type PreparedGithubRelease = {
  owner: string;
  repo: string;
  tag: string;
  name: string;
  body: string;
  targetCommitish: string | null;
  draft: boolean;
  prerelease: boolean;
  assetCount: number;
  staged: true;
  summary: string;
};

export type CreateGithubReleaseInput = PrepareGithubReleaseInput & {
  accessToken: string;
};

export type GithubReleaseResult = {
  id: number;
  tag: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  htmlUrl: string;
  uploadUrl: string;
  publishedAt: string | null;
  downloadCount: number;
  assets: Array<{ name: string; downloadCount: number; size: number }>;
};

function assertSafeRef(value: string, label: string): string {
  const v = value.trim();
  if (!v) throw new Error(`${label} required`);
  if (v.startsWith("-") || v.includes("..") || /[\0\n\r]/.test(v)) {
    throw new Error(`invalid ${label}`);
  }
  return v;
}

function assertSafeTag(tag: string): string {
  const v = assertSafeRef(tag, "tag");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(v)) {
    throw new Error("invalid tag (use letters, digits, ., _, -)");
  }
  return v;
}

function ghHeaders(token: string, extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "GodMode",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

function mapRelease(json: Record<string, unknown>): GithubReleaseResult {
  const assetsRaw = Array.isArray(json.assets) ? json.assets : [];
  const assets = assetsRaw.map((a) => {
    const row = (a ?? {}) as Record<string, unknown>;
    return {
      name: String(row.name ?? ""),
      downloadCount: Number(row.download_count ?? 0),
      size: Number(row.size ?? 0),
    };
  });
  const downloadCount = assets.reduce((sum, a) => sum + a.downloadCount, 0);
  return {
    id: Number(json.id),
    tag: String(json.tag_name ?? ""),
    name: String(json.name ?? json.tag_name ?? ""),
    draft: Boolean(json.draft),
    prerelease: Boolean(json.prerelease),
    htmlUrl: String(json.html_url ?? ""),
    uploadUrl: String(json.upload_url ?? ""),
    publishedAt:
      typeof json.published_at === "string" ? json.published_at : null,
    downloadCount,
    assets,
  };
}

async function uploadReleaseAsset(
  accessToken: string,
  uploadUrlTemplate: string,
  asset: GithubReleaseAssetInput
): Promise<{ name: string; downloadCount: number; size: number }> {
  const name = assertSafeRef(asset.name, "asset name").replace(/[\\/]/g, "_");
  const buf = Buffer.from(String(asset.contentBase64 ?? ""), "base64");
  if (!buf.length) throw new Error(`asset ${name} is empty`);
  if (buf.length > 25 * 1024 * 1024) {
    throw new Error(`asset ${name} exceeds 25MB Near-proof limit`);
  }
  const base = uploadUrlTemplate.replace(/\{[^}]+\}$/, "");
  const url = `${base}?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: ghHeaders(accessToken, {
      "Content-Type": asset.contentType ?? "application/octet-stream",
      "Content-Length": String(buf.length),
    }),
    body: buf,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `GitHub asset upload failed: ${String(json.message ?? `HTTP ${res.status}`)}`
    );
  }
  return {
    name: String(json.name ?? name),
    downloadCount: Number(json.download_count ?? 0),
    size: Number(json.size ?? buf.length),
  };
}

/** Validate and summarize a release payload without calling GitHub. */
export function prepareGithubRelease(
  input: PrepareGithubReleaseInput
): PreparedGithubRelease {
  const owner = assertSafeRef(input.owner, "owner");
  const repo = assertSafeRef(input.repo, "repo").replace(/\.git$/i, "");
  const tag = assertSafeTag(input.tag);
  const draft = input.draft !== false;
  const name = stripCursorPrAttribution(
    String(input.name ?? tag).trim() || tag
  );
  const body = stripCursorPrAttribution(String(input.body ?? ""));
  const targetCommitish = input.targetCommitish
    ? assertSafeRef(input.targetCommitish, "targetCommitish")
    : null;
  const assetCount = Array.isArray(input.assets) ? input.assets.length : 0;
  return {
    owner,
    repo,
    tag,
    name,
    body,
    targetCommitish,
    draft,
    prerelease: Boolean(input.prerelease),
    assetCount,
    staged: true,
    summary: [
      `${draft ? "Draft" : "Publish"} release ${tag} on ${owner}/${repo}`,
      `Name: ${name}`,
      targetCommitish ? `Target: ${targetCommitish}` : "Target: (default branch)",
      `Assets: ${assetCount}`,
      body
        ? `Notes: ${body.slice(0, 200)}${body.length > 200 ? "..." : ""}`
        : "Notes: (empty)",
    ].join("\n"),
  };
}

export async function createGithubRelease(
  input: CreateGithubReleaseInput
): Promise<GithubReleaseResult> {
  const staged = prepareGithubRelease(input);
  const token = String(input.accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(staged.owner)}/${encodeURIComponent(staged.repo)}/releases`,
    {
      method: "POST",
      headers: ghHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        tag_name: staged.tag,
        name: staged.name,
        body: staged.body || undefined,
        draft: staged.draft,
        prerelease: staged.prerelease,
        target_commitish: staged.targetCommitish ?? undefined,
      }),
    }
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    message?: string;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok) {
    const detail =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      json.message ||
      `HTTP ${res.status}`;
    throw new Error(`GitHub release create failed: ${detail}`);
  }
  if (!json.id || !json.html_url) {
    throw new Error("GitHub release response missing id or html_url");
  }

  let mapped = mapRelease(json);
  const assets = Array.isArray(input.assets) ? input.assets : [];
  if (assets.length && mapped.uploadUrl) {
    const uploaded = [];
    for (const asset of assets.slice(0, 5)) {
      uploaded.push(await uploadReleaseAsset(token, mapped.uploadUrl, asset));
    }
    mapped = {
      ...mapped,
      assets: uploaded,
      downloadCount: uploaded.reduce((s, a) => s + a.downloadCount, 0),
    };
  }
  return mapped;
}

export async function publishGithubRelease(input: {
  accessToken: string;
  owner: string;
  repo: string;
  releaseId: number;
}): Promise<GithubReleaseResult> {
  const owner = assertSafeRef(input.owner, "owner");
  const repo = assertSafeRef(input.repo, "repo").replace(/\.git$/i, "");
  const token = String(input.accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");
  const releaseId = Number(input.releaseId);
  if (!Number.isFinite(releaseId) || releaseId <= 0) {
    throw new Error("releaseId required");
  }

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${releaseId}`,
    {
      method: "PATCH",
      headers: ghHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ draft: false }),
    }
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      `GitHub release publish failed: ${String(json.message ?? `HTTP ${res.status}`)}`
    );
  }
  return mapRelease(json);
}

export async function getGithubRelease(input: {
  accessToken: string;
  owner: string;
  repo: string;
  releaseId: number;
}): Promise<GithubReleaseResult> {
  const owner = assertSafeRef(input.owner, "owner");
  const repo = assertSafeRef(input.repo, "repo").replace(/\.git$/i, "");
  const token = String(input.accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");
  const releaseId = Number(input.releaseId);
  if (!Number.isFinite(releaseId) || releaseId <= 0) {
    throw new Error("releaseId required");
  }

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${releaseId}`,
    { headers: ghHeaders(token) }
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      `GitHub release fetch failed: ${String(json.message ?? `HTTP ${res.status}`)}`
    );
  }
  return mapRelease(json);
}

export async function listGithubReleases(input: {
  accessToken: string;
  owner: string;
  repo: string;
  perPage?: number;
}): Promise<GithubReleaseResult[]> {
  const owner = assertSafeRef(input.owner, "owner");
  const repo = assertSafeRef(input.repo, "repo").replace(/\.git$/i, "");
  const token = String(input.accessToken ?? "").trim();
  if (!token) throw new Error("GitHub access token required");
  const perPage = Math.min(Math.max(Number(input.perPage ?? 20), 1), 50);

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=${perPage}`,
    { headers: ghHeaders(token) }
  );
  const json = (await res.json().catch(() => [])) as
    | Array<Record<string, unknown>>
    | { message?: string };
  if (!res.ok || !Array.isArray(json)) {
    const message =
      !Array.isArray(json) && json.message
        ? json.message
        : `HTTP ${res.status}`;
    throw new Error(`GitHub release list failed: ${message}`);
  }
  return json.map(mapRelease);
}
