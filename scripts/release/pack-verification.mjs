import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Pack SBOM/provenance/checksums and per-artifact Sigstore bundles into one
 * archive so the GitHub Release page stays installer-focused.
 *
 * Keeps `release-manifest.json.bundle` beside the manifest (required for updates).
 *
 * Usage: node pack-verification.mjs <artifact-dir> <version>
 */
const [artifactDirectory, version] = process.argv.slice(2);
if (!artifactDirectory || !version) {
  throw new Error("Usage: node pack-verification.mjs <artifact-dir> <version>");
}

const root = path.resolve(artifactDirectory);
const staging = path.join(root, ".verification-staging");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

function isVerificationMaterial(name) {
  const lower = name.toLowerCase();
  if (lower === "release-manifest.json" || lower === "release-manifest.json.bundle") {
    return false;
  }
  if (lower === "sha256sums" || lower === "sha256sums.bundle") return true;
  if (lower.endsWith(".bundle")) return true;
  if (lower.includes("sbom")) return true;
  if (lower.includes("provenance")) return true;
  if (lower === "github-provenance.sigstore.json") return true;
  return false;
}

const entries = (await readdir(root)).filter((name) => {
  if (name.startsWith(".")) return false;
  return isVerificationMaterial(name);
});

if (entries.length === 0) {
  await rm(staging, { recursive: true, force: true });
  console.log("No verification materials to pack");
  process.exit(0);
}

const moved = [];
for (const name of entries) {
  await rename(path.join(root, name), path.join(staging, name));
  moved.push(name);
}

const outName = `godmode-${version}-verification.tar.gz`;
const archive = path.join(root, outName);
const packed = spawnSync(
  "tar",
  ["-czf", archive, "-C", staging, ...moved],
  { stdio: "inherit" }
);
if (packed.status !== 0) {
  throw new Error(`Failed to create ${outName}`);
}
await rm(staging, { recursive: true, force: true });
console.log(`Packed ${moved.length} verification files into ${outName}`);
