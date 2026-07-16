import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { channelForVersion, RELEASE_SCHEMA, sha256File, validateManifest } from "./contract.mjs";

const [artifactDirectory, output = "release-manifest.json"] = process.argv.slice(2);
const version = process.env.RELEASE_VERSION;
const commit = process.env.RELEASE_COMMIT;
const imageRepository = process.env.IMAGE_REPOSITORY;
const imageDigest = process.env.IMAGE_DIGEST;

if (!artifactDirectory || !version || !commit || !imageRepository || !imageDigest) {
  throw new Error("Usage: RELEASE_VERSION=... RELEASE_COMMIT=... IMAGE_REPOSITORY=... IMAGE_DIGEST=... node create-manifest.mjs <artifact-dir> [output]");
}

const metadataFile = path.join(artifactDirectory, "release-metadata.json");
let metadata = {};
try {
  metadata = JSON.parse(await readFile(metadataFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (metadata.version && metadata.version !== version) throw new Error("Bundle version differs from release version");
if (metadata.commit && metadata.commit !== commit) throw new Error("Bundle commit differs from release commit");

const ignored = new Set(["release-manifest.json", "release-manifest.json.bundle", "SHA256SUMS", "SHA256SUMS.bundle", "release-metadata.json"]);
const files = (await readdir(artifactDirectory, { recursive: true }))
  .filter((name) => !ignored.has(name) && !name.endsWith(".bundle"))
  .sort();

const artifacts = [];
for (const relativeName of files) {
  const file = path.join(artifactDirectory, relativeName);
  const details = await stat(file);
  if (!details.isFile()) continue;
  const normalizedName = relativeName.replaceAll("\\", "/");
  const baseName = path.basename(normalizedName);
  const platform = normalizedName.includes("darwin-arm64")
    ? "darwin-arm64"
    : normalizedName.includes("darwin-x64")
      ? "darwin-x64"
      : normalizedName.includes("linux-x64") || normalizedName.includes("linux-amd64")
        ? "linux-x64"
        : normalizedName.includes("windows-x64")
          ? "windows-x64"
          : "multi";
  const lower = baseName.toLowerCase();
  const kind = lower.includes("sbom")
    ? "sbom"
    : lower.includes("provenance")
      ? "provenance"
      : lower.endsWith(".exe") ||
          lower.endsWith(".dmg") ||
          lower.endsWith(".appimage") ||
          lower.endsWith(".deb")
        ? "installer"
        : "bundle";
  artifacts.push({
    name: baseName,
    kind,
    platform,
    version,
    commit,
    sha256: await sha256File(file),
    size: details.size,
  });
}

const manifest = {
  schema: RELEASE_SCHEMA,
  version,
  channel: channelForVersion(version),
  commit,
  publishedAt: process.env.RELEASE_PUBLISHED_AT || new Date().toISOString(),
  releaseNotes: {
    url:
      process.env.RELEASE_NOTES_URL ||
      `https://github.com/ReBoticsAI/GodMode/releases/tag/${encodeURIComponent(version)}`,
    summary:
      process.env.RELEASE_NOTES_SUMMARY ||
      `GodMode ${version} built from ${commit}.`,
  },
  compatibility: {
    engine: {
      minimum: process.env.RELEASE_ENGINE_MINIMUM || "v0.1.0",
      maximum: process.env.RELEASE_ENGINE_MAXIMUM || version,
    },
    kernelClientApi: {
      minimum: Number(process.env.RELEASE_KERNEL_API_MINIMUM || 1),
      maximum: Number(process.env.RELEASE_KERNEL_API_MAXIMUM || 1),
    },
    schema: {
      minimum: Number(process.env.RELEASE_SCHEMA_MINIMUM || 0),
      maximum: Number(process.env.RELEASE_SCHEMA_MAXIMUM || 13),
      rollbackMinimum: Number(process.env.RELEASE_SCHEMA_ROLLBACK_MINIMUM || 0),
    },
    connectors: JSON.parse(process.env.RELEASE_CONNECTOR_CONSTRAINTS || "{}"),
  },
  policy: {
    mandatory: process.env.RELEASE_MANDATORY === "true",
    security: process.env.RELEASE_SECURITY === "true",
  },
  signing: {
    method: "sigstore-keyless",
    issuer: "https://token.actions.githubusercontent.com",
    identity:
      channelForVersion(version) === "stable"
        ? `https://github.com/ReBoticsAI/GodMode/.github/workflows/release.yml@refs/tags/${version}`
        : "https://github.com/ReBoticsAI/GodMode/.github/workflows/release.yml@refs/heads/main",
    bundle: "release-manifest.json.bundle",
  },
  pluginConstraints: JSON.parse(process.env.RELEASE_PLUGIN_CONSTRAINTS || "{}"),
  coordinatedPlugins: JSON.parse(process.env.RELEASE_COORDINATED_PLUGINS || "[]"),
  image: {
    repository: imageRepository.toLowerCase(),
    tag: version,
    digest: imageDigest,
    commit,
    platforms: ["linux/amd64", "linux/arm64"],
  },
  artifacts,
};

const errors = validateManifest(manifest, { version, commit });
if (errors.length) throw new Error(`Refusing to write invalid manifest: ${errors.join("; ")}`);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
