import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RELEASE_SCHEMA,
  canonicalJson,
  channelForVersion,
  safeArtifactPath,
  sha256File,
  validateManifest,
  verifyManifestSignature,
} from "../contract.mjs";

const commit = "a".repeat(40);
const digest = "b".repeat(64);

function fixture(overrides = {}) {
  return {
    schema: RELEASE_SCHEMA,
    version: "v1.2.3",
    channel: "stable",
    commit,
    publishedAt: "2026-07-15T12:00:00.000Z",
    releaseNotes: {
      url: "https://github.com/ReBoticsAI/GodMode/releases/tag/v1.2.3",
      summary: "Stable release",
    },
    compatibility: {
      engine: { minimum: "v1.0.0", maximum: "v1.2.3" },
      kernelClientApi: { minimum: 1, maximum: 1 },
      schema: { minimum: 0, maximum: 1, rollbackMinimum: 0 },
      connectors: {},
    },
    policy: { mandatory: false, security: false },
    signing: {
      method: "sigstore-keyless",
      issuer: "https://token.actions.githubusercontent.com",
      identity:
        "https://github.com/ReBoticsAI/GodMode/.github/workflows/release.yml@refs/tags/v1.2.3",
      bundle: "release-manifest.json.bundle",
    },
    pluginConstraints: {},
    coordinatedPlugins: [],
    image: {
      repository: "ghcr.io/reboticsai/godmode",
      tag: "v1.2.3",
      digest: `sha256:${digest}`,
      commit,
      platforms: ["linux/amd64", "linux/arm64"],
    },
    artifacts: [
      { name: "godmode-v1.2.3-linux-x64.tar.gz", kind: "bundle", platform: "linux-x64", version: "v1.2.3", commit, sha256: digest, size: 10 },
      { name: "godmode-v1.2.3-windows-x64.zip", kind: "bundle", platform: "windows-x64", version: "v1.2.3", commit, sha256: digest, size: 10 },
    ],
    ...overrides,
  };
}

test("derives strict channels from release versions", () => {
  assert.equal(channelForVersion("v1.2.3"), "stable");
  assert.equal(channelForVersion(`v0.1.0-nightly.20260715.${commit.slice(0, 12)}`), "nightly");
  assert.throws(() => channelForVersion("1.2.3"));
  assert.throws(() => channelForVersion("v1.2.3-rc.1"));
});

test("validates one commit and version across release outputs", () => {
  assert.deepEqual(validateManifest(fixture()), []);
  const invalid = fixture({ image: { ...fixture().image, commit: "c".repeat(40) } });
  assert.match(validateManifest(invalid).join(";"), /image.commit/);
});

test("verifies detached Ed25519 signatures over canonical manifests", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = fixture();
  const signature = sign(null, Buffer.from(canonicalJson(manifest)), privateKey).toString("base64");
  assert.equal(verifyManifestSignature(manifest, signature, publicKey.export({ type: "spki", format: "pem" })), true);
  assert.equal(verifyManifestSignature({ ...manifest, publishedAt: "2026-07-16T12:00:00.000Z" }, signature, publicKey.export({ type: "spki", format: "pem" })), false);
});

test("rejects artifact path traversal", () => {
  assert.throws(() => safeArtifactPath("/tmp/release", "../secret"), /Unsafe artifact/);
  assert.equal(safeArtifactPath("/tmp/release", "bundle.zip"), path.resolve("/tmp/release", "bundle.zip"));
});

test("computes artifact checksums for offline verification", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "godmode-release-"));
  try {
    const artifact = path.join(directory, "bundle.zip");
    await writeFile(artifact, "godmode");
    assert.equal(await sha256File(artifact), "e150c2e5c5421f42105081b58c282ad5a89c30781c99bcfe71913a5adaa88b52");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("host updaters snapshot stopped writers and retain rollback paths", async () => {
  const shell = await readFile("scripts/update/godmode-update.sh", "utf8");
  assert.ok(shell.indexOf("compose stop") < shell.indexOf("tar -czf"));
  assert.match(shell, /MANIFEST_URL=/);
  assert.match(shell, /release-manifest\.json/);
  assert.match(shell, /restore_snapshot/);
  assert.match(shell, /api\/update\/readiness/);
  assert.match(shell, /GODMODE_IMAGE="\$old_image"/);

  const powershell = await readFile(
    "scripts/update/godmode-update.ps1",
    "utf8"
  );
  assert.match(powershell, /\$manifestUrl/);
  assert.match(powershell, /Invoke-Compose stop/);
  assert.match(powershell, /Get-FileHash/);
  assert.match(powershell, /UPDATE_READINESS_TOKEN/);
  assert.match(powershell, /\$oldImage/);
});

test("accepts desktop installer artifacts alongside bare-metal bundles", () => {
  const manifest = fixture({
    artifacts: [
      ...fixture().artifacts,
      {
        name: "GodMode-Setup-1.2.3-windows-x64.exe",
        kind: "installer",
        platform: "windows-x64",
        version: "v1.2.3",
        commit,
        sha256: digest,
        size: 20,
      },
      {
        name: "GodMode-1.2.3-darwin-arm64.dmg",
        kind: "installer",
        platform: "darwin-arm64",
        version: "v1.2.3",
        commit,
        sha256: digest,
        size: 21,
      },
      {
        name: "GodMode-1.2.3-linux-x64.AppImage",
        kind: "installer",
        platform: "linux-x64",
        version: "v1.2.3",
        commit,
        sha256: digest,
        size: 22,
      },
    ],
  });
  assert.deepEqual(validateManifest(manifest), []);
});

test("bare-metal updater selects signed bundle artifacts", async () => {
  const updater = await readFile("scripts/update/bare-metal-update.mjs", "utf8");
  assert.match(updater, /kind === "bundle"/);
  assert.doesNotMatch(updater, /kind === "bare-metal"/);
});

test("desktop updater selects signed installer artifacts", async () => {
  const updater = await readFile("scripts/update/desktop-update.mjs", "utf8");
  assert.match(updater, /kind === "installer"/);
  assert.match(updater, /AppImage/);
  assert.match(updater, /NSIS|\/S/);
});

test("supervisor routes electron surface to desktop-update", async () => {
  const supervisor = await readFile("scripts/update/supervisor.mjs", "utf8");
  assert.match(supervisor, /INSTALLATION_SURFACE === "electron"/);
  assert.match(supervisor, /desktop-update\.mjs/);
});

test("supervisor and bridge share restart_to_apply paths", async () => {
  const supervisor = await readFile("scripts/update/supervisor.mjs", "utf8");
  const bridge = await readFile("apps/bridge/src/services/release-flow.ts", "utf8");
  assert.match(supervisor, /\/restart_to_apply/);
  assert.match(bridge, /restart_to_apply/);
  assert.match(bridge, /action === "apply" \? "apply" : "restart_to_apply"/);
});
