/**
 * Sanitize text destined for public GitHub / GH Projects cards.
 * Aligns with OSS / no-PII rules used for public GodMode surfaces.
 */

import { SECRETISH } from "./secret-scrub.js";

const HOME_PATH =
  /(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s"'`]+/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PRIVATE_PLUGIN =
  /\b(?:godmode-plugin-sierra|godmode-plugin-polymarket|@godmode-plugin-[\w-]+)\b/gi;
const META_VOICE =
  /\b(?:Operator action required|Agent stopped here|the agent will|Agent will)\b/gi;

/** Em dash and double-hyphen em substitutes (user-facing prose ban). */
const EM_DASH = /\u2014|--/g;

export function sanitizePublicOssText(input: string): string {
  let out = input ?? "";
  out = out.replace(SECRETISH, "[redacted]");
  out = out.replace(HOME_PATH, "[path]");
  out = out.replace(EMAIL, "[email]");
  out = out.replace(PRIVATE_PLUGIN, "[private-plugin]");
  out = out.replace(META_VOICE, "[redacted]");
  out = out.replace(EM_DASH, " - ");
  return out.trim();
}
