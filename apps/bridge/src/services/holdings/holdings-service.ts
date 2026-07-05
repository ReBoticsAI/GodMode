import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../../db.js";
import type { CryptoPortfolio } from "./crypto-provider.js";
import type { PayPalBalanceResult } from "./paypal-service.js";

export type HoldingCategory = "bank" | "wallet" | "exchange" | "paypal" | "manual";
export type ConnectionStatus = "active" | "error" | "pending";

export interface HoldingConnection {
  id: string;
  category: HoldingCategory;
  provider: string;
  label: string;
  currency: string;
  reference: string | null;
  status: ConnectionStatus;
  externalId: string | null;
  balance: number;
  balanceCad: number;
  breakdown: unknown | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface CreateConnectionInput {
  category: HoldingCategory;
  provider: string;
  label: string;
  currency: string;
  reference?: string;
  externalId?: string;
  balance: number;
  balanceCad: number;
  breakdown?: unknown;
  status?: ConnectionStatus;
}

interface ConnectionRow {
  id: string;
  category: string;
  provider: string;
  label: string;
  currency: string;
  reference: string | null;
  status: string;
  external_id: string | null;
  balance: number;
  balance_cad: number;
  breakdown_json: string | null;
  last_synced_at: string | null;
  created_at: string;
}

function rowToConnection(row: ConnectionRow): HoldingConnection {
  let breakdown: unknown = null;
  if (row.breakdown_json) {
    try {
      breakdown = JSON.parse(row.breakdown_json);
    } catch {
      breakdown = null;
    }
  }
  return {
    id: row.id,
    category: row.category as HoldingCategory,
    provider: row.provider,
    label: row.label,
    currency: row.currency,
    reference: row.reference,
    status: row.status as ConnectionStatus,
    externalId: row.external_id,
    balance: row.balance,
    balanceCad: row.balance_cad,
    breakdown,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

export class HoldingsService {
  constructor(private db: AppDatabase) {}

  list(): HoldingConnection[] {
    const rows = this.db
      .prepare(
        `SELECT id, category, provider, label, currency, reference, status,
                external_id, balance, balance_cad, breakdown_json,
                last_synced_at, created_at
           FROM holdings_connections
          ORDER BY created_at DESC`
      )
      .all() as ConnectionRow[];
    return rows.map(rowToConnection);
  }

  get(id: string): HoldingConnection | null {
    const row = this.db
      .prepare(
        `SELECT id, category, provider, label, currency, reference, status,
                external_id, balance, balance_cad, breakdown_json,
                last_synced_at, created_at
           FROM holdings_connections WHERE id = ?`
      )
      .get(id) as ConnectionRow | undefined;
    return row ? rowToConnection(row) : null;
  }

  findByReference(category: string, provider: string, reference: string): HoldingConnection | null {
    const row = this.db
      .prepare(
        `SELECT id, category, provider, label, currency, reference, status,
                external_id, balance, balance_cad, breakdown_json,
                last_synced_at, created_at
           FROM holdings_connections
          WHERE category = ? AND provider = ? AND reference = ?`
      )
      .get(category, provider, reference) as ConnectionRow | undefined;
    return row ? rowToConnection(row) : null;
  }

  create(input: CreateConnectionInput): HoldingConnection {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO holdings_connections
           (id, category, provider, label, currency, reference, status,
            external_id, balance, balance_cad, breakdown_json, last_synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.category,
        input.provider,
        input.label,
        input.currency,
        input.reference ?? null,
        input.status ?? "active",
        input.externalId ?? null,
        input.balance,
        input.balanceCad,
        input.breakdown ? JSON.stringify(input.breakdown) : null,
        now,
        now
      );
    this.recordSnapshot(id, input.balance, input.currency, input.balanceCad, input.breakdown);
    return this.get(id)!;
  }

  updateBalance(
    id: string,
    balance: number,
    currency: string,
    balanceCad: number,
    breakdown?: unknown,
    status: ConnectionStatus = "active"
  ): HoldingConnection | null {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE holdings_connections
            SET balance = ?, currency = ?, balance_cad = ?,
                breakdown_json = ?, last_synced_at = ?, status = ?
          WHERE id = ?`
      )
      .run(
        balance,
        currency,
        balanceCad,
        breakdown ? JSON.stringify(breakdown) : null,
        now,
        status,
        id
      );
    this.recordSnapshot(id, balance, currency, balanceCad, breakdown);
    return this.get(id);
  }

  delete(id: string): boolean {
    const r = this.db
      .prepare(`DELETE FROM holdings_connections WHERE id = ?`)
      .run(id);
    return r.changes > 0;
  }

  netWorthCad(): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(balance_cad), 0) AS total FROM holdings_connections`)
      .get() as { total: number };
    return row.total ?? 0;
  }

  recordSnapshot(
    connectionId: string,
    balance: number,
    currency: string,
    balanceCad: number,
    raw?: unknown
  ): void {
    this.db
      .prepare(
        `INSERT INTO holdings_balance_snapshots
           (connection_id, balance, currency, balance_cad, raw_json, as_of)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        connectionId,
        balance,
        currency,
        balanceCad,
        raw ? JSON.stringify(raw) : null
      );
  }

  upsertCryptoWallet(
    provider: string,
    label: string,
    portfolio: CryptoPortfolio
  ): HoldingConnection {
    const existing = this.findByReference("wallet", provider, portfolio.address);
    if (existing) {
      return this.updateBalance(
        existing.id,
        portfolio.totalUsd,
        "USD",
        portfolio.totalCad,
        { tokens: portfolio.tokens }
      )!;
    }
    return this.create({
      category: "wallet",
      provider,
      label,
      currency: "USD",
      reference: portfolio.address,
      externalId: portfolio.address,
      balance: portfolio.totalUsd,
      balanceCad: portfolio.totalCad,
      breakdown: { tokens: portfolio.tokens },
    });
  }

  upsertPayPal(label: string, balance: PayPalBalanceResult): HoldingConnection {
    const ref = "business";
    const existing = this.findByReference("paypal", "paypal", ref);
    if (existing) {
      return this.updateBalance(
        existing.id,
        balance.total,
        balance.currency,
        balance.totalCad,
        balance.raw
      )!;
    }
    return this.create({
      category: "paypal",
      provider: "paypal",
      label,
      currency: balance.currency,
      reference: ref,
      balance: balance.total,
      balanceCad: balance.totalCad,
      breakdown: balance.raw,
    });
  }
}
