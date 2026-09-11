import type { ListRecordsResult, RecordRow } from "@godmode/kernel";
import { readChatRecords, type ChatRecordQueryFns } from "./chat-read-router.js";
import {
  isDataRouterChatReadType,
  isDataRouterChatReadsEnabled,
  type DataRouterDigest,
  type DataRouterIntent,
  type DataRouterListDigest,
} from "./types.js";

export {
  DATA_ROUTER_CHAT_READ_TYPES,
  isDataRouterChatReadType,
  isDataRouterChatReadsEnabled,
  type DataRouterChatReadType,
  type DataRouterDigest,
  type DataRouterIntent,
  type DataRouterListDigest,
  type DataRouterReadOp,
} from "./types.js";
export { readChatRecords, toDigestList, toDigestRecord } from "./chat-read-router.js";

/**
 * Phase 1 Data Router entry (#778). Returns digests for ChatSession/ChatMessage
 * when enabled; otherwise `null` so the caller uses the legacy path.
 */
export function dataRouterRead(
  intent: DataRouterIntent,
  queryFns: ChatRecordQueryFns
): DataRouterDigest | DataRouterListDigest | null {
  if (!isDataRouterChatReadsEnabled()) return null;
  if (!isDataRouterChatReadType(intent.objectType)) return null;
  return readChatRecords(intent, queryFns);
}

/** Type guard: list vs get digest. */
export function isDataRouterListDigest(
  value: DataRouterDigest | DataRouterListDigest
): value is DataRouterListDigest {
  return (
    value != null &&
    typeof value === "object" &&
    Array.isArray((value as ListRecordsResult).records)
  );
}

export function isDataRouterDigest(
  value: DataRouterDigest | DataRouterListDigest
): value is DataRouterDigest {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as RecordRow).id === "string" &&
    !Array.isArray((value as ListRecordsResult).records)
  );
}
