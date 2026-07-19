#!/usr/bin/env node
/**
 * Snapshot core.sqlite + tenants/*.sqlite, optionally upload to S3-compatible storage.
 *
 * Env:
 *   PLATFORM_DATA_DIR   — GodMode data root (required)
 *   BACKUP_LOCAL_DIR    — output dir (default: PLATFORM_DATA_DIR/backups)
 *   BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET,
 *   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_PREFIX
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import Database from "better-sqlite3";

const dataDir = process.env.PLATFORM_DATA_DIR?.trim();
if (!dataDir) {
  console.error("PLATFORM_DATA_DIR is required");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const localRoot =
  process.env.BACKUP_LOCAL_DIR?.trim() || path.join(dataDir, "backups");
const dest = path.join(localRoot, stamp);
fs.mkdirSync(path.join(dest, "databases"), { recursive: true });
fs.mkdirSync(path.join(dest, "tenants"), { recursive: true });

function backupSqlite(src, destFile) {
  if (!fs.existsSync(src)) {
    console.warn(`skip missing ${src}`);
    return false;
  }
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    db.backup(destFile);
  } finally {
    db.close();
  }
  return true;
}

const coreSrc = path.join(dataDir, "core.sqlite");
backupSqlite(coreSrc, path.join(dest, "databases", "core.sqlite"));

const tenantsDir = path.join(dataDir, "tenants");
if (fs.existsSync(tenantsDir)) {
  for (const name of fs.readdirSync(tenantsDir)) {
    if (!name.endsWith(".sqlite")) continue;
    backupSqlite(
      path.join(tenantsDir, name),
      path.join(dest, "tenants", name)
    );
  }
}

const metaPath = path.join(dest, "manifest.json");
fs.writeFileSync(
  metaPath,
  JSON.stringify({ createdAt: new Date().toISOString(), dataDir, dest }, null, 2)
);

console.log(`Local snapshot: ${dest}`);

const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim();
const bucket = process.env.BACKUP_S3_BUCKET?.trim();
const accessKey = process.env.BACKUP_S3_ACCESS_KEY_ID?.trim();
const secretKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY?.trim();
const region = process.env.BACKUP_S3_REGION?.trim() || "auto";
const prefix = (process.env.BACKUP_S3_PREFIX ?? "godmode/").replace(/\/?$/, "/");

async function putObject(key, body, contentType) {
  const host = new URL(endpoint).host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalUri = `/${bucket}/${key}`.replace(/\/+/g, "/");
  // Path-style: https://endpoint/bucket/key
  const url = `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    `/${bucket}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const kDate = createHmac("sha256", `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Host: host,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`S3 PUT ${key} failed: ${res.status} ${await res.text()}`);
  }
  return url;
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full, base));
    else out.push({ full, rel: path.relative(base, full).replace(/\\/g, "/") });
  }
  return out;
}

let remoteUri = null;
let status = "ok";
let error = null;

if (endpoint && bucket && accessKey && secretKey) {
  try {
    const files = walkFiles(dest);
    for (const f of files) {
      const key = `${prefix}${stamp}/${f.rel}`;
      const body = fs.readFileSync(f.full);
      const type = f.rel.endsWith(".json")
        ? "application/json"
        : "application/octet-stream";
      remoteUri = await putObject(key, body, type);
    }
    console.log(`Uploaded under s3://${bucket}/${prefix}${stamp}/`);
  } catch (err) {
    status = "upload_failed";
    error = err instanceof Error ? err.message : String(err);
    console.error(error);
  }
} else {
  console.log("S3 env not fully set — local snapshot only");
}

// Best-effort: write platform_backup_meta when core is writable
try {
  const coreWrite = path.join(dataDir, "core.sqlite");
  if (fs.existsSync(coreWrite)) {
    const db = new Database(coreWrite);
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_backup_meta (
        id TEXT PRIMARY KEY CHECK (id = 'latest'),
        status TEXT NOT NULL,
        local_path TEXT,
        remote_uri TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      `INSERT INTO platform_backup_meta (id, status, local_path, remote_uri, error, updated_at)
       VALUES ('latest', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         status=excluded.status,
         local_path=excluded.local_path,
         remote_uri=excluded.remote_uri,
         error=excluded.error,
         updated_at=datetime('now')`
    ).run(status, dest, remoteUri, error);
    db.close();
  }
} catch (err) {
  console.warn("Could not update platform_backup_meta:", err);
}

if (status !== "ok" && endpoint) process.exit(1);
