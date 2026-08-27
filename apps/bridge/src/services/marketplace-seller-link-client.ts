import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { MarketplaceCommerceError } from "./marketplace-commerce.js";
import { cloudCommerceBase } from "./marketplace-cloud-checkout-client.js";
import { githubProjectsStatus } from "./github-integration.js";
import { getUserDb } from "../user-registry.js";

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

export async function startCloudSellerLinkRedirect(returnUrl: string): Promise<{
  state: string;
  connectUrl: string;
  expiresIn: number;
}> {
  const json = await cloudSellerJson<{
    state: string;
    connectUrl?: string;
    connect_url?: string;
    expiresIn?: number;
    expires_in?: number;
  }>("/api/saas/seller-link/redirect", {
    method: "POST",
    body: JSON.stringify({ return_url: returnUrl }),
  });
  return {
    state: String(json.state ?? ""),
    connectUrl: String(json.connectUrl ?? json.connect_url ?? ""),
    expiresIn: Number(json.expiresIn ?? json.expires_in ?? 1800),
  };
}

export async function startCloudSellerGithubRedirect(returnUrl: string): Promise<{
  state: string;
  connectUrl: string;
  expiresIn: number;
}> {
  const json = await cloudSellerJson<{
    state: string;
    connectUrl?: string;
    connect_url?: string;
    expiresIn?: number;
    expires_in?: number;
  }>("/api/saas/seller-link/github-redirect", {
    method: "POST",
    body: JSON.stringify({ return_url: returnUrl }),
  });
  return {
    state: String(json.state ?? ""),
    connectUrl: String(json.connectUrl ?? json.connect_url ?? ""),
    expiresIn: Number(json.expiresIn ?? json.expires_in ?? 1800),
  };
}

export async function startCloudSellerStripeRedirect(returnUrl: string): Promise<{
  state: string;
  connectUrl: string;
  expiresIn: number;
}> {
  const json = await cloudSellerJson<{
    state: string;
    connectUrl?: string;
    connect_url?: string;
    expiresIn?: number;
    expires_in?: number;
  }>("/api/saas/seller-link/stripe-redirect", {
    method: "POST",
    body: JSON.stringify({ return_url: returnUrl }),
  });
  return {
    state: String(json.state ?? ""),
    connectUrl: String(json.connectUrl ?? json.connect_url ?? ""),
    expiresIn: Number(json.expiresIn ?? json.expires_in ?? 1800),
  };
}

export async function exchangeCloudSellerLinkCode(code: string): Promise<{
  accessToken: string;
}> {
  const json = await cloudSellerJson<{
    status: string;
    access_token?: string;
    accessToken?: string;
  }>("/api/saas/seller-link/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  const accessToken = json.access_token ?? json.accessToken;
  if (!accessToken) {
    throw new MarketplaceCommerceError("Cloud seller-link exchange returned no token", 502);
  }
  return { accessToken };
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
  githubConnected?: boolean;
  githubLogin?: string | null;
  tosAccepted?: boolean;
  stripePayoutReady?: boolean;
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

export type CloudSellerPublishListingInput = {
  catalogEntryId: string;
  kind?: string;
  title?: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  deliveryMode?: string;
  stripeConnectAttestation?: boolean;
};

/** Mirror Local Sell publish onto Cloud for checkout authority (#709). */
export async function publishCloudListingViaSellerLink(
  accessToken: string,
  input: CloudSellerPublishListingInput
): Promise<{ listing: Record<string, unknown> }> {
  return cloudSellerJson("/api/saas/seller-link/publish-listing", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      catalog_entry_id: input.catalogEntryId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      price_cents: input.priceCents,
      currency: input.currency,
      delivery_mode: input.deliveryMode,
      stripe_connect_attestation: input.stripeConnectAttestation === true,
    }),
  });
}

export type LocalSellerLinkStatus = {
  linked: boolean;
  sellerActive: boolean;
  planId: string | null;
  source: string | null;
  cloudUserHint: string | null;
  linkedAt: string | null;
  githubConnected: boolean;
  /** Seller Cloud user GitHub login for Local catalog claim/publish (#711). */
  githubLogin: string | null;
  tosAccepted: boolean;
  stripePayoutReady: boolean;
};

const emptySellerLinkStatus = (): LocalSellerLinkStatus => ({
  linked: false,
  sellerActive: false,
  planId: null,
  source: null,
  cloudUserHint: null,
  linkedAt: null,
  githubConnected: false,
  githubLogin: null,
  tosAccepted: false,
  stripePayoutReady: false,
});

export async function getLocalSellerLinkStatus(): Promise<LocalSellerLinkStatus> {
  const stored = readStoredSellerLink();
  if (!stored) {
    return emptySellerLinkStatus();
  }
  try {
    const ent = await fetchCloudSellerEntitlement(stored.accessToken);
    const githubLogin = String(ent.githubLogin ?? "").trim() || null;
    return {
      linked: true,
      sellerActive: Boolean(ent.sellerActive),
      planId: ent.planId ?? null,
      source: ent.source ?? null,
      cloudUserHint: ent.cloudUserHint ?? null,
      linkedAt: stored.linkedAt,
      githubConnected: Boolean(ent.githubConnected) || Boolean(githubLogin),
      githubLogin,
      tosAccepted: Boolean(ent.tosAccepted),
      stripePayoutReady: Boolean(ent.stripePayoutReady),
    };
  } catch (err) {
    if (err instanceof MarketplaceCommerceError && err.status === 401) {
      clearStoredSellerLink();
      return emptySellerLinkStatus();
    }
    throw err;
  }
}

/**
 * GitHub login for Local Sell claim/publish (#711).
 * Prefer the linked Seller Cloud account login; fall back to Local Vault Connect.
 */
export async function resolveLocalSellGithubLogin(
  localUserId: string
): Promise<string | null> {
  if (!config.isSaas) {
    try {
      const status = await getLocalSellerLinkStatus();
      const fromSeller = String(status.githubLogin ?? "").trim();
      if (status.linked && fromSeller) return fromSeller;
    } catch {
      /* fall through to Local Vault */
    }
  }
  try {
    return (
      String(githubProjectsStatus(getUserDb(localUserId), localUserId).login ?? "").trim() ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Stripe payout readiness for Local Sell publish (#709).
 * Prefer linked Cloud Seller Stripe Connect; Local Vault Connect is optional.
 */
export async function resolveLocalSellPayoutReady(): Promise<boolean> {
  if (config.isSaas) return false;
  try {
    const status = await getLocalSellerLinkStatus();
    return Boolean(status.linked && status.stripePayoutReady);
  } catch {
    return false;
  }
}
