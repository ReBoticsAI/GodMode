import type { ListRecordsResult, RecordRow } from "@godmode/kernel";
import type { OperationContext, RecordQuery } from "../../kernel/adapter-registry.js";
import type { AppDatabase } from "../../db.js";

/** ObjectTypes Phase 1 routes through the Data Router for reads (#778). */
export const DATA_ROUTER_CHAT_READ_TYPES = ["ChatSession", "ChatMessage"] as const;

export type DataRouterChatReadType = (typeof DATA_ROUTER_CHAT_READ_TYPES)[number];

export type DataRouterReadOp = "get" | "list";

export type DataRouterIntent = {
  objectType: string;
  op: DataRouterReadOp;
  /** Tenant workspace DB; opened only for the query step, never returned. */
  db: AppDatabase;
  ctx: OperationContext;
  query?: RecordQuery;
  id?: string;
};

/** JSON-only digest of a single Record (no SQLite handle). */
export type DataRouterDigest = RecordRow;

export type DataRouterListDigest = ListRecordsResult;

export function isDataRouterChatReadType(
  objectType: string
): objectType is DataRouterChatReadType {
  return (DATA_ROUTER_CHAT_READ_TYPES as readonly string[]).includes(objectType);
}

/**
 * Phase 1 flag (#778). Default on; set `DATA_ROUTER_CHAT_READS=0|false|off` to
 * use the legacy direct adapter path (local escape hatch).
 */
export function isDataRouterChatReadsEnabled(): boolean {
  const raw = (process.env.DATA_ROUTER_CHAT_READS ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") {
    return true;
  }
  return true;
}
