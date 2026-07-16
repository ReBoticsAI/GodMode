import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const RELEASE_SCHEMA = "https://godmode.dev/schemas/release-manifest-v1.json";
export const CHANNELS = new Set(["nightly", "stable"]);

const stableVersion = /^v\d+\.\d+\.\d+$/;
const nightlyVersion = /^v\d+\.\d+\.\d+-nightly\.\d{8}\.[0-9a-f]{7,40}$/;
const commitHash = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const imageDigest = /^sha256:[0-9a-f]{64}$/;

export function channelForVersion(version) {
  if (stableVersion.test(version)) return "stable";
  if (nightlyVersion.test(version)) return "nightly";
  throw new Error(`Unsupported release version: ${version}`);
}

export function validateManifest(manifest, expected = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return ["manifest must be an object"];
  if (manifest.schema !== RELEASE_SCHEMA) errors.push(`schema must be ${RELEASE_SCHEMA}`);
  if (!CHANNELS.has(manifest.channel)) errors.push("channel must be nightly or stable");
  try {
    if (channelForVersion(manifest.version) !== manifest.channel) {
      errors.push("version does not match channel");
    }
  } catch (error) {
    errors.push(error.message);
  }
  if (!commitHash.test(manifest.commit ?? "")) errors.push("commit must be a full lowercase SHA");
  if (!manifest.publishedAt || Number.isNaN(Date.parse(manifest.publishedAt))) {
    errors.push("publishedAt must be an ISO date");
  }
  if (
    !manifest.releaseNotes ||
    !/^https:\/\//.test(manifest.releaseNotes.url ?? "") ||
    typeof manifest.releaseNotes.summary !== "string"
  ) {
    errors.push("releaseNotes must include an HTTPS URL and summary");
  }
  const compatibility = manifest.compatibility;
  if (
    !compatibility?.engine ||
    typeof compatibility.engine.minimum !== "string" ||
    typeof compatibility.engine.maximum !== "string" ||
    !compatibility?.kernelClientApi ||
    !Number.isSafeInteger(compatibility.kernelClientApi.minimum) ||
    !Number.isSafeInteger(compatibility.kernelClientApi.maximum) ||
    !compatibility?.schema ||
    !Number.isSafeInteger(compatibility.schema.minimum) ||
    !Number.isSafeInteger(compatibility.schema.maximum) ||
    !Number.isSafeInteger(compatibility.schema.rollbackMinimum) ||
    !compatibility?.connectors ||
    typeof compatibility.connectors !== "object"
  ) {
    errors.push("compatibility bounds are required");
  } else {
    if (compatibility.kernelClientApi.minimum > compatibility.kernelClientApi.maximum) {
      errors.push("kernel client API minimum exceeds maximum");
    }
    if (compatibility.schema.minimum > compatibility.schema.maximum) {
      errors.push("schema minimum exceeds maximum");
    }
    if (
      compatibility.schema.rollbackMinimum < compatibility.schema.minimum ||
      compatibility.schema.rollbackMinimum > compatibility.schema.maximum
    ) {
      errors.push("schema rollbackMinimum must be inside the compatibility window");
    }
    if (
      Object.values(compatibility.connectors).some(
        (constraint) => typeof constraint !== "string"
      )
    ) {
      errors.push("connector compatibility values must be strings");
    }
  }
  if (
    !manifest.policy ||
    typeof manifest.policy.mandatory !== "boolean" ||
    typeof manifest.policy.security !== "boolean"
  ) {
    errors.push("policy mandatory/security flags are required");
  }
  if (
    manifest.signing?.method !== "sigstore-keyless" ||
    manifest.signing?.issuer !== "https://token.actions.githubusercontent.com" ||
    !/^https:\/\/github\.com\/ReBoticsAI\/GodMode\/\.github\/workflows\/release\.yml@refs\/(?:heads\/main|tags\/v\d+\.\d+\.\d+)$/.test(
      manifest.signing?.identity ?? ""
    ) ||
    manifest.signing?.bundle !== "release-manifest.json.bundle"
  ) {
    errors.push("signing metadata must pin the GodMode keyless release workflow");
  }
  if (
    manifest.pluginConstraints &&
    (typeof manifest.pluginConstraints !== "object" ||
      Object.values(manifest.pluginConstraints).some(
        (constraint) => typeof constraint !== "string"
      ))
  ) {
    errors.push("pluginConstraints values must be strings");
  }
  if (!manifest.image || typeof manifest.image !== "object") {
    errors.push("image is required");
  } else {
    if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(manifest.image.repository ?? "")) {
      errors.push("image.repository must be a GHCR repository");
    }
    if (!imageDigest.test(manifest.image.digest ?? "")) errors.push("image.digest must be sha256");
    if (manifest.image.tag !== manifest.version) errors.push("image.tag must equal version");
    if (manifest.image.commit !== manifest.commit) errors.push("image.commit must equal commit");
    const platforms = manifest.image.platforms ?? [];
    for (const required of ["linux/amd64", "linux/arm64"]) {
      if (!platforms.includes(required)) errors.push(`image.platforms must include ${required}`);
    }
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    errors.push("artifacts must be a non-empty array");
  } else {
    const names = new Set();
    for (const artifact of manifest.artifacts) {
      if (!artifact?.name || names.has(artifact.name)) errors.push("artifact names must be unique");
      names.add(artifact?.name);
      if (!sha256.test(artifact?.sha256 ?? "")) errors.push(`${artifact?.name ?? "artifact"} has invalid sha256`);
      if (!Number.isSafeInteger(artifact?.size) || artifact.size < 1) errors.push(`${artifact?.name ?? "artifact"} has invalid size`);
      if (artifact?.commit !== manifest.commit) errors.push(`${artifact?.name ?? "artifact"} commit must equal manifest commit`);
      if (artifact?.version !== manifest.version) errors.push(`${artifact?.name ?? "artifact"} version must equal manifest version`);
    }
    for (const platform of ["linux-x64", "windows-x64"]) {
      const hasBundle = manifest.artifacts.some(
        (artifact) => artifact?.kind === "bundle" && artifact?.platform === platform
      );
      if (!hasBundle) errors.push(`missing ${platform} bundle`);
    }
  }
  if (expected.version && manifest.version !== expected.version) errors.push("unexpected version");
  if (expected.channel && manifest.channel !== expected.channel) errors.push("unexpected channel");
  if (expected.commit && manifest.commit !== expected.commit) errors.push("unexpected commit");
  return errors;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function verifyManifestSignature(manifest, signatureBase64, publicKeyPem) {
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Invalid manifest: ${errors.join("; ")}`);
  return verifySignature(
    null,
    Buffer.from(canonicalJson(manifest)),
    createPublicKey(publicKeyPem),
    Buffer.from(signatureBase64, "base64"),
  );
}

export async function sha256File(file) {
  const content = await readFile(file);
  return createHash("sha256").update(content).digest("hex");
}

export function safeArtifactPath(root, artifactName) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, artifactName);
  if (path.dirname(resolved) !== resolvedRoot) throw new Error(`Unsafe artifact name: ${artifactName}`);
  return resolved;
}
