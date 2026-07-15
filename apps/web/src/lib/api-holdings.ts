import { api } from "../api";
import {
  createRecordApi,
  deleteRecordApi,
  runRecordActionApi,
  waitForOperationRun,
  type RecordRowClient,
} from "./object-types-api";

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

function holdingDto(row: RecordRowClient): HoldingConnection {
  return {
    id: row.id,
    category: row.data.category as HoldingCategory,
    provider: String(row.data.provider ?? ""),
    label: String(row.data.label ?? ""),
    currency: String(row.data.currency ?? "CAD"),
    reference: (row.data.reference as string | null) ?? null,
    status: row.data.status as HoldingConnection["status"],
    externalId: (row.data.external_id as string | null) ?? null,
    balance: Number(row.data.balance ?? 0),
    balanceCad: Number(row.data.balance_cad ?? 0),
    breakdown: row.data.breakdown_json ?? null,
    lastSyncedAt: (row.data.last_synced_at as string | null) ?? null,
    createdAt: String(row.data.created_at ?? ""),
  };
}

async function financeAction<T>(
  action: string,
  input: Record<string, unknown>,
  id?: string
): Promise<T> {
  const result = await runRecordActionApi("FinanceConnection", action, input, {
    id,
    confirmed: true,
    idempotencyKey: crypto.randomUUID(),
  });
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    result.status === "accepted" &&
    "operationRunId" in result &&
    typeof result.operationRunId === "string"
  ) {
    const run = await waitForOperationRun(result.operationRunId);
    if (run.status === "failed") throw new Error(run.errorMessage ?? "Finance action failed");
    return run.result as T;
  }
  return result as T;
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
  return financeAction("configure_moralis", { api_key: apiKey });
}

export function savePayPalConfig(body: {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
}): Promise<{ ok: boolean; env: string }> {
  return financeAction("configure_paypal", {
    client_id: body.clientId,
    client_secret: body.clientSecret,
    env: body.env,
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
  return createRecordApi("FinanceConnection", {
    category: body.category,
    provider: body.provider,
    label: body.label,
    balance: body.balance,
    balance_cad: body.balance,
    currency: body.currency,
    reference: body.reference,
    status: "active",
  }).then(holdingDto);
}

export function deleteConnection(id: string): Promise<{ ok: boolean; netWorthCad: number }> {
  return deleteRecordApi("FinanceConnection", id)
    .then(fetchHoldings)
    .then((holdings) => ({ ok: true, netWorthCad: holdings.netWorthCad }));
}

export function refreshConnection(id: string): Promise<HoldingConnection> {
  return financeAction<RecordRowClient>("refresh_external", {}, id).then(holdingDto);
}

export function previewCryptoBalance(
  address: string,
  chains?: string[]
): Promise<CryptoPortfolio> {
  return financeAction("preview_crypto", { address, chains });
}

export function connectCryptoWallet(body: {
  address: string;
  provider: string;
  label?: string;
  chains?: string[];
}): Promise<{ connection: HoldingConnection; portfolio: CryptoPortfolio }> {
  return financeAction<RecordRowClient>("connect_external", {
    provider: "crypto",
    address: body.address,
    wallet_provider: body.provider,
    label: body.label,
    chains: body.chains,
  }).then((row) => {
    const connection = holdingDto(row);
    const tokens =
      connection.breakdown &&
      typeof connection.breakdown === "object" &&
      "tokens" in connection.breakdown &&
      Array.isArray(connection.breakdown.tokens)
        ? (connection.breakdown.tokens as TokenBreakdown[])
        : [];
    return {
      connection,
      portfolio: {
        address: body.address,
        totalUsd: connection.balance,
        totalCad: connection.balanceCad,
        tokens,
        chains: body.chains ?? [],
      },
    };
  });
}

export function connectPayPal(label?: string): Promise<{
  connection: HoldingConnection;
  balance: { total: number; currency: string; totalCad: number };
}> {
  return financeAction<RecordRowClient>("connect_external", {
    provider: "paypal",
    label,
  }).then((row) => {
    const connection = holdingDto(row);
    return {
      connection,
      balance: {
        total: connection.balance,
        currency: connection.currency,
        totalCad: connection.balanceCad,
      },
    };
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
