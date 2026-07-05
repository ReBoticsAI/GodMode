import type { AppDatabase } from "../../db.js";
import { config } from "../../config.js";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto-box.js";

export type CredentialProvider = "moralis" | "paypal";

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
}

export class CredentialStore {
  constructor(private db: AppDatabase) {}

  private get(provider: CredentialProvider, name: string): string | null {
    const row = this.db
      .prepare(
        `SELECT value_encrypted FROM holdings_credentials
         WHERE provider = ? AND name = ?`
      )
      .get(provider, name) as { value_encrypted: string } | undefined;
    if (!row) return null;
    try {
      return decryptSecret(row.value_encrypted);
    } catch {
      return null;
    }
  }

  private set(provider: CredentialProvider, name: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO holdings_credentials (provider, name, value_encrypted, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(provider, name) DO UPDATE SET
           value_encrypted = excluded.value_encrypted,
           updated_at = datetime('now')`
      )
      .run(provider, name, encryptSecret(value));
  }

  getMoralisApiKey(): string | null {
    return this.get("moralis", "api_key") ?? (config.holdings.moralisApiKey || null);
  }

  setMoralisApiKey(apiKey: string): void {
    this.set("moralis", "api_key", apiKey);
  }

  getPayPalCredentials(): PayPalCredentials | null {
    const clientId =
      this.get("paypal", "client_id") ?? (config.holdings.paypalClientId || null);
    const clientSecret =
      this.get("paypal", "client_secret") ??
      (config.holdings.paypalClientSecret || null);
    if (!clientId || !clientSecret) return null;
    const envRaw = this.get("paypal", "env");
    const env =
      envRaw === "live" || envRaw === "sandbox"
        ? envRaw
        : config.holdings.paypalEnv;
    return { clientId, clientSecret, env };
  }

  setPayPalCredentials(creds: PayPalCredentials): void {
    this.set("paypal", "client_id", creds.clientId);
    this.set("paypal", "client_secret", creds.clientSecret);
    this.set("paypal", "env", creds.env);
  }

  getPayPalAccessToken(): { token: string; expiresAt: number } | null {
    const raw = this.get("paypal", "access_token_cache");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { token: string; expiresAt: number };
    } catch {
      return null;
    }
  }

  setPayPalAccessToken(token: string, expiresAt: number): void {
    this.set("paypal", "access_token_cache", JSON.stringify({ token, expiresAt }));
  }

  configStatus(): {
    moralis: { configured: boolean; masked?: string };
    paypal: { configured: boolean; env?: string; clientIdMasked?: string };
  } {
    const moralisKey = this.getMoralisApiKey();
    const paypal = this.getPayPalCredentials();
    return {
      moralis: {
        configured: Boolean(moralisKey),
        masked: moralisKey ? maskSecret(moralisKey) : undefined,
      },
      paypal: {
        configured: Boolean(paypal),
        env: paypal?.env,
        clientIdMasked: paypal ? maskSecret(paypal.clientId) : undefined,
      },
    };
  }
}
