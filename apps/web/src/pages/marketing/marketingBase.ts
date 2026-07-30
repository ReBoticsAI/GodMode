/**
 * Marketing URL prefix.
 * - `""` when `VITE_MARKETING_AT_ROOT=true` (Cloudflare Pages apex/www host)
 * - `/www` by default (app origin / local, so `/` stays the authenticated app)
 */
export function resolveMarketingBase(): string {
  if (import.meta.env.VITE_MARKETING_AT_ROOT === "true") return "";
  const raw = import.meta.env.VITE_MARKETING_BASE as string | undefined;
  if (raw === undefined) return "/www";
  const trimmed = raw.trim().replace(/\/$/, "");
  if (trimmed === "" || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export const MARKETING_BASE = resolveMarketingBase();

/** Home path for NavLink / crumbs (`/` when marketing is at root). */
export const MARKETING_HOME = MARKETING_BASE || "/";

export const marketingAtRoot = MARKETING_BASE === "";
