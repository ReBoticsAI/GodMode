/**
 * Canonical GitHub Release artifact filenames.
 *
 * Examples:
 *   godmode-windows-desktop-v0.1.0.exe
 *   godmode-macos-arm64-desktop-v0.1.0.dmg
 *   godmode-macos-intel-desktop-v0.1.0.dmg
 *   godmode-linux-desktop-v0.1.0.AppImage
 *   godmode-linux-bare-metal-v0.1.0.tar.gz
 *   godmode-verification-v0.1.0.tar.gz
 */

export function normalizeReleaseVersion(version) {
  const trimmed = String(version ?? "").trim();
  if (!trimmed) throw new Error("Release version is required");
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function desktopInstallerName(platform, version, extension) {
  const v = normalizeReleaseVersion(version);
  const ext = String(extension ?? "")
    .replace(/^\./, "")
    .replace(/^appimage$/i, "AppImage");
  switch (platform) {
    case "windows-x64":
      return `godmode-windows-desktop-${v}.${ext}`;
    case "darwin-arm64":
      return `godmode-macos-arm64-desktop-${v}.${ext}`;
    case "darwin-x64":
      return `godmode-macos-intel-desktop-${v}.${ext}`;
    case "linux-x64":
      return `godmode-linux-desktop-${v}.${ext}`;
    default:
      throw new Error(`Unsupported desktop platform: ${platform}`);
  }
}

export function bareMetalArchiveName(platform, version) {
  const v = normalizeReleaseVersion(version);
  if (platform === "windows-x64") return `godmode-windows-bare-metal-${v}.zip`;
  if (platform === "linux-x64") return `godmode-linux-bare-metal-${v}.tar.gz`;
  throw new Error(`Unsupported bare-metal platform: ${platform}`);
}

export function bareMetalStageDirName(platform, version) {
  // Internal extract root (not the download filename).
  return `godmode-${normalizeReleaseVersion(version)}-${platform}`;
}

export function verificationArchiveName(version) {
  return `godmode-verification-${normalizeReleaseVersion(version)}.tar.gz`;
}

/** Map a download filename to the release-manifest platform label. */
export function platformFromArtifactName(name) {
  const lower = String(name ?? "").toLowerCase();
  if (lower.includes("macos-arm64") || lower.includes("darwin-arm64")) return "darwin-arm64";
  if (lower.includes("macos-intel") || lower.includes("darwin-x64")) return "darwin-x64";
  if (
    lower.includes("linux-desktop") ||
    lower.includes("linux-bare-metal") ||
    lower.includes("linux-x64") ||
    lower.includes("linux-amd64")
  ) {
    return "linux-x64";
  }
  if (
    lower.includes("windows-desktop") ||
    lower.includes("windows-bare-metal") ||
    lower.includes("windows-x64")
  ) {
    return "windows-x64";
  }
  return "multi";
}

export function installerExtensionFromFilename(name) {
  const lower = String(name ?? "").toLowerCase();
  if (lower.endsWith(".appimage")) return "AppImage";
  if (lower.endsWith(".exe")) return "exe";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".deb")) return "deb";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".tar.gz")) return "tar.gz";
  return null;
}
