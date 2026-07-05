import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "../../config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadOrCreateKey(): Buffer {
  if (config.holdings.secretKey) {
    const hex = config.holdings.secretKey.trim();
    if (hex.length === 64) return Buffer.from(hex, "hex");
    throw new Error("HOLDINGS_SECRET_KEY must be 64 hex chars (32 bytes)");
  }
  const path = config.holdings.secretKeyPath;
  if (fs.existsSync(path)) {
    const hex = fs.readFileSync(path, "utf8").trim();
    return Buffer.from(hex, "hex");
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(path, key.toString("hex"), { mode: 0o600 });
  return key;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadOrCreateKey();
  return cachedKey;
}

/** Encrypt plaintext; returns base64(iv + tag + ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt value produced by encryptSecret. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function maskSecret(value: string, visible = 4): string {
  if (value.length <= visible) return "****";
  return `${"*".repeat(Math.min(8, value.length - visible))}${value.slice(-visible)}`;
}
