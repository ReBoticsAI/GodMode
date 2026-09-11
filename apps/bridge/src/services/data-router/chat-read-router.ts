import type { ListRecordsResult, RecordRow } from "@godmode/kernel";
import type { AppDatabase } from "../../db.js";
import type { OperationContext, RecordQuery } from "../../kernel/adapter-registry.js";
import {
  isDataRouterChatReadType,
  type DataRouterDigest,
  type DataRouterIntent,
  type DataRouterListDigest,
} from "./types.js";

export type ChatRecordQueryFns = {
  listRecordsDirect: (
    db: AppDatabase,
    objectType: string,
    opts: RecordQuery,
    ctx: OperationContext
  ) => ListRecordsResult;
  getRecordDirect: (
    db: AppDatabase,
    objectType: string,
    id: string,
    ctx: OperationContext
  ) => RecordRow;
};

/** Ensure digests are plain JSON (no DB methods / prototypes on the wire). */
export function toDigestRecord(row: RecordRow): DataRouterDigest {
  return JSON.parse(JSON.stringify(row)) as DataRouterDigest;
}

export function toDigestList(result: ListRecordsResult): DataRouterListDigest {
  return JSON.parse(JSON.stringify(result)) as DataRouterListDigest;
}

/**
 * Query step (SoR via kernel direct path) + report step (JSON digest).
 * Callers must not receive `intent.db`.
 */
export function readChatRecords(
  intent: DataRouterIntent,
  queryFns: ChatRecordQueryFns
): DataRouterDigest | DataRouterListDigest {
  if (!isDataRouterChatReadType(intent.objectType)) {
    throw new Error(`Data Router chat path does not handle ${intent.objectType}`);
  }

  if (intent.op === "list") {
    const raw = queryFns.listRecordsDirect(
      intent.db,
      intent.objectType,
      intent.query ?? {},
      intent.ctx
    );
    return toDigestList(raw);
  }

  const id = intent.id?.trim();
  if (!id) {
    throw new Error("Data Router get requires id");
  }
  const raw = queryFns.getRecordDirect(
    intent.db,
    intent.objectType,
    id,
    intent.ctx
  );
  return toDigestRecord(raw);
}
