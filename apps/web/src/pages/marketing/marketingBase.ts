const MARKETING_HOSTS = new Set([
  "godmode.software",
  "www.godmode.software",
]);

function hostLooksLikePagesPreview(hostname: string): boolean {
  return hostname.endsWith(".pages.dev") && hostname.includes("godmode-www");
}

/** True on the public marketing host (apex, www, or godmode-www Pages preview). */
export function isMarketingHost(hostname = window.location.hostname): boolean {
  if (import.meta.env.VITE_MARKETING_AT_ROOT === "true") return true;
  if (import.meta.env.VITE_MARKETING_AT_ROOT === "false") return false;
  return MARKETING_HOSTS.has(hostname) || hostLooksLikePagesPreview(hostname);
}

/**
 * Marketing URL prefix.
 * - `""` on Cloudflare Pages marketing hosts (apex/www / pages.dev previews)
 * - `/www` on the app origin and local so `/` stays the authenticated app
 *
 * Override: `VITE_MARKETING_AT_ROOT=true|false`, or `VITE_MARKETING_BASE`.
 */
export function resolveMarketingBase(
  hostname = typeof window !== "undefined" ? window.location.hostname : ""
): string {
  const raw = import.meta.env.VITE_MARKETING_BASE as string | undefined;
  if (raw !== undefined) {
    const trimmed = raw.trim().replace(/\/$/, "");
    if (trimmed === "" || trimmed === "/") return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
  if (hostname && isMarketingHost(hostname)) return "";
  return "/www";
}

export const MARKETING_BASE = resolveMarketingBase();

/** Home path for NavLink / crumbs (`/` when marketing is at root). */
export const MARKETING_HOME = MARKETING_BASE || "/";

export const marketingAtRoot = MARKETING_BASE === "";
