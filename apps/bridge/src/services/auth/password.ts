import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const SCHEME = "scrypt";

/**
 * Hash a plaintext password with scrypt and a random per-user salt.
 * Stored format: `scrypt$<saltHex>$<hashHex>`.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN);
  return `${SCHEME}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Verify a plaintext password against a stored `scrypt$<saltHex>$<hashHex>`
 * string using a constant-time comparison. Returns false for malformed or
 * empty stored values.
 */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== SCHEME) return false;
  const [, saltHex, hashHex] = parts;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const actual = scryptSync(plain, Buffer.from(saltHex, "hex"), expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
