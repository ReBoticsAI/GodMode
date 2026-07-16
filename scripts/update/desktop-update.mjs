import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function releasePlatform(platform = process.platform, arch = process.arch) {
  if (platform === "win32") return "windows-x64";
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  return "linux-x64";
}

const manifestUrl = process.argv[2];
if (!manifestUrl?.startsWith("https://")) {
  throw new Error("A trusted HTTPS release manifest URL is required");
}
const repository = process.env.UPDATE_RELEASE_REPOSITORY;
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("UPDATE_RELEASE_REPOSITORY must identify the trusted owner/repository");
}
const identity =
  process.env.UPDATE_SIGNING_IDENTITY_REGEXP ??
  `^https://github\\.com/${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.github/workflows/release\\.yml@refs/(heads/main|tags/v[0-9]+\\.[0-9]+\\.[0-9]+)$`;
const issuer =
  process.env.UPDATE_SIGNING_ISSUER ??
  "https://token.actions.githubusercontent.com";
const temporary = await mkdtemp(path.join(os.tmpdir(), "godmode-desktop-update-"));
const platform = releasePlatform();

async function download(url, destination) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Download failed: ${url} (HTTP ${response.status})`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function verifyBlob(blob, bundle) {
  execFileSync(
    "cosign",
    [
      "verify-blob",
      blob,
      "--bundle",
      bundle,
      "--certificate-oidc-issuer",
      issuer,
      "--certificate-identity-regexp",
      identity,
    ],
    { stdio: "inherit" }
  );
}

function selectInstaller(artifacts) {
  const candidates = (artifacts ?? []).filter(
    (candidate) =>
      candidate?.kind === "installer" && candidate?.platform === platform
  );
  if (!candidates.length) return null;
  // Prefer AppImage on Linux for one-click replace; NSIS/DMG elsewhere.
  if (platform === "linux-x64") {
    return (
      candidates.find((item) => String(item.name).toLowerCase().endsWith(".appimage")) ??
      candidates[0]
    );
  }
  return candidates[0];
}

async function applyWindows(installerPath) {
  const result = spawnSync(installerPath, ["/S"], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`NSIS installer failed with status ${result.status}`);
  }
}

async function applyMac(dmgPath) {
  const mountRoot = await mkdtemp(path.join(os.tmpdir(), "godmode-dmg-"));
  try {
    execFileSync("hdiutil", ["attach", dmgPath, "-nobrowse", "-mountpoint", mountRoot], {
      stdio: "inherit",
    });
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(mountRoot)
    );
    const appName = entries.find((name) => name.endsWith(".app"));
    if (!appName) throw new Error("DMG does not contain a .app bundle");
    const source = path.join(mountRoot, appName);
    const destination = path.join("/Applications", appName);
    execFileSync("ditto", [source, destination], { stdio: "inherit" });
  } finally {
    try {
      execFileSync("hdiutil", ["detach", mountRoot, "-quiet"], { stdio: "ignore" });
    } catch {
      // ignore detach failures
    }
    await rm(mountRoot, { recursive: true, force: true });
  }
}

async function applyLinux(appImagePath) {
  const current =
    process.env.APPIMAGE ||
    process.env.GODMODE_APPIMAGE_PATH ||
    process.env.GODMODE_DESKTOP_EXECUTABLE;
  if (!current) {
    throw new Error(
      "Linux desktop updates require APPIMAGE or GODMODE_APPIMAGE_PATH to replace in place"
    );
  }
  const backup = `${current}.bak`;
  await copyFile(current, backup);
  try {
    await copyFile(appImagePath, current);
    await chmod(current, 0o755);
    await rm(backup, { force: true });
  } catch (error) {
    try {
      await copyFile(backup, current);
    } catch {
      // best-effort restore
    }
    throw error;
  }
}

try {
  const manifestPath = path.join(temporary, "release-manifest.json");
  const manifestBundle = `${manifestPath}.bundle`;
  await Promise.all([
    download(manifestUrl, manifestPath),
    download(`${manifestUrl}.bundle`, manifestBundle),
  ]);
  verifyBlob(manifestPath, manifestBundle);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const artifact = selectInstaller(manifest.artifacts);
  if (!artifact || !/^[A-Za-z0-9._-]+$/.test(artifact.name)) {
    throw new Error(`Manifest has no safe ${platform} desktop installer`);
  }
  const artifactUrl = new URL(artifact.name, manifestUrl).href;
  const installerPath = path.join(temporary, artifact.name);
  await download(artifactUrl, installerPath);
  const digest = createHash("sha256")
    .update(await readFile(installerPath))
    .digest("hex");
  if (digest !== artifact.sha256) throw new Error("Desktop installer hash mismatch");

  if (process.platform === "win32") {
    await applyWindows(installerPath);
  } else if (process.platform === "darwin") {
    await applyMac(installerPath);
  } else {
    await applyLinux(installerPath);
  }

  // Ask the running Electron shell to exit so the new bits can take over.
  // Bridge/supervisor are stopped by the shell on quit.
  console.log("Desktop installer applied; restart GodMode to finish.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
