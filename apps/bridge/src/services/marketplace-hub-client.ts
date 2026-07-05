import { config } from "../config.js";

/** Marketplace credits and entitlements are authoritative on the official hub only. */
export function isMarketplaceHubAuthority(): boolean {
  return config.isHub || config.deploymentMode === "local";
}

export function requireCloudHubUrl(): string {
  const base = config.cloudHubUrl;
  if (!base) {
    throw new Error("CLOUD_HUB_URL is required in client mode for marketplace operations");
  }
  return base;
}

export async function proxyToCloudHub(
  path: string,
  init: RequestInit & { sessionCookie?: string; tenantId?: string }
): Promise<Response> {
  const base = requireCloudHubUrl();
  const headers = new Headers(init.headers);
  if (init.sessionCookie) {
    headers.set("Cookie", init.sessionCookie);
  }
  if (init.tenantId) {
    headers.set("X-Tenant-Id", init.tenantId);
  }
  return fetch(`${base}${path}`, { ...init, headers });
}
