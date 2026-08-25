import { describe, expect, it } from "vitest";
import {
  isDatedNightlyTag,
  osDownloadsFromAssets,
  pickNightlyRelease,
  toChannelRelease,
  type GithubRelease,
} from "../pages/marketing/marketingReleases";

const sampleAssets = [
  {
    name: "godmode-windows-desktop-v0.9.1.exe",
    browser_download_url: "https://example.com/win.exe",
    size: 1,
  },
  {
    name: "godmode-macos-arm64-desktop-v0.9.1.dmg",
    browser_download_url: "https://example.com/mac-arm.dmg",
    size: 1,
  },
  {
    name: "godmode-macos-intel-desktop-v0.9.1.dmg",
    browser_download_url: "https://example.com/mac-intel.dmg",
    size: 1,
  },
  {
    name: "godmode-linux-desktop-v0.9.1.AppImage",
    browser_download_url: "https://example.com/linux.AppImage",
    size: 1,
  },
  {
    name: "release-manifest.json",
    browser_download_url: "https://example.com/manifest.json",
    size: 1,
  },
  {
    name: "godmode-verification-v0.9.1.tar.gz",
    browser_download_url: "https://example.com/verify.tar.gz",
    size: 1,
  },
];

describe("marketingReleases", () => {
  it("maps desktop assets by OS", () => {
    const downloads = osDownloadsFromAssets(sampleAssets);
    expect(downloads.map((d) => d.id)).toEqual([
      "windows",
      "macos-arm64",
      "macos-intel",
      "linux",
    ]);
  });

  it("recognizes dated nightly tags and skips floating nightly", () => {
    expect(isDatedNightlyTag("v0.9.1-nightly.20260824.abc")).toBe(true);
    expect(isDatedNightlyTag("nightly")).toBe(false);
    expect(isDatedNightlyTag("v0.9.1")).toBe(false);
  });

  it("picks the first dated nightly with installers", () => {
    const floating: GithubRelease = {
      tag_name: "nightly",
      name: "GodMode nightly channel",
      html_url: "https://example.com/nightly",
      published_at: "2026-07-16T00:00:00Z",
      prerelease: true,
      draft: false,
      assets: [
        {
          name: "release-manifest.json",
          browser_download_url: "https://example.com/m.json",
          size: 1,
        },
      ],
    };
    const dated: GithubRelease = {
      tag_name: "v0.9.1-nightly.20260824.abc",
      name: "GodMode nightly",
      html_url: "https://example.com/dated",
      published_at: "2026-08-24T00:00:00Z",
      prerelease: true,
      draft: false,
      assets: sampleAssets,
    };
    expect(pickNightlyRelease([floating, dated])?.tag_name).toBe(dated.tag_name);
    const channel = toChannelRelease(dated);
    expect(channel.manifestUrl).toContain("manifest.json");
    expect(channel.verificationUrl).toContain("verify.tar.gz");
    expect(channel.downloads.length).toBe(4);
  });
});
