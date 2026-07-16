import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bareMetalArchiveName,
  desktopInstallerName,
  platformFromArtifactName,
  verificationArchiveName,
} from "../artifact-names.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("artifact names are human-readable by OS and surface", () => {
  assert.equal(
    desktopInstallerName("windows-x64", "v0.1.0-nightly.1", "exe"),
    "godmode-windows-desktop-v0.1.0-nightly.1.exe"
  );
  assert.equal(
    desktopInstallerName("darwin-arm64", "0.1.0", "dmg"),
    "godmode-macos-arm64-desktop-v0.1.0.dmg"
  );
  assert.equal(
    desktopInstallerName("darwin-x64", "v0.1.0", "dmg"),
    "godmode-macos-intel-desktop-v0.1.0.dmg"
  );
  assert.equal(
    desktopInstallerName("linux-x64", "v0.1.0", "AppImage"),
    "godmode-linux-desktop-v0.1.0.AppImage"
  );
  assert.equal(
    bareMetalArchiveName("linux-x64", "v0.1.0"),
    "godmode-linux-bare-metal-v0.1.0.tar.gz"
  );
  assert.equal(
    bareMetalArchiveName("windows-x64", "v0.1.0"),
    "godmode-windows-bare-metal-v0.1.0.zip"
  );
  assert.equal(
    verificationArchiveName("v0.1.0"),
    "godmode-verification-v0.1.0.tar.gz"
  );
  assert.equal(platformFromArtifactName("godmode-macos-intel-desktop-v1.dmg"), "darwin-x64");
  assert.equal(platformFromArtifactName("godmode-windows-bare-metal-v1.zip"), "windows-x64");
});

test("pack-verification keeps the signed manifest and packs auditor materials", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "godmode-pack-"));
  try {
    await writeFile(path.join(dir, "release-manifest.json"), "{}");
    await writeFile(path.join(dir, "release-manifest.json.bundle"), "manifest-sig");
    await writeFile(path.join(dir, "godmode-windows-desktop-v1.exe"), "installer");
    await writeFile(path.join(dir, "godmode-windows-desktop-v1.exe.bundle"), "exe-sig");
    await writeFile(path.join(dir, "godmode-linux-bare-metal-v1.tar.gz"), "bundle");
    await writeFile(path.join(dir, "godmode-v1.sbom.spdx.json"), "sbom");
    await writeFile(path.join(dir, "SHA256SUMS"), "sums");
    await writeFile(path.join(dir, "SHA256SUMS.bundle"), "sums-sig");
    await writeFile(path.join(dir, "github-provenance.sigstore.json"), "prov");

    const result = spawnSync(
      process.execPath,
      [path.join(root, "pack-verification.mjs"), dir, "v1.2.3"],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const remaining = new Set(await readdir(dir));
    assert.ok(remaining.has("release-manifest.json"));
    assert.ok(remaining.has("release-manifest.json.bundle"));
    assert.ok(remaining.has("godmode-windows-desktop-v1.exe"));
    assert.ok(remaining.has("godmode-linux-bare-metal-v1.tar.gz"));
    assert.ok(remaining.has("godmode-verification-v1.2.3.tar.gz"));
    assert.equal(remaining.has("godmode-windows-desktop-v1.exe.bundle"), false);
    assert.equal(remaining.has("SHA256SUMS"), false);
    assert.equal(remaining.has("godmode-v1.sbom.spdx.json"), false);

    const listing = spawnSync(
      "tar",
      ["-tzf", path.join(dir, "godmode-verification-v1.2.3.tar.gz")],
      { encoding: "utf8" }
    );
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /SHA256SUMS/);
    assert.match(listing.stdout, /godmode-v1\.sbom\.spdx\.json/);
    assert.match(listing.stdout, /godmode-windows-desktop-v1\.exe\.bundle/);
    assert.doesNotMatch(listing.stdout, /release-manifest\.json\.bundle/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("create-manifest lists only installers and bare-metal archives", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "godmode-manifest-"));
  try {
    await writeFile(path.join(dir, "godmode-windows-desktop-v1.2.3.exe"), "exe");
    await writeFile(path.join(dir, "godmode-linux-bare-metal-v1.2.3.tar.gz"), "tar");
    await writeFile(path.join(dir, "godmode-windows-bare-metal-v1.2.3.zip"), "zip");
    await writeFile(path.join(dir, "godmode-v1.sbom.spdx.json"), "sbom");
    await writeFile(path.join(dir, "github-provenance.sigstore.json"), "prov");
    await writeFile(path.join(dir, "godmode-verification-v1.2.3.tar.gz"), "verify");
    await writeFile(path.join(dir, "godmode-windows-desktop-v1.2.3.exe.bundle"), "sig");

    const out = path.join(dir, "release-manifest.json");
    const result = spawnSync(
      process.execPath,
      [path.join(root, "create-manifest.mjs"), dir, out],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          RELEASE_VERSION: "v1.2.3",
          RELEASE_COMMIT: "a".repeat(40),
          IMAGE_REPOSITORY: "ghcr.io/reboticsai/godmode",
          IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
        },
      }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(await readFile(out, "utf8"));
    assert.deepEqual(
      manifest.artifacts.map((a) => a.name).sort(),
      [
        "godmode-linux-bare-metal-v1.2.3.tar.gz",
        "godmode-windows-bare-metal-v1.2.3.zip",
        "godmode-windows-desktop-v1.2.3.exe",
      ].sort()
    );
    assert.equal(
      manifest.artifacts.find((a) => a.name.endsWith(".exe")).platform,
      "windows-x64"
    );
    assert.ok(manifest.artifacts.every((a) => a.kind === "installer" || a.kind === "bundle"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
