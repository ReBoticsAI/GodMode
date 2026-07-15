import type { BuiltinSpec } from "./shared.js";
import { PLATFORM_ACTION_METADATA } from "../adapters/platform-actions.js";

export const FINANCE_SPECS: BuiltinSpec[] = [
  { name: "FinanceConnection", label: "Finance Connection", module: "bank", id: "finance_connection_service", table: "holdings_connections", defaultSort: "created_at", writable: ["category", "provider", "label", "currency", "reference", "external_id", "balance", "balance_cad", "breakdown_json", "status"], required: ["category", "provider", "label", "currency"], operations: ["list", "get", "create", "delete"], actions: PLATFORM_ACTION_METADATA.FinanceConnection, fields: ["id", "category", "provider", "label", "currency", "reference", "external_id", ["balance", "Float"], ["balance_cad", "Float"], ["breakdown_json", "JSON"], "status", "last_synced_at", "created_at"] },
  { name: "BalanceSnapshot", label: "Balance Snapshot", module: "bank", id: "balance_snapshot_read", table: "holdings_balance_snapshots", defaultSort: "as_of", fields: ["id", "connection_id", ["balance", "Float"], "currency", ["balance_cad", "Float"], ["raw_json", "JSON"], "as_of"] },
  { name: "BankLedgerEntry", label: "Bank Ledger Entry", module: "bank", id: "bank_ledger_read", table: "bank_ledger_entries", defaultSort: "recorded_at", fields: ["id", "category", "label", ["amount", "Float"], "currency", "source", "recorded_at"] },
];
