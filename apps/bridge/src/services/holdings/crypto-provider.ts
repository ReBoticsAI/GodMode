import { config } from "../../config.js";
import type { CredentialStore } from "./credential-store.js";
import { usdToCad } from "./fx-service.js";

export interface TokenBreakdown {
  symbol: string;
  name: string;
  chain: string;
  balance: number;
  usdValue: number;
  cadValue: number;
  contractAddress?: string;
  logo?: string;
}

export interface CryptoPortfolio {
  address: string;
  totalUsd: number;
  totalCad: number;
  tokens: TokenBreakdown[];
  chains: string[];
}

interface MoralisToken {
  symbol?: string;
  name?: string;
  balance?: string;
  decimals?: number;
  usd_value?: number;
  usd_price?: number;
  token_address?: string;
  logo?: string;
  native_token?: boolean;
}

interface MoralisTokensResponse {
  result?: MoralisToken[];
}

interface MoralisNativeResponse {
  balance?: string;
}

const moralisLimiter = { last: 0, minGap: 200 };

async function moralisFetch<T>(url: string, apiKey: string): Promise<T | null> {
  const now = Date.now();
  const wait = moralisLimiter.minGap - (now - moralisLimiter.last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  moralisLimiter.last = Date.now();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
        },
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[holdings/moralis] ${res.status} ${url} ${text.slice(0, 120)}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      console.warn("[holdings/moralis] fetch error", err);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

function parseTokenBalance(raw: string | undefined, decimals: number): number {
  if (!raw) return 0;
  try {
    const n = BigInt(raw);
    const div = 10 ** decimals;
    return Number(n) / div;
  } catch {
    return 0;
  }
}

export class CryptoProvider {
  constructor(private credentials: CredentialStore) {}

  private apiKey(): string {
    const key = this.credentials.getMoralisApiKey();
    if (!key) throw new Error("Moralis API key not configured");
    return key;
  }

  async fetchPortfolio(
    address: string,
    chains = config.holdings.cryptoChains
  ): Promise<CryptoPortfolio> {
    const apiKey = this.apiKey();
    const normalized = address.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
      throw new Error("Invalid EVM wallet address");
    }

    const tokens: TokenBreakdown[] = [];
    let totalUsd = 0;

    for (const chain of chains) {
      const tokenUrl = `https://deep-index.moralis.io/api/v2.2/wallets/${normalized}/tokens?chain=${chain}&limit=100&exclude_spam=true`;
      const tokenData = await moralisFetch<MoralisTokensResponse>(tokenUrl, apiKey);
      for (const t of tokenData?.result ?? []) {
        const decimals = t.decimals ?? 18;
        const bal = parseTokenBalance(t.balance, decimals);
        const usd =
          typeof t.usd_value === "number"
            ? t.usd_value
            : typeof t.usd_price === "number"
              ? bal * t.usd_price
              : 0;
        if (usd < 0.01 && bal < 1e-8) continue;
        totalUsd += usd;
        tokens.push({
          symbol: t.symbol ?? "?",
          name: t.name ?? t.symbol ?? "Unknown",
          chain,
          balance: bal,
          usdValue: usd,
          cadValue: 0,
          contractAddress: t.token_address,
          logo: t.logo,
        });
      }

      const nativeUrl = `https://deep-index.moralis.io/api/v2.2/${normalized}/balance?chain=${chain}`;
      const nativeData = await moralisFetch<MoralisNativeResponse>(nativeUrl, apiKey);
      const nativeBal = parseTokenBalance(nativeData?.balance, 18);
      if (nativeBal > 0) {
        const existingNative = tokens.find(
          (x) => x.chain === chain && !x.contractAddress
        );
        if (!existingNative) {
          const chainSymbol =
            chain === "polygon"
              ? "MATIC"
              : chain === "bsc"
                ? "BNB"
                : chain === "avalanche"
                  ? "AVAX"
                  : "ETH";
          tokens.push({
            symbol: chainSymbol,
            name: `${chainSymbol} (native)`,
            chain,
            balance: nativeBal,
            usdValue: 0,
            cadValue: 0,
          });
        }
      }
    }

    const cadRate = await usdToCad(1);
    for (const t of tokens) {
      if (t.usdValue <= 0 && t.balance > 0) {
        /* native tokens without price — skip from total unless priced elsewhere */
      }
      t.cadValue = t.usdValue * cadRate;
    }

    totalUsd = tokens.reduce((s, t) => s + t.usdValue, 0);
    const totalCad = totalUsd * cadRate;

    tokens.sort((a, b) => b.usdValue - a.usdValue);

    return {
      address: normalized,
      totalUsd,
      totalCad,
      tokens,
      chains,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const key = this.apiKey();
      const res = await fetch("https://deep-index.moralis.io/api/v2.2/info/endpoint_weights", {
        headers: { "X-API-Key": key },
      });
      if (res.ok) return { ok: true };
      return { ok: false, error: `Moralis rejected key (${res.status})` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
