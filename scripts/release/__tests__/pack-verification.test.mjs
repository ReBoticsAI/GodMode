import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pack-verification keeps the signed manifest and packs auditor materials", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "godmode-pack-"));
  try {
    await writeFile(path.join(dir, "release-manifest.json"), "{}");
    await writeFile(path.join(dir, "release-manifest.json.bundle"), "manifest-sig");
    await writeFile(path.join(dir, "GodMode-Setup-v1-windows-x64.exe"), "installer");
    await writeFile(path.join(dir, "GodMode-Setup-v1-windows-x64.exe.bundle"), "exe-sig");
    await writeFile(path.join(dir, "godmode-v1-linux-x64.tar.gz"), "bundle");
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
    assert.ok(remaining.has("GodMode-Setup-v1-windows-x64.exe"));
    assert.ok(remaining.has("godmode-v1-linux-x64.tar.gz"));
    assert.ok(remaining.has("godmode-v1.2.3-verification.tar.gz"));
    assert.equal(remaining.has("GodMode-Setup-v1-windows-x64.exe.bundle"), false);
    assert.equal(remaining.has("SHA256SUMS"), false);
    assert.equal(remaining.has("godmode-v1.sbom.spdx.json"), false);

    const listing = spawnSync(
      "tar",
      ["-tzf", path.join(dir, "godmode-v1.2.3-verification.tar.gz")],
      { encoding: "utf8" }
    );
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /SHA256SUMS/);
    assert.match(listing.stdout, /godmode-v1\.sbom\.spdx\.json/);
    assert.match(listing.stdout, /GodMode-Setup-v1-windows-x64\.exe\.bundle/);
    assert.doesNotMatch(listing.stdout, /release-manifest\.json\.bundle/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("create-manifest lists only installers and bare-metal archives", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "godmode-manifest-"));
  try {
    await writeFile(path.join(dir, "GodMode-Setup-v1-windows-x64.exe"), "exe");
    await writeFile(path.join(dir, "godmode-v1-linux-x64.tar.gz"), "tar");
    await writeFile(path.join(dir, "godmode-v1.sbom.spdx.json"), "sbom");
    await writeFile(path.join(dir, "github-provenance.sigstore.json"), "prov");
    await writeFile(path.join(dir, "godmode-v1-verification.tar.gz"), "verify");
    await writeFile(path.join(dir, "GodMode-Setup-v1-windows-x64.exe.bundle"), "sig");

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
      ["GodMode-Setup-v1-windows-x64.exe", "godmode-v1-linux-x64.tar.gz"].sort()
    );
    assert.ok(manifest.artifacts.every((a) => a.kind === "installer" || a.kind === "bundle"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
