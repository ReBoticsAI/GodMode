import { config } from "../config.js";
import { MarketplaceCommerceError } from "./marketplace-commerce.js";

export function cloudCommerceBase(): string {
  const explicit = (process.env.MARKETPLACE_SAAS_CHECKOUT_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const community = config.marketplace.saasCommunityCatalogUrl.trim();
  if (community) {
    try {
      return new URL(community).origin;
    } catch {
      /* fall through */
    }
  }
  if (process.env.VITEST) return "";
  return "https://app.godmode.software";
}

async function cloudJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = cloudCommerceBase();
  if (!base) {
    throw new MarketplaceCommerceError("Cloud Marketplace URL is not configured", 503);
  }
  const timeout = Number(config.marketplace.catalogFetchTimeoutMs) > 0
    ? Number(config.marketplace.catalogFetchTimeoutMs)
    : 8000;
  const res = await fetch(`${base}${path}`, {
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
      typeof json.error === "string" ? json.error : `Cloud Marketplace request failed (${res.status})`,
      res.status >= 400 && res.status < 600 ? res.status : 502
    );
  }
  return json;
}

export async function startCloudGuestCheckout(body: {
  listingId: string;
  successUrl: string;
  cancelUrl: string;
  email?: string;
  tosAccepted: boolean;
}): Promise<{ url: string; sessionId: string; orderId: string }> {
  return cloudJson("/api/marketplace/commerce/checkout", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchCloudGuestCheckoutStatus(sessionId: string): Promise<{
  paid: boolean;
  status: string;
  listingId: string | null;
  catalogEntryId: string | null;
}> {
  const q = encodeURIComponent(sessionId);
  return cloudJson(`/api/marketplace/commerce/checkout/status?session_id=${q}`);
}

export async function fetchCloudGuestDelivery(sessionId: string): Promise<{
  paid: true;
  deliveryKind: "plugin" | "clone";
  listingId: string | null;
  catalogEntryId: string | null;
  bundle: unknown | null;
}> {
  const q = encodeURIComponent(sessionId);
  return cloudJson(`/api/marketplace/commerce/delivery?session_id=${q}`);
}
