import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
const temporary = await mkdtemp(path.join(os.tmpdir(), "godmode-update-"));

async function download(url, destination) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
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

try {
  const manifestPath = path.join(temporary, "release-manifest.json");
  const manifestBundle = `${manifestPath}.bundle`;
  await Promise.all([
    download(manifestUrl, manifestPath),
    download(`${manifestUrl}.bundle`, manifestBundle),
  ]);
  verifyBlob(manifestPath, manifestBundle);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const platform = process.platform === "win32" ? "windows-x64" : "linux-x64";
  const artifact = manifest.artifacts?.find(
    (candidate) =>
      candidate.kind === "bundle" && candidate.platform === platform
  );
  if (!artifact || !/^[A-Za-z0-9._-]+$/.test(artifact.name)) {
    throw new Error(`Manifest has no safe ${platform} bare-metal bundle`);
  }
  const artifactUrl = new URL(artifact.name, manifestUrl).href;
  const archive = path.join(temporary, artifact.name);
  const artifactBundle = `${archive}.bundle`;
  await Promise.all([
    download(artifactUrl, archive),
    download(`${artifactUrl}.bundle`, artifactBundle),
  ]);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (digest !== artifact.sha256) throw new Error("Bare-metal artifact hash mismatch");
  verifyBlob(archive, artifactBundle);
  const extracted = path.join(temporary, "runtime");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(extracted));
  execFileSync("tar", ["-xf", archive, "-C", extracted], { stdio: "inherit" });
  const entries = await import("node:fs/promises").then(({ readdir }) =>
    readdir(extracted, { withFileTypes: true })
  );
  const root = path.join(
    extracted,
    entries.find((entry) => entry.isDirectory())?.name ??
      (() => {
        throw new Error("Bare-metal artifact has no runtime root");
      })()
  );
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "RemoteSigned",
        "-File",
        path.join(root, "install-windows.ps1"),
      ],
      { stdio: "inherit", env: process.env }
    );
  } else {
    execFileSync("/bin/bash", [path.join(root, "install-linux.sh")], {
      stdio: "inherit",
      env: process.env,
    });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
