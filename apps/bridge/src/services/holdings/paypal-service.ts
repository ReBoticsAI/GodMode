import type { CredentialStore, PayPalCredentials } from "./credential-store.js";
import { usdToCad } from "./fx-service.js";

export interface PayPalBalanceResult {
  currency: string;
  available: number;
  total: number;
  totalCad: number;
  raw: unknown;
}

interface PayPalTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface PayPalBalanceEntry {
  currency?: string;
  primary?: boolean;
  total_balance?: { currency_code?: string; value?: string };
  available_balance?: { currency_code?: string; value?: string };
}

interface PayPalBalancesResponse {
  balances?: PayPalBalanceEntry[];
  name?: string;
  message?: string;
  details?: unknown;
}

function paypalBaseUrl(env: "sandbox" | "live"): string {
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export class PayPalService {
  constructor(private credentials: CredentialStore) {}

  private creds(): PayPalCredentials {
    const c = this.credentials.getPayPalCredentials();
    if (!c) throw new Error("PayPal credentials not configured");
    return c;
  }

  private async getAccessToken(creds: PayPalCredentials): Promise<string> {
    const cached = this.credentials.getPayPalAccessToken();
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString(
      "base64"
    );
    const url = `${paypalBaseUrl(creds.env)}/v1/oauth2/token`;
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    const data = (await res.json()) as PayPalTokenResponse;
    if (!res.ok || !data.access_token) {
      throw new Error(
        data.error_description ?? data.error ?? `PayPal auth failed (${res.status})`
      );
    }
    const expiresIn = (data.expires_in ?? 3600) * 1000;
    this.credentials.setPayPalAccessToken(
      data.access_token,
      Date.now() + expiresIn
    );
    return data.access_token;
  }

  async fetchBalance(preferCurrency = "CAD"): Promise<PayPalBalanceResult> {
    const creds = this.creds();
    const token = await this.getAccessToken(creds);
    const base = paypalBaseUrl(creds.env);

    const url = `${base}/v1/reporting/balances?currency_code=ALL`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data = (await res.json()) as PayPalBalancesResponse;
    if (!res.ok) {
      throw new Error(
        data.message ?? `PayPal balances failed (${res.status})`
      );
    }

    const balances = data.balances ?? [];
    if (balances.length === 0) {
      throw new Error("PayPal returned no balance entries");
    }

    let entry =
      balances.find(
        (b) =>
          b.currency?.toUpperCase() === preferCurrency ||
          b.total_balance?.currency_code?.toUpperCase() === preferCurrency
      ) ??
      balances.find((b) => b.primary) ??
      balances[0];

    const currency =
      entry.total_balance?.currency_code ??
      entry.available_balance?.currency_code ??
      entry.currency ??
      preferCurrency;
    const available = Number(entry.available_balance?.value ?? 0);
    const total = Number(entry.total_balance?.value ?? available);

    let totalCad = total;
    if (currency.toUpperCase() === "USD") {
      totalCad = await usdToCad(total);
    } else if (currency.toUpperCase() !== "CAD") {
      totalCad = total;
    }

    return {
      currency: currency.toUpperCase(),
      available,
      total,
      totalCad,
      raw: data,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.fetchBalance();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
