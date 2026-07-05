import { api } from "../api";

export type HoldingCategory = "bank" | "wallet" | "exchange" | "paypal" | "manual";

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

export interface HoldingConnection {
  id: string;
  category: HoldingCategory;
  provider: string;
  label: string;
  currency: string;
  reference: string | null;
  status: "active" | "error" | "pending";
  externalId: string | null;
  balance: number;
  balanceCad: number;
  breakdown: { tokens?: TokenBreakdown[] } | unknown | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface HoldingsConfig {
  moralis: { configured: boolean; masked?: string };
  paypal: { configured: boolean; env?: string; clientIdMasked?: string };
  chains: string[];
}

export interface HoldingsListResponse {
  connections: HoldingConnection[];
  netWorthCad: number;
}

export interface CryptoPortfolio {
  address: string;
  totalUsd: number;
  totalCad: number;
  tokens: TokenBreakdown[];
  chains: string[];
}

export function fetchHoldingsConfig(): Promise<HoldingsConfig> {
  return api<HoldingsConfig>("/financial/config");
}

export function fetchHoldings(): Promise<HoldingsListResponse> {
  return api<HoldingsListResponse>("/financial/connections");
}

export function saveMoralisConfig(apiKey: string): Promise<{ ok: boolean }> {
  return api("/financial/config/moralis", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export function savePayPalConfig(body: {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
}): Promise<{ ok: boolean; env: string }> {
  return api("/financial/config/paypal", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createManualConnection(body: {
  category: HoldingCategory;
  provider: string;
  label: string;
  balance: number;
  currency: string;
  reference?: string;
}): Promise<HoldingConnection> {
  return api("/financial/connections", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteConnection(id: string): Promise<{ ok: boolean; netWorthCad: number }> {
  return api(`/financial/connections/${id}`, { method: "DELETE" });
}

export function refreshConnection(id: string): Promise<HoldingConnection> {
  return api(`/financial/connections/${id}/refresh`, { method: "POST" });
}

export function previewCryptoBalance(
  address: string,
  chains?: string[]
): Promise<CryptoPortfolio> {
  return api("/financial/crypto/balance", {
    method: "POST",
    body: JSON.stringify({ address, chains }),
  });
}

export function connectCryptoWallet(body: {
  address: string;
  provider: string;
  label?: string;
  chains?: string[];
}): Promise<{ connection: HoldingConnection; portfolio: CryptoPortfolio }> {
  return api("/financial/crypto/connect", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function connectPayPal(label?: string): Promise<{
  connection: HoldingConnection;
  balance: { total: number; currency: string; totalCad: number };
}> {
  return api("/financial/paypal/connect", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export async function requestMetaMaskAddress(): Promise<string> {
  if (!window.ethereum) {
    throw new Error(
      "MetaMask not detected. Install the MetaMask browser extension and refresh."
    );
  }
  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("No account returned from MetaMask");
  return address;
}
