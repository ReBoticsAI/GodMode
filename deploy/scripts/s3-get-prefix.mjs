#!/usr/bin/env node
/**
 * Download one backup stamp prefix from S3-compatible storage into /out.
 * Env: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID,
 *      BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_REGION, BACKUP_S3_PREFIX, STAMP
 */
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim();
const bucket = process.env.BACKUP_S3_BUCKET?.trim();
const accessKey = process.env.BACKUP_S3_ACCESS_KEY_ID?.trim();
const secretKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY?.trim();
const region = process.env.BACKUP_S3_REGION?.trim() || "auto";
const prefix = (process.env.BACKUP_S3_PREFIX ?? "godmode/").replace(/\/?$/, "/");
const stamp = process.env.STAMP?.trim();
const outRoot = "/out";

if (!endpoint || !bucket || !accessKey || !secretKey || !stamp) {
  console.error("BACKUP_S3_* and STAMP are required");
  process.exit(1);
}

const listPrefix = `${prefix}${stamp}/`;
const host = new URL(endpoint).host;

function amzNow() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(dateStamp) {
  const kDate = createHmac("sha256", `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

async function signedFetch(method, objectKey, queryPairs = []) {
  const amzDate = amzNow();
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update("").digest("hex");
  const canonicalUri = `/${bucket}/${objectKey}`.replace(/\/+/g, "/");
  const canonicalQuery = queryPairs
    .slice()
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
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
  const signature = createHmac("sha256", signingKey(dateStamp))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const qs = canonicalQuery ? `?${canonicalQuery}` : "";
  const url = `${endpoint.replace(/\/$/, "")}${canonicalUri}${qs}`;
  const res = await fetch(url, {
    method,
    headers: {
      Host: host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
  });
  if (!res.ok) {
    throw new Error(`${method} ${objectKey}${qs} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

function xmlKeys(xml) {
  const keys = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  let m;
  while ((m = re.exec(xml))) keys.push(m[1]);
  return keys;
}

const listRes = await signedFetch("GET", "", [
  ["list-type", "2"],
  ["prefix", listPrefix],
]);
const keys = xmlKeys(await listRes.text());
if (keys.length === 0) {
  console.error(`No objects under ${listPrefix}`);
  process.exit(1);
}

for (const key of keys) {
  const rel = key.startsWith(listPrefix) ? key.slice(listPrefix.length) : key;
  if (!rel || rel.endsWith("/")) continue;
  const dest = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const obj = await signedFetch("GET", key);
  const buf = Buffer.from(await obj.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`got ${rel} (${buf.length} bytes)`);
}

console.log(`Downloaded ${keys.length} object(s) to ${outRoot}`);
