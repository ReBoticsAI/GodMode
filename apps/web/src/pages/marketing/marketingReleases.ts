/** GitHub Releases helpers for the marketing Downloads page (#678). */

export const GITHUB_REPO = "ReBoticsAI/GodMode";
export const RELEASES_HUB_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const GHCR_IMAGE = "ghcr.io/reboticsai/godmode";
export const GHCR_PACKAGE_URL =
  "https://github.com/orgs/ReBoticsAI/packages/container/package/godmode";

const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type GithubRelease = {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  assets: ReleaseAsset[];
};

export type OsDownload = {
  id: "windows" | "macos-arm64" | "macos-intel" | "linux";
  label: string;
  url: string;
  fileName: string;
};

export type ChannelRelease = {
  tag: string;
  title: string;
  publishedAt: string;
  htmlUrl: string;
  downloads: OsDownload[];
  manifestUrl: string | null;
  verificationUrl: string | null;
};

function assetBySuffix(assets: ReleaseAsset[], needle: RegExp): ReleaseAsset | undefined {
  return assets.find((a) => needle.test(a.name));
}

export function osDownloadsFromAssets(assets: ReleaseAsset[]): OsDownload[] {
  const out: OsDownload[] = [];
  const win = assetBySuffix(assets, /^godmode-windows-desktop-.+\.exe$/i);
  if (win) {
    out.push({
      id: "windows",
      label: "Windows",
      url: win.browser_download_url,
      fileName: win.name,
    });
  }
  const macArm = assetBySuffix(assets, /^godmode-macos-arm64-desktop-.+\.dmg$/i);
  if (macArm) {
    out.push({
      id: "macos-arm64",
      label: "macOS (Apple Silicon)",
      url: macArm.browser_download_url,
      fileName: macArm.name,
    });
  }
  const macIntel = assetBySuffix(assets, /^godmode-macos-intel-desktop-.+\.dmg$/i);
  if (macIntel) {
    out.push({
      id: "macos-intel",
      label: "macOS (Intel)",
      url: macIntel.browser_download_url,
      fileName: macIntel.name,
    });
  }
  const linuxApp =
    assetBySuffix(assets, /^godmode-linux-desktop-.+\.AppImage$/i) ??
    assetBySuffix(assets, /^godmode-linux-desktop-.+\.deb$/i);
  if (linuxApp) {
    out.push({
      id: "linux",
      label: "Linux",
      url: linuxApp.browser_download_url,
      fileName: linuxApp.name,
    });
  }
  return out;
}

export function toChannelRelease(release: GithubRelease): ChannelRelease {
  const assets = release.assets ?? [];
  const manifest = assets.find((a) => a.name === "release-manifest.json");
  const verification = assets.find((a) =>
    /^godmode-verification-.+\.tar\.gz$/i.test(a.name)
  );
  return {
    tag: release.tag_name,
    title: (release.name ?? release.tag_name).trim() || release.tag_name,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    downloads: osDownloadsFromAssets(assets),
    manifestUrl: manifest?.browser_download_url ?? null,
    verificationUrl: verification?.browser_download_url ?? null,
  };
}

/** Dated nightly desktop releases: `vX.Y.Z-nightly.YYYYMMDD…` (not floating `nightly`). */
export function isDatedNightlyTag(tag: string): boolean {
  return /^.+-nightly\./i.test(tag.trim());
}

export function pickNightlyRelease(releases: GithubRelease[]): GithubRelease | null {
  for (const r of releases) {
    if (r.draft) continue;
    if (!isDatedNightlyTag(r.tag_name)) continue;
    if (osDownloadsFromAssets(r.assets ?? []).length === 0) continue;
    return r;
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub Releases HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchStableAndNightly(): Promise<{
  stable: ChannelRelease | null;
  nightly: ChannelRelease | null;
}> {
  const [latest, list] = await Promise.all([
    fetchJson<GithubRelease>(`${RELEASES_API}/latest`),
    fetchJson<GithubRelease[]>(`${RELEASES_API}?per_page=30`),
  ]);
  const stable =
    latest && !latest.draft && !latest.prerelease ? toChannelRelease(latest) : null;
  const nightlyRaw = pickNightlyRelease(Array.isArray(list) ? list : []);
  const nightly = nightlyRaw ? toChannelRelease(nightlyRaw) : null;
  return { stable, nightly };
}

export function formatPublishedAt(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}
