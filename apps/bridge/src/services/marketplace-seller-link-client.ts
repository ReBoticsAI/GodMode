import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { MarketplaceCommerceError } from "./marketplace-commerce.js";
import { cloudCommerceBase } from "./marketplace-cloud-checkout-client.js";

type StoredSellerLink = {
  accessToken: string;
  linkedAt: string;
};

function sellerLinkPath(): string {
  return path.join(config.dataDir, "seller-cloud-link.json");
}

export function readStoredSellerLink(): StoredSellerLink | null {
  try {
    const raw = fs.readFileSync(sellerLinkPath(), "utf8");
    const parsed = JSON.parse(raw) as StoredSellerLink;
    if (!parsed?.accessToken || typeof parsed.accessToken !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSellerLink(accessToken: string): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const payload: StoredSellerLink = {
    accessToken,
    linkedAt: new Date().toISOString(),
  };
  fs.writeFileSync(sellerLinkPath(), JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
}

export function clearStoredSellerLink(): void {
  try {
    fs.unlinkSync(sellerLinkPath());
  } catch {
    /* missing is fine */
  }
}

async function cloudSellerJson<T>(
  pathName: string,
  init?: RequestInit
): Promise<T> {
  const base = cloudCommerceBase();
  if (!base) {
    throw new MarketplaceCommerceError("Cloud Marketplace URL is not configured", 503);
  }
  const timeout = Number(config.marketplace.catalogFetchTimeoutMs) > 0
    ? Number(config.marketplace.catalogFetchTimeoutMs)
    : 8000;
  const res = await fetch(`${base}${pathName}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new MarketplaceCommerceError(
      typeof json.error === "string" ? json.error : `Cloud seller-link request failed (${res.status})`,
      res.status >= 400 && res.status < 600 ? res.status : 502
    );
  }
  return json;
}

export async function startCloudSellerLinkDevice(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}> {
  const json = await cloudSellerJson<{
    deviceCode?: string;
    device_code?: string;
    userCode?: string;
    user_code?: string;
    verificationUrl?: string;
    verification_url?: string;
    expiresIn?: number;
    expires_in?: number;
    interval?: number;
  }>("/api/saas/seller-link/device", { method: "POST", body: "{}" });
  return {
    deviceCode: String(json.deviceCode ?? json.device_code ?? ""),
    userCode: String(json.userCode ?? json.user_code ?? ""),
    verificationUrl: String(json.verificationUrl ?? json.verification_url ?? ""),
    expiresIn: Number(json.expiresIn ?? json.expires_in ?? 900),
    interval: Number(json.interval ?? 5),
  };
}

export async function pollCloudSellerLinkToken(deviceCode: string): Promise<{
  status: string;
  accessToken?: string;
}> {
  const json = await cloudSellerJson<{
    status: string;
    access_token?: string;
    accessToken?: string;
  }>("/api/saas/seller-link/token", {
    method: "POST",
    body: JSON.stringify({ device_code: deviceCode }),
  });
  return {
    status: json.status,
    accessToken: json.access_token ?? json.accessToken,
  };
}

export async function fetchCloudSellerEntitlement(accessToken: string): Promise<{
  sellerActive: boolean;
  planId: string | null;
  source: string | null;
  cloudUserHint?: string | null;
}> {
  return cloudSellerJson("/api/saas/seller-entitlement", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function revokeCloudSellerLinkToken(accessToken: string): Promise<void> {
  await cloudSellerJson("/api/saas/seller-link/token", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getLocalSellerLinkStatus(): Promise<{
  linked: boolean;
  sellerActive: boolean;
  planId: string | null;
  source: string | null;
  cloudUserHint: string | null;
  linkedAt: string | null;
}> {
  const stored = readStoredSellerLink();
  if (!stored) {
    return {
      linked: false,
      sellerActive: false,
      planId: null,
      source: null,
      cloudUserHint: null,
      linkedAt: null,
    };
  }
  try {
    const ent = await fetchCloudSellerEntitlement(stored.accessToken);
    return {
      linked: true,
      sellerActive: Boolean(ent.sellerActive),
      planId: ent.planId ?? null,
      source: ent.source ?? null,
      cloudUserHint: ent.cloudUserHint ?? null,
      linkedAt: stored.linkedAt,
    };
  } catch (err) {
    if (err instanceof MarketplaceCommerceError && err.status === 401) {
      clearStoredSellerLink();
      return {
        linked: false,
        sellerActive: false,
        planId: null,
        source: null,
        cloudUserHint: null,
        linkedAt: null,
      };
    }
    throw err;
  }
}
