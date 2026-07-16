import { readFile } from "node:fs/promises";
import path from "node:path";
import { safeArtifactPath, sha256File, validateManifest } from "./contract.mjs";

const [manifestFile, artifactDirectory = path.dirname(manifestFile ?? ""), mode] = process.argv.slice(2);
if (!manifestFile) throw new Error("Usage: node verify-release.mjs <release-manifest.json> [artifact-directory]");

const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const errors = validateManifest(manifest, {
  version: process.env.EXPECTED_VERSION,
  channel: process.env.EXPECTED_CHANNEL,
  commit: process.env.EXPECTED_COMMIT,
});
if (errors.length) throw new Error(`Manifest verification failed:\n- ${errors.join("\n- ")}`);

if (mode !== "--manifest-only") {
  for (const artifact of manifest.artifacts) {
    const file = safeArtifactPath(artifactDirectory, artifact.name);
    const actual = await sha256File(file);
    if (actual !== artifact.sha256) throw new Error(`${artifact.name}: checksum mismatch`);
  }
}
console.log(`Verified ${manifest.version} (${manifest.commit})${mode === "--manifest-only" ? "" : ` and ${manifest.artifacts.length} artifacts`}`);
