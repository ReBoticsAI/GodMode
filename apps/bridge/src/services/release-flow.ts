import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  verify as verifySigstore,
  type Bundle as SigstoreBundle,
  type VerifyOptions as SigstoreVerifyOptions,
} from "sigstore";
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";
import { getTenantDb } from "../tenant-registry.js";
import { listAllTenantIds, type CoreDatabase } from "../core-db.js";
import { pluginRuntime } from "../plugins/runtime.js";
import { getCurrentSchemaVersion } from "./db-migrations.js";
import { KERNEL_CLIENT_API_VERSION } from "@godmode/plugin-api";

export type ReleaseChannel = "stable" | "nightly";

export interface ReleaseManifest {
  version: string;
  channel: ReleaseChannel;
  publishedAt: string;
  artifact: { url: string; sha256: string; size?: number };
  schema?: string;
  commit?: string;
  image?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  releaseNotes?: { url: string; summary: string };
  compatibility?: {
    engine: { minimum: string; maximum: string };
    kernelClientApi: { minimum: number; maximum: number };
    schema: { minimum: number; maximum: number; rollbackMinimum: number };
    connectors: Record<string, string>;
  };
  policy?: { mandatory: boolean; security: boolean };
  signing?: {
    method: "sigstore-keyless";
    issuer: string;
    identity: string;
    bundle: string;
  };
  pluginConstraints?: Record<string, string>;
  minimumVersion?: string;
  plugins?: Record<string, string>;
  signature: string;
}

export interface ReadinessDiagnostic {
  id: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
}

const STATE_ID = "installation";
const FETCH_TIMEOUT_MS = Number(process.env.UPDATE_FETCH_TIMEOUT_MS ?? 10_000);
const MIN_POLL_MS = Number(process.env.UPDATE_POLL_MIN_MS ?? 4 * 60 * 60 * 1000);
const MAX_POLL_MS = Number(process.env.UPDATE_POLL_MAX_MS ?? 8 * 60 * 60 * 1000);

/** Host platform label used in release manifests. */
export function releasePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  if (platform === "win32") return "windows-x64";
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  return "linux-x64";
}

/** Artifact kind preferred for the current installation surface. */
export function releaseArtifactKind(
  surface = process.env.INSTALLATION_SURFACE ?? "developer_source"
): "installer" | "bundle" {
  return surface === "electron" ? "installer" : "bundle";
}

export function selectReleaseArtifact(
  artifacts: Array<Record<string, unknown>> | undefined,
  options?: { platform?: string; kind?: "installer" | "bundle" }
): Record<string, unknown> | undefined {
  const platform = options?.platform ?? releasePlatform();
  const kind = options?.kind ?? releaseArtifactKind();
  const list = Array.isArray(artifacts) ? artifacts : [];
  const matches = list.filter(
    (item) => item && item.kind === kind && item.platform === platform
  );
  if (!matches.length) return undefined;
  // Prefer AppImage on Linux for one-click replace; NSIS/DMG elsewhere.
  if (kind === "installer" && platform === "linux-x64") {
    return (
      matches.find((item) =>
        String(item.name ?? "").toLowerCase().endsWith(".appimage")
      ) ?? matches[0]
    );
  }
  return matches[0];
}

function channelManifestUrl(channel: "stable" | "nightly"): string {
  const release = channel === "nightly" ? "nightly" : "latest";
  return release === "latest"
    ? "https://github.com/ReBoticsAI/GodMode/releases/latest/download/release-manifest.json"
    : `https://github.com/ReBoticsAI/GodMode/releases/download/${release}/release-manifest.json`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function semver(value: string): [number, number, number, string] {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) throw new Error(`Invalid release version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""];
}

export function compareVersions(left: string, right: string): number {
  const a = semver(left);
  const b = semver(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Number(a[index]) - Number(b[index]);
  }
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return a[3].localeCompare(b[3]);
}

function compatible(version: string, range: string): boolean {
  const required = range.trim();
  if (!required || required === "*") return true;
  if (required.startsWith(">=")) return compareVersions(version, required.slice(2)) >= 0;
  if (required.startsWith("^")) {
    const actual = semver(version);
    const minimum = semver(required.slice(1));
    return actual[0] === minimum[0] && compareVersions(version, required.slice(1)) >= 0;
  }
  if (required.startsWith("~")) {
    const actual = semver(version);
    const minimum = semver(required.slice(1));
    return actual[0] === minimum[0] && actual[1] === minimum[1] &&
      compareVersions(version, required.slice(1)) >= 0;
  }
  return compareVersions(version, required) === 0;
}

export function validateSignedManifest(raw: unknown, publicKeyText: string): ReleaseManifest {
  if (!raw || typeof raw !== "object") throw new Error("Release manifest must be an object");
  const envelope = raw as Record<string, unknown>;
  const detached = envelope.manifest && typeof envelope.manifest === "object";
  const value = (detached ? envelope.manifest : envelope) as Record<string, unknown>;
  const signature = detached ? envelope.signature : value.signature;
  const directArtifact = value.artifact as Record<string, unknown> | undefined;
  const platform = releasePlatform();
  const kind = releaseArtifactKind();
  const bundledArtifact = Array.isArray(value.artifacts)
    ? selectReleaseArtifact(
        value.artifacts as Array<Record<string, unknown>>,
        { platform, kind }
      )
    : undefined;
  // Legacy signed manifests always used bare-metal bundles; fall back when surface is not electron.
  const legacyBundle =
    !bundledArtifact && kind === "bundle" && Array.isArray(value.artifacts)
      ? (value.artifacts.find(
          (item) =>
            item &&
            typeof item === "object" &&
            (item as Record<string, unknown>).kind === "bundle" &&
            (item as Record<string, unknown>).platform === platform
        ) as Record<string, unknown> | undefined)
      : undefined;
  const artifact = directArtifact ?? bundledArtifact ?? legacyBundle;
  const artifactUrl =
    typeof artifact?.url === "string" ? artifact.url : "";
  if (
    typeof value.version !== "string" ||
    !["stable", "nightly"].includes(String(value.channel)) ||
    typeof value.publishedAt !== "string" ||
    Number.isNaN(Date.parse(value.publishedAt)) ||
    !artifact ||
    (artifactUrl !== "" && !/^https:\/\//i.test(artifactUrl)) ||
    (artifactUrl === "" && typeof artifact.name !== "string") ||
    typeof artifact.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(artifact.sha256) ||
    typeof signature !== "string" ||
    !signature.trim()
  ) {
    throw new Error("Release manifest has an invalid schema");
  }
  if (
    value.schema != null &&
    value.schema !== "https://godmode.dev/schemas/release-manifest-v1.json"
  ) {
    throw new Error("Release manifest has an unsupported schema");
  }
  if (value.commit != null && !/^[a-f0-9]{40}$/.test(String(value.commit))) {
    throw new Error("Release manifest commit is invalid");
  }
  semver(value.version);
  if (!publicKeyText.trim()) throw new Error("Release manifest public key is not configured");
  const { signature: _inlineSignature, ...unsigned } = value;
  const signedPayload = detached ? value : unsigned;
  const key = publicKeyText.includes("BEGIN")
    ? createPublicKey(publicKeyText)
    : createPublicKey({
        key: Buffer.from(publicKeyText, "base64"),
        format: "der",
        type: "spki",
      });
  if (
    !verify(
      null,
      Buffer.from(stableJson(signedPayload)),
      key,
      Buffer.from(signature, "base64")
    )
  ) {
    throw new Error("Release manifest signature is invalid");
  }
  return {
    ...value,
    artifact: {
      url: artifactUrl,
      sha256: String(artifact.sha256),
      size: typeof artifact.size === "number" ? artifact.size : undefined,
      name: typeof artifact.name === "string" ? artifact.name : undefined,
    },
    signature,
  } as unknown as ReleaseManifest;
}

const RELEASE_SCHEMA = "https://godmode.dev/schemas/release-manifest-v1.json";
const RELEASE_ISSUER = "https://token.actions.githubusercontent.com";
const RELEASE_IDENTITY =
  "^https://github\\.com/ReBoticsAI/GodMode/\\.github/workflows/release\\.yml@refs/(heads/main|tags/v\\d+\\.\\d+\\.\\d+)$";

/**
 * Verify the exact manifest bytes produced by the release workflow. Shape
 * validation happens before trust-root/network work so attacker-controlled
 * payloads fail cheaply and cannot choose another issuer or workflow identity.
 */
export async function validateSigstoreManifest(
  rawText: string,
  bundle: SigstoreBundle,
  verifyImpl: (
    bundle: SigstoreBundle,
    payload: Buffer,
    options: SigstoreVerifyOptions
  ) => Promise<unknown> = verifySigstore
): Promise<ReleaseManifest> {
  if (Buffer.byteLength(rawText) > 2 * 1024 * 1024) {
    throw new Error("Release manifest exceeds the maximum size");
  }
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error("Release manifest is not valid JSON");
  }
  const releaseNotes = value.releaseNotes as Record<string, unknown> | undefined;
  const compatibility = value.compatibility as Record<string, unknown> | undefined;
  const engine = compatibility?.engine as Record<string, unknown> | undefined;
  const kernelApi = compatibility?.kernelClientApi as Record<string, unknown> | undefined;
  const schemas = compatibility?.schema as Record<string, unknown> | undefined;
  const policy = value.policy as Record<string, unknown> | undefined;
  const signing = value.signing as Record<string, unknown> | undefined;
  const image = value.image as Record<string, unknown> | undefined;
  const artifacts = Array.isArray(value.artifacts)
    ? (value.artifacts as Array<Record<string, unknown>>)
    : [];
  const platform = releasePlatform();
  const kind = releaseArtifactKind();
  const matched = selectReleaseArtifact(artifacts, { platform, kind });
  // Non-electron hosts without a native bundle (e.g. darwin) historically used
  // the linux-x64 bare-metal bundle as the validation anchor.
  const artifact =
    matched ??
    (kind === "bundle"
      ? selectReleaseArtifact(artifacts, { platform: "linux-x64", kind: "bundle" })
      : undefined);
  if (
    value.schema !== RELEASE_SCHEMA ||
    typeof value.version !== "string" ||
    !["stable", "nightly"].includes(String(value.channel)) ||
    typeof value.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.commit) ||
    typeof value.publishedAt !== "string" ||
    Number.isNaN(Date.parse(value.publishedAt)) ||
    !releaseNotes ||
    typeof releaseNotes.url !== "string" ||
    !/^https:\/\//i.test(releaseNotes.url) ||
    typeof releaseNotes.summary !== "string" ||
    !engine ||
    typeof engine.minimum !== "string" ||
    typeof engine.maximum !== "string" ||
    !kernelApi ||
    !Number.isSafeInteger(kernelApi.minimum) ||
    !Number.isSafeInteger(kernelApi.maximum) ||
    !schemas ||
    !Number.isSafeInteger(schemas.minimum) ||
    !Number.isSafeInteger(schemas.maximum) ||
    !Number.isSafeInteger(schemas.rollbackMinimum) ||
    Number(kernelApi.minimum) > Number(kernelApi.maximum) ||
    Number(schemas.minimum) > Number(schemas.maximum) ||
    Number(schemas.rollbackMinimum) < Number(schemas.minimum) ||
    Number(schemas.rollbackMinimum) > Number(schemas.maximum) ||
    !compatibility?.connectors ||
    typeof compatibility.connectors !== "object" ||
    !policy ||
    typeof policy.mandatory !== "boolean" ||
    typeof policy.security !== "boolean" ||
    !signing ||
    signing.method !== "sigstore-keyless" ||
    signing.issuer !== RELEASE_ISSUER ||
    typeof signing.identity !== "string" ||
    !new RegExp(RELEASE_IDENTITY).test(signing.identity) ||
    signing.bundle !== "release-manifest.json.bundle" ||
    !image ||
    typeof image.repository !== "string" ||
    !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image.repository) ||
    typeof image.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(image.digest) ||
    image.commit !== value.commit ||
    image.tag !== value.version ||
    !Array.isArray(image.platforms) ||
    !image.platforms.includes("linux/amd64") ||
    !image.platforms.includes("linux/arm64") ||
    !artifact ||
    typeof artifact.name !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(artifact.name) ||
    typeof artifact.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.size) ||
    artifacts.some(
      (item) =>
        item.version !== value.version ||
        item.commit !== value.commit ||
        typeof item.name !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(item.name) ||
        typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Number.isSafeInteger(item.size)
    ) ||
    (value.pluginConstraints != null &&
      (typeof value.pluginConstraints !== "object" ||
        Object.values(value.pluginConstraints as Record<string, unknown>).some(
          (constraint) => typeof constraint !== "string"
        )))
  ) {
    throw new Error("Release manifest has an invalid schema");
  }
  semver(value.version);
  try {
    await verifyImpl(bundle, Buffer.from(rawText), {
      certificateIssuer: RELEASE_ISSUER,
      certificateIdentityURI: RELEASE_IDENTITY,
      timeout: FETCH_TIMEOUT_MS,
      tlogThreshold: 1,
      ctLogThreshold: 1,
    });
  } catch {
    throw new Error("Release manifest Sigstore verification failed");
  }
  return {
    ...value,
    artifact: {
      url: "",
      name: artifact.name,
      sha256: artifact.sha256,
      size: Number(artifact.size),
    },
    plugins:
      value.pluginConstraints && typeof value.pluginConstraints === "object"
        ? (value.pluginConstraints as Record<string, string>)
        : {},
    signature: "sigstore-keyless",
  } as unknown as ReleaseManifest;
}

export function selectRelease(
  manifests: ReleaseManifest[],
  channel: ReleaseChannel,
  currentVersion: string,
  skippedVersion?: string | null
): ReleaseManifest | null {
  const channels: Record<ReleaseChannel, ReleaseChannel[]> = {
    stable: ["stable"],
    nightly: ["stable", "nightly"],
  };
  return (
    manifests
      .filter(
        (release) =>
          channels[channel].includes(release.channel) &&
          release.version !== skippedVersion &&
          compareVersions(release.version, currentVersion) > 0 &&
          (!release.minimumVersion ||
            compareVersions(currentVersion, release.minimumVersion) >= 0)
      )
      .sort((a, b) => compareVersions(b.version, a.version))[0] ?? null
  );
}

export function ensureReleaseTables(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      artifact_url TEXT NOT NULL,
      artifact_sha256 TEXT NOT NULL,
      published_at TEXT NOT NULL,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS installation_update_state (
      id TEXT PRIMARY KEY CHECK (id='installation'),
      installation_uuid TEXT NOT NULL,
      current_version TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'stable',
      auto_check INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'idle',
      available_release_id TEXT,
      downloaded_path TEXT,
      skipped_version TEXT,
      deferred_until TEXT,
      manifest_url TEXT,
      manifest_etag TEXT,
      last_checked_at TEXT,
      last_error TEXT,
      poll_min_ms INTEGER NOT NULL DEFAULT 14400000,
      poll_max_ms INTEGER NOT NULL DEFAULT 28800000,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS installation_update_history (
      id TEXT PRIMARY KEY,
      release_id TEXT,
      from_version TEXT NOT NULL,
      to_version TEXT,
      action TEXT NOT NULL,
      actor_id TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS release_notification_receipts (
      release_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (release_id, recipient_id)
    );
    CREATE TABLE IF NOT EXISTS release_snapshots (
      id TEXT PRIMARY KEY,
      release_id TEXT,
      location TEXT NOT NULL,
      status TEXT NOT NULL,
      lock_json TEXT NOT NULL,
      diagnostics_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS release_application_attempts (
      id TEXT PRIMARY KEY,
      release_id TEXT NOT NULL,
      snapshot_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      actor_id TEXT,
      supervisor_attempt_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS release_rollback_evidence (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      prior_version TEXT NOT NULL,
      prior_image_digest TEXT,
      snapshot_id TEXT,
      restored INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const stateColumns = new Set(
    (
      db
        .prepare("PRAGMA table_info(installation_update_state)")
        .all() as Array<{ name: string }>
    ).map((column) => column.name)
  );
  if (!stateColumns.has("auto_check")) {
    db.exec(
      "ALTER TABLE installation_update_state ADD COLUMN auto_check INTEGER NOT NULL DEFAULT 1"
    );
  }
  const configuredChannel =
    (process.env.UPDATE_CHANNEL ?? "stable").toLowerCase() === "nightly"
      ? "nightly"
      : "stable";
  db.prepare(
    `INSERT OR IGNORE INTO installation_update_state
      (id, installation_uuid, current_version, channel, manifest_url, poll_min_ms, poll_max_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    STATE_ID,
    randomUUID(),
    process.env.GODMODE_VERSION ?? "0.1.0",
    configuredChannel,
    process.env.UPDATE_MANIFEST_URL ?? channelManifestUrl(configuredChannel),
    MIN_POLL_MS,
    MAX_POLL_MS
  );
}

/** Reconcile the version observed at process boot after an external updater restart. */
export function reconcileInstalledVersion(
  db: CoreDatabase,
  observedVersion = process.env.GODMODE_VERSION ?? "0.1.0"
): boolean {
  ensureReleaseTables(db);
  semver(observedVersion);
  const current = db
    .prepare(
      "SELECT current_version, available_release_id FROM installation_update_state WHERE id=?"
    )
    .get(STATE_ID) as {
    current_version: string;
    available_release_id: string | null;
  };
  if (current.current_version === observedVersion) return false;
  const rolledBack = compareVersions(observedVersion, current.current_version) < 0;
  const openAttempt = rolledBack
    ? (db
        .prepare(
          `SELECT id, snapshot_id FROM release_application_attempts
           WHERE status IN ('requesting', 'accepted')
           ORDER BY created_at DESC LIMIT 1`
        )
        .get() as { id: string; snapshot_id: string | null } | undefined)
    : undefined;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO installation_update_history
        (id, release_id, from_version, to_version, action, actor_id, detail_json)
       VALUES (?, ?, ?, ?, 'version_observed', 'system', ?)`
    ).run(
      randomUUID(),
      current.available_release_id,
      current.current_version,
      observedVersion,
      JSON.stringify({
        source: "process_boot",
        rolledBack,
      })
    );
    if (openAttempt) {
      db.prepare(
        `UPDATE release_application_attempts SET status='rolled_back',
         error=?, completed_at=datetime('now') WHERE id=?`
      ).run("Host restored prior runtime after failed readiness", openAttempt.id);
      recordRollbackEvidence(db, {
        attemptId: openAttempt.id,
        priorVersion: current.current_version,
        priorImageDigest: process.env.GODMODE_IMAGE?.includes("@sha256:")
          ? process.env.GODMODE_IMAGE.split("@").pop() ?? null
          : null,
        snapshotId: openAttempt.snapshot_id,
        restored: true,
        evidence: {
          observedVersion,
          stage: "host_restore",
        },
      });
    }
    db.prepare(
      `UPDATE installation_update_state SET current_version=?, status='idle',
       available_release_id=NULL, downloaded_path=NULL, deferred_until=NULL,
       last_error=NULL, updated_at=datetime('now') WHERE id=?`
    ).run(observedVersion, STATE_ID);
  })();
  return true;
}

function state(db: CoreDatabase): Record<string, unknown> {
  ensureReleaseTables(db);
  return db.prepare("SELECT * FROM installation_update_state WHERE id=?").get(STATE_ID) as Record<string, unknown>;
}

function audit(
  db: CoreDatabase,
  action: string,
  actorId: string | undefined,
  releaseId?: string | null,
  detail?: unknown
): void {
  const current = state(db);
  db.prepare(
    `INSERT INTO installation_update_history
      (id, release_id, from_version, to_version, action, actor_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    releaseId ?? null,
    current.current_version,
    releaseId
      ? (db.prepare("SELECT version FROM releases WHERE id=?").get(releaseId) as { version?: string } | undefined)?.version ?? null
      : null,
    action,
    actorId ?? null,
    detail == null ? null : JSON.stringify(detail)
  );
}

function releaseRow(db: CoreDatabase, id: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM releases WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
}

function upsertRelease(db: CoreDatabase, manifest: ReleaseManifest): string {
  const id = `release:${manifest.version}`;
  db.prepare(
    `INSERT INTO releases
      (id, version, channel, manifest_json, artifact_url, artifact_sha256, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(version) DO UPDATE SET
       channel=excluded.channel, manifest_json=excluded.manifest_json,
       artifact_url=excluded.artifact_url, artifact_sha256=excluded.artifact_sha256,
       published_at=excluded.published_at`
  ).run(
    id,
    manifest.version,
    manifest.channel,
    JSON.stringify(manifest),
    manifest.artifact.url,
    manifest.artifact.sha256.toLowerCase(),
    manifest.publishedAt
  );
  return id;
}

function notifyAdmins(
  db: CoreDatabase,
  releaseId: string,
  manifest: ReleaseManifest
): number {
  const admins = db.prepare("SELECT id FROM users WHERE is_admin=1").all() as Array<{ id: string }>;
  let inserted = 0;
  db.transaction(() => {
    for (const admin of admins) {
      const receipt = db.prepare(
        "INSERT OR IGNORE INTO release_notification_receipts (release_id, recipient_id) VALUES (?, ?)"
      ).run(releaseId, admin.id);
      if (!receipt.changes) continue;
      db.prepare(
        `INSERT INTO notifications
          (id, recipient_kind, recipient_id, category, title, body, link,
           resource_kind, resource_id)
         VALUES (?, 'user', ?, 'update', ?, ?, '/settings/admin?tab=updates', 'Release', ?)`
      ).run(
        randomUUID(),
        admin.id,
        `GodMode ${manifest.version} is available`,
        `${manifest.channel} release · ${manifest.releaseNotes?.summary ?? "Review compatibility, readiness, and backup status before applying."}`,
        releaseId
      );
      inserted += 1;
    }
  })();
  return inserted;
}

export async function checkForUpdates(
  db: CoreDatabase,
  options: {
    fetchImpl?: typeof fetch;
    actorId?: string;
    verifyImpl?: typeof verifySigstore;
  } = {}
): Promise<{ release: Record<string, unknown> | null; notifications: number; notModified: boolean }> {
  const current = state(db);
  const manifestUrl = String(current.manifest_url ?? "").trim();
  if (!manifestUrl || !/^https:\/\//i.test(manifestUrl)) {
    throw new Error("HTTPS update manifest URL is not configured");
  }
  db.prepare(
    `UPDATE installation_update_state SET status='checking', updated_at=datetime('now')
     WHERE id=?`
  ).run(STATE_ID);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(manifestUrl, {
      headers: current.manifest_etag ? { "If-None-Match": String(current.manifest_etag) } : {},
      signal: controller.signal,
    });
    if (response.status === 304) {
      db.prepare(
        `UPDATE installation_update_state SET status=CASE
           WHEN available_release_id IS NULL THEN 'idle' ELSE 'available' END,
         last_checked_at=datetime('now'), last_error=NULL, updated_at=datetime('now')
         WHERE id=?`
      ).run(STATE_ID);
      return { release: null, notifications: 0, notModified: true };
    }
    if (!response.ok) throw new Error(`Manifest request failed with HTTP ${response.status}`);
    const rawText = await response.text();
    let unsigned: Record<string, unknown>;
    try {
      unsigned = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new Error("Release manifest is not valid JSON");
    }
    const signing =
      unsigned.signing && typeof unsigned.signing === "object"
        ? (unsigned.signing as Record<string, unknown>)
        : null;
    if (signing?.bundle !== "release-manifest.json.bundle") {
      throw new Error("Release manifest signature metadata is invalid");
    }
    const bundleUrl = new URL("release-manifest.json.bundle", manifestUrl).href;
    const bundleResponse = await (options.fetchImpl ?? fetch)(bundleUrl, {
      signal: controller.signal,
    });
    if (!bundleResponse.ok) {
      throw new Error(
        `Manifest signature request failed with HTTP ${bundleResponse.status}`
      );
    }
    const bundle = (await bundleResponse.json()) as SigstoreBundle;
    const verified = await validateSigstoreManifest(
      rawText,
      bundle,
      options.verifyImpl
    );
    const manifests = [{
      ...verified,
      artifact: {
        ...verified.artifact,
        url:
          verified.artifact.url ||
          new URL(
            String((verified.artifact as unknown as { name?: string }).name),
            manifestUrl
          ).href,
      },
    }].map((manifest) => ({
      ...manifest,
      minimumVersion: manifest.compatibility?.engine.minimum,
    }));
    const selected = selectRelease(
      manifests,
      String(current.channel) as ReleaseChannel,
      String(current.current_version),
      current.skipped_version as string | null
    );
    let selectedRow: Record<string, unknown> | null = null;
    let notifications = 0;
    db.transaction(() => {
      for (const manifest of manifests) upsertRelease(db, manifest);
      if (selected) {
        const releaseId = `release:${selected.version}`;
        db.prepare(
          `UPDATE installation_update_state SET available_release_id=?, status='available',
           manifest_etag=?, last_checked_at=datetime('now'), last_error=NULL,
           updated_at=datetime('now') WHERE id=?`
        ).run(releaseId, response.headers.get("etag"), STATE_ID);
        selectedRow = releaseRow(db, releaseId) ?? null;
        notifications = notifyAdmins(db, releaseId, selected);
      } else {
        db.prepare(
          `UPDATE installation_update_state SET manifest_etag=?,
           last_checked_at=datetime('now'), last_error=NULL, updated_at=datetime('now')
           WHERE id=?`
        ).run(response.headers.get("etag"), STATE_ID);
      }
    })();
    audit(db, "check_now", options.actorId, selected ? `release:${selected.version}` : null);
    return { release: selectedRow, notifications, notModified: false };
  } catch (error) {
    db.prepare(
      `UPDATE installation_update_state SET status=CASE
         WHEN available_release_id IS NULL THEN 'idle' ELSE 'available' END,
       last_checked_at=datetime('now'), last_error=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(error instanceof Error ? error.message : String(error), STATE_ID);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function pluginCompatibility(
  manifest: ReleaseManifest,
  installed = pluginRuntime.loaded.map((plugin) => plugin.manifest)
): Array<{ id: string; version: string; required: string | null; compatible: boolean }> {
  const requirements = manifest.plugins ?? {};
  return installed.map((plugin) => {
    const required = requirements[plugin.id] ?? null;
    const executable = Boolean(plugin.bridge || plugin.web);
    const engineRequirement = plugin.engine ?? null;
    return {
      id: plugin.id,
      version: plugin.version,
      required: required ?? engineRequirement,
      compatible:
        (!required || compatible(plugin.version, required)) &&
        (!executable ||
          (Boolean(engineRequirement) &&
            compatible(manifest.version, String(engineRequirement)))),
    };
  });
}

function snapshotRoot(): string {
  return path.resolve(
    process.env.UPDATE_SNAPSHOT_DIR ??
      path.join(path.dirname(config.dataDir), "GodMode-snapshots")
  );
}

function isExternalSnapshotLocation(location: string): boolean {
  const relative = path.relative(path.resolve(config.dataDir), path.resolve(location));
  return path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`);
}

function diskDiagnostics(db: AppDatabase, id: string): ReadinessDiagnostic[] {
  const checks: ReadinessDiagnostic[] = [];
  try {
    const integrity = db.pragma("quick_check", { simple: true });
    checks.push({ id: `${id}.integrity`, ok: integrity === "ok", detail: String(integrity), blocking: true });
  } catch (error) {
    checks.push({ id: `${id}.integrity`, ok: false, detail: String(error), blocking: true });
  }
  try {
    const violations = db.prepare("PRAGMA foreign_key_check").all().length;
    checks.push({ id: `${id}.foreign_keys`, ok: violations === 0, detail: `${violations} violation(s)`, blocking: true });
  } catch (error) {
    checks.push({ id: `${id}.foreign_keys`, ok: false, detail: String(error), blocking: true });
  }
  return checks;
}

export function readinessDiagnostics(
  core: CoreDatabase,
  releaseId?: string | null
): ReadinessDiagnostic[] {
  ensureReleaseTables(core);
  const diagnostics = diskDiagnostics(core, "core");
  const root = snapshotRoot();
  diagnostics.push({
    id: "snapshot.external",
    ok: isExternalSnapshotLocation(root),
    detail: root,
    blocking: true,
  });
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.accessSync(root, fs.constants.W_OK);
    diagnostics.push({ id: "snapshot.writable", ok: true, detail: root, blocking: true });
    try {
      const disk = fs.statfsSync(root);
      const freeBytes = Number(disk.bavail) * Number(disk.bsize);
      const minimumFreeBytes = Number(
        process.env.UPDATE_MIN_FREE_BYTES ?? 2 * 1024 * 1024 * 1024
      );
      diagnostics.push({
        id: "snapshot.free_space",
        ok: freeBytes >= minimumFreeBytes,
        detail: `${freeBytes} bytes free; ${minimumFreeBytes} required`,
        blocking: true,
      });
    } catch (error) {
      diagnostics.push({
        id: "snapshot.free_space",
        ok: false,
        detail: `Unable to measure free space: ${String(error)}`,
        blocking: true,
      });
    }
  } catch (error) {
    diagnostics.push({ id: "snapshot.writable", ok: false, detail: String(error), blocking: true });
  }
  for (const tenantId of listAllTenantIds(core)) {
    diagnostics.push(...diskDiagnostics(getTenantDb(tenantId), `tenant.${tenantId}`));
  }
  const selectedId =
    releaseId ?? (state(core).available_release_id as string | null | undefined);
  const selected = selectedId ? releaseRow(core, selectedId) : undefined;
  if (selected) {
    const manifest = JSON.parse(
      String(selected.manifest_json)
    ) as ReleaseManifest;
    const bounds = manifest.compatibility;
    if (bounds) {
      const currentVersion = String(state(core).current_version);
      diagnostics.push({
        id: "release.engine_compatibility",
        ok:
          compareVersions(currentVersion, bounds.engine.minimum) >= 0 &&
          compareVersions(currentVersion, bounds.engine.maximum) <= 0,
        detail: `${currentVersion} within ${bounds.engine.minimum}..${bounds.engine.maximum}`,
        blocking: true,
      });
      diagnostics.push({
        id: "release.kernel_client_api",
        ok:
          KERNEL_CLIENT_API_VERSION >= bounds.kernelClientApi.minimum &&
          KERNEL_CLIENT_API_VERSION <= bounds.kernelClientApi.maximum,
        detail: `kernel client API ${KERNEL_CLIENT_API_VERSION} within ${bounds.kernelClientApi.minimum}..${bounds.kernelClientApi.maximum}`,
        blocking: true,
      });
      for (const tenantId of listAllTenantIds(core)) {
        const version = getCurrentSchemaVersion(getTenantDb(tenantId));
        diagnostics.push({
          id: `tenant.${tenantId}.schema_compatibility`,
          ok:
            version >= bounds.schema.minimum &&
            version <= bounds.schema.maximum,
          detail: `schema ${version} within ${bounds.schema.minimum}..${bounds.schema.maximum}; binary rollback minimum ${bounds.schema.rollbackMinimum}`,
          blocking: true,
        });
      }
    }
    const compatibility = pluginCompatibility(
      manifest
    );
    diagnostics.push({
      id: "plugins.compatibility",
      ok: compatibility.every((item) => item.compatible),
      detail: JSON.stringify(compatibility),
      blocking: true,
    });
  }
  return diagnostics;
}

function lockSnapshot(core: CoreDatabase, releaseId: string | null) {
  return {
    installation: state(core),
    release: releaseId ? releaseRow(core, releaseId) ?? null : null,
    tenants: listAllTenantIds(core),
    plugins: pluginRuntime.loaded.map((plugin) => ({
      id: plugin.manifest.id,
      version: plugin.manifest.version,
      engine: plugin.manifest.engine ?? null,
      kernelApiVersion: plugin.manifest.kernelApiVersion ?? null,
      sourceRoot: plugin.pluginRoot,
      retainedArtifact: path
        .join(
          "plugin-artifacts",
          plugin.manifest.id.replace(/[^A-Za-z0-9._-]/g, "_"),
          plugin.manifest.version.replace(/[^A-Za-z0-9._-]/g, "_")
        )
        .replaceAll("\\", "/"),
    })),
    tenantPlugins: core
      .prepare(
        `SELECT tenant_id, plugin_id, version, state, desired_state
         FROM tenant_plugins ORDER BY tenant_id, plugin_id`
      )
      .all(),
    createdAt: new Date().toISOString(),
  };
}

async function backupDb(db: AppDatabase, destination: string): Promise<void> {
  await db.backup(destination);
  const verification = new (await import("better-sqlite3")).default(destination, {
    readonly: true,
  });
  try {
    const result = verification.pragma("quick_check", { simple: true });
    if (result !== "ok") throw new Error(`Snapshot verification failed: ${String(result)}`);
  } finally {
    verification.close();
  }
}

function snapshotFileManifest(root: string) {
  const files: Array<{ path: string; sha256: string; size: number }> = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name !== "snapshot-manifest.json") {
        const bytes = fs.readFileSync(absolute);
        files.push({
          path: path.relative(root, absolute).replaceAll("\\", "/"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        });
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function createCoordinatedSnapshot(
  core: CoreDatabase,
  releaseId: string | null,
  actorId?: string
): Promise<{
  id: string;
  location: string;
  lock: unknown;
  manifestSha256: string;
}> {
  const diagnostics = readinessDiagnostics(core, releaseId);
  const blocking = diagnostics.filter((item) => item.blocking && !item.ok);
  if (blocking.length) {
    throw new Error(`Snapshot preflight failed: ${blocking.map((item) => item.id).join(", ")}`);
  }
  const id = randomUUID();
  const location = path.join(
    snapshotRoot(),
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${id}`
  );
  const lock = lockSnapshot(core, releaseId);
  fs.mkdirSync(path.join(location, "databases"), { recursive: true });
  core.prepare(
    `INSERT INTO release_snapshots
      (id, release_id, location, status, lock_json, diagnostics_json)
     VALUES (?, ?, ?, 'creating', ?, ?)`
  ).run(id, releaseId, location, JSON.stringify(lock), JSON.stringify(diagnostics));
  try {
    await backupDb(core, path.join(location, "databases", "core.sqlite"));
    for (const tenantId of listAllTenantIds(core)) {
      const safe = tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
      await backupDb(
        getTenantDb(tenantId),
        path.join(location, "databases", `${safe}.sqlite`)
      );
    }
    if (fs.existsSync(config.tenantWorkspacesDir)) {
      fs.cpSync(config.tenantWorkspacesDir, path.join(location, "tenant-workspaces"), {
        recursive: true,
        force: false,
      });
    }
    for (const plugin of pluginRuntime.loaded) {
      fs.cpSync(
        plugin.pluginRoot,
        path.join(
          location,
          "plugin-artifacts",
          plugin.manifest.id.replace(/[^A-Za-z0-9._-]/g, "_"),
          plugin.manifest.version.replace(/[^A-Za-z0-9._-]/g, "_")
        ),
        { recursive: true, force: false, dereference: false }
      );
    }
    fs.writeFileSync(
      path.join(location, "plugin-lock.json"),
      `${JSON.stringify(lock, null, 2)}\n`,
      { flag: "wx" }
    );
    const files = snapshotFileManifest(location);
    const manifestPath = path.join(location, "snapshot-manifest.json");
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify({ snapshotId: id, files }, null, 2)}\n`,
      { flag: "wx" }
    );
    const manifestSha256 = createHash("sha256")
      .update(fs.readFileSync(manifestPath))
      .digest("hex");
    core.prepare(
      `UPDATE release_snapshots SET status='ready', diagnostics_json=?,
       completed_at=datetime('now')
       WHERE id=?`
    ).run(JSON.stringify({ diagnostics, manifestSha256, files }), id);
    audit(core, "snapshot", actorId, releaseId, {
      snapshotId: id,
      location,
      manifestSha256,
    });
    return { id, location, lock, manifestSha256 };
  } catch (error) {
    core.prepare(
      `UPDATE release_snapshots SET status='failed', diagnostics_json=? WHERE id=?`
    ).run(JSON.stringify({ diagnostics, error: String(error) }), id);
    throw error;
  }
}

export async function downloadRelease(
  core: CoreDatabase,
  releaseId: string,
  actorId?: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ path: string; sha256: string }> {
  const release = releaseRow(core, releaseId);
  if (!release) throw new Error("Release not found");
  core.prepare(
    `UPDATE installation_update_state SET status='downloading', updated_at=datetime('now')
     WHERE id=?`
  ).run(STATE_ID);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(String(release.artifact_url), {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Artifact request failed with HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== String(release.artifact_sha256).toLowerCase()) {
      throw new Error("Downloaded artifact digest does not match signed manifest");
    }
    const directory = path.join(config.dataDir, "updates", String(release.version));
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, "artifact.bin");
    if (fs.existsSync(destination)) {
      const existingDigest = createHash("sha256")
        .update(fs.readFileSync(destination))
        .digest("hex");
      if (existingDigest !== digest) {
        throw new Error("Existing staged artifact does not match signed manifest");
      }
    } else {
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, bytes, { flag: "wx" });
        fs.renameSync(temporary, destination);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
    core.prepare(
      `UPDATE installation_update_state SET downloaded_path=?, status='downloaded',
       updated_at=datetime('now') WHERE id=?`
    ).run(destination, STATE_ID);
    audit(core, "download", actorId, releaseId, { digest });
    return { path: destination, sha256: digest };
  } catch (error) {
    core.prepare(
      `UPDATE installation_update_state SET status='available', last_error=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(error instanceof Error ? error.message : String(error), STATE_ID);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function configureUpdates(
  core: CoreDatabase,
  input: Record<string, unknown>,
  actorId?: string
): Record<string, unknown> {
  const channel = input.channel == null ? null : String(input.channel);
  if (channel && !["stable", "nightly"].includes(channel)) {
    throw new Error("channel must be stable or nightly");
  }
  const manifestUrl =
    input.manifest_url != null
      ? String(input.manifest_url)
      : channel
        ? channelManifestUrl(channel as "stable" | "nightly")
        : null;
  if (manifestUrl && !/^https:\/\//i.test(manifestUrl)) {
    throw new Error("manifest_url must use HTTPS");
  }
  const current = state(core);
  const min =
    input.poll_min_ms == null
      ? Number(current.poll_min_ms)
      : Math.max(Number(input.poll_min_ms) || MIN_POLL_MS, 60_000);
  const max =
    input.poll_max_ms == null
      ? Number(current.poll_max_ms)
      : Math.max(Number(input.poll_max_ms) || MAX_POLL_MS, min);
  const autoCheck =
    input.auto_check == null ? null : input.auto_check === true ? 1 : 0;
  core.prepare(
    `UPDATE installation_update_state SET
       channel=COALESCE(?, channel), manifest_url=COALESCE(?, manifest_url),
       auto_check=COALESCE(?, auto_check), poll_min_ms=?, poll_max_ms=?,
       skipped_version=NULL, updated_at=datetime('now')
     WHERE id=?`
  ).run(channel, manifestUrl, autoCheck, min, max, STATE_ID);
  audit(core, "configure", actorId, null, {
    channel,
    manifestUrl,
    autoCheck,
    min,
    max,
  });
  return state(core);
}

function supervisorEndpoint(action: "apply" | "restart_to_apply"): URL {
  const configured = process.env.UPDATE_SUPERVISOR_URL?.trim();
  if (!configured || !process.env.UPDATE_SUPERVISOR_TOKEN) {
    throw new Error(
      "An authenticated local update supervisor is not installed; run the verified host update command"
    );
  }
  const base = new URL(configured);
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "::1", "localhost", "host.docker.internal"].includes(
      base.hostname
    )
  ) {
    throw new Error("Update supervisor must use authenticated local-host HTTP");
  }
  return new URL(
    action === "apply" ? "apply" : "restart_to_apply",
    `${base.href.replace(/\/?$/, "/")}`
  );
}

export function recordRollbackEvidence(
  core: CoreDatabase,
  input: {
    attemptId: string;
    priorVersion: string;
    priorImageDigest?: string | null;
    snapshotId?: string | null;
    restored: boolean;
    evidence: Record<string, unknown>;
  }
): string {
  ensureReleaseTables(core);
  const id = randomUUID();
  core.prepare(
    `INSERT INTO release_rollback_evidence
      (id, attempt_id, prior_version, prior_image_digest, snapshot_id, restored, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.attemptId,
    input.priorVersion,
    input.priorImageDigest ?? null,
    input.snapshotId ?? null,
    input.restored ? 1 : 0,
    JSON.stringify(input.evidence)
  );
  return id;
}

export async function requestSupervisorAction(
  core: CoreDatabase,
  action: "apply" | "restart_to_apply",
  actorId?: string,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const current = state(core);
  const releaseId =
    typeof current.available_release_id === "string"
      ? current.available_release_id
      : null;
  if (!releaseId) throw new Error("No verified release is available");
  const release = releaseRow(core, releaseId);
  if (!release) throw new Error("Verified release metadata is unavailable");
  let snapshot = core
    .prepare(
      `SELECT id FROM release_snapshots WHERE release_id=? AND status='ready'
       ORDER BY completed_at DESC LIMIT 1`
    )
    .get(releaseId) as { id: string } | undefined;
  if (!snapshot) {
    const created = await createCoordinatedSnapshot(core, releaseId, actorId);
    snapshot = { id: created.id };
  }
  const diagnostics = readinessDiagnostics(core, releaseId);
  const blocker = diagnostics.find((item) => item.blocking && !item.ok);
  if (blocker) throw new Error(`Update preflight failed: ${blocker.detail}`);
  const manifest = JSON.parse(String(release.manifest_json)) as ReleaseManifest;
  const attemptId = randomUUID();
  const priorVersion = String(current.current_version);
  const priorDigest = process.env.GODMODE_IMAGE?.includes("@sha256:")
    ? process.env.GODMODE_IMAGE.split("@").pop() ?? null
    : null;
  core.prepare(
    `INSERT INTO release_application_attempts
      (id, release_id, snapshot_id, action, status, actor_id)
     VALUES (?, ?, ?, ?, 'requesting', ?)`
  ).run(attemptId, releaseId, snapshot.id, action, actorId ?? null);
  core.prepare(
    `UPDATE installation_update_state SET status='applying', updated_at=datetime('now')
     WHERE id=?`
  ).run(STATE_ID);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(supervisorEndpoint(action), {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.UPDATE_SUPERVISOR_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        attempt_id: attemptId,
        release_id: releaseId,
        version: release.version,
        image: manifest.image,
        snapshot_id: snapshot.id,
        manifest_url: current.manifest_url,
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    const result =
      responseText && responseText.length < 64 * 1024
        ? (JSON.parse(responseText) as Record<string, unknown>)
        : {};
    if (!response.ok || result.accepted !== true) {
      throw new Error(
        `Update supervisor rejected the request (HTTP ${response.status})`
      );
    }
    core.prepare(
      `UPDATE release_application_attempts SET status='accepted',
       supervisor_attempt_id=? WHERE id=?`
    ).run(
      typeof result.attempt_id === "string" ? result.attempt_id : null,
      attemptId
    );
    core.prepare(
      `UPDATE installation_update_state SET status=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(
      action === "apply" ? "apply_requested" : "restart_required",
      STATE_ID
    );
    audit(core, action, actorId, releaseId, { attemptId, snapshotId: snapshot.id });
    return { attempt_id: attemptId, accepted: true, snapshot_id: snapshot.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.prepare(
      `UPDATE release_application_attempts SET status='failed', error=?,
       completed_at=datetime('now') WHERE id=?`
    ).run(message, attemptId);
    recordRollbackEvidence(core, {
      attemptId,
      priorVersion,
      priorImageDigest: priorDigest,
      snapshotId: snapshot.id,
      restored: false,
      evidence: {
        action,
        failure: message,
        stage: "supervisor_request",
      },
    });
    core.prepare(
      `UPDATE installation_update_state SET status='available', last_error=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(message, STATE_ID);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function mutateUpdateState(
  core: CoreDatabase,
  action: "defer" | "skip_release",
  input: Record<string, unknown>,
  actorId?: string
): Record<string, unknown> {
  const current = state(core);
  const releaseId = current.available_release_id as string | null;
  if (action === "defer") {
    const until = typeof input.until === "string" ? input.until : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (!Number.isFinite(Date.parse(until))) throw new Error("until must be an ISO date");
    core.prepare(
      `UPDATE installation_update_state SET status='deferred', deferred_until=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(until, STATE_ID);
  } else if (action === "skip_release") {
    if (!releaseId) throw new Error("No available release to skip");
    const release = releaseRow(core, releaseId)!;
    core.prepare(
      `UPDATE installation_update_state SET status='idle', skipped_version=?,
       available_release_id=NULL, updated_at=datetime('now') WHERE id=?`
    ).run(release.version, STATE_ID);
  }
  audit(core, action, actorId, releaseId, input);
  return state(core);
}

export class ReleasePoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly core: CoreDatabase) {}
  start(): void {
    if (this.timer) return;
    this.schedule();
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private schedule(): void {
    const current = state(this.core);
    const min = Math.max(Number(current.poll_min_ms) || MIN_POLL_MS, 60_000);
    const max = Math.max(Number(current.poll_max_ms) || MAX_POLL_MS, min);
    const delay = Math.floor(min + Math.random() * (max - min + 1));
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        if (Number(state(this.core).auto_check) !== 0) {
          await checkForUpdates(this.core);
        }
      } catch (error) {
        console.warn("[updates] poll failed:", error instanceof Error ? error.message : error);
      } finally {
        this.schedule();
      }
    }, delay);
    this.timer.unref?.();
  }
}
