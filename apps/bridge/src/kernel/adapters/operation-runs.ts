import type { RecordAdapter, RecordQuery } from "../adapter-registry.js";
import { cancelOperationRun } from "../record-api.js";

function predicate(ctx: Parameters<NonNullable<RecordAdapter["list"]>>[3]): {
  sql: string;
  params: unknown[];
} {
  if (ctx.source === "system" || ctx.role === "intelligence") {
    return { sql: "1=1", params: [] };
  }
  if (!ctx.tenantId) return { sql: "0=1", params: [] };
  return { sql: "tenant_id=?", params: [ctx.tenantId] };
}

function row(def: Parameters<NonNullable<RecordAdapter["get"]>>[1], value: Record<string, unknown>) {
  return {
    objectType: def.name,
    id: String(value.id),
    data: value,
  };
}

function paging(query: RecordQuery): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(Number(query.limit) || 100, 1), 500),
    offset: Math.max(Number(query.offset) || 0, 0),
  };
}

export const operationRunAdapter: RecordAdapter = {
  id: "operation_run_service",
  policy: {
    authorize(_operation, _def, ctx, record) {
      if (!record || ctx.source === "system" || ctx.role === "intelligence") {
        return true;
      }
      return (
        !ctx.tenantId ||
        record.data.tenant_id == null ||
        record.data.tenant_id === ctx.tenantId
      );
    },
  },
  list(db, def, query, ctx) {
    const scope = predicate(ctx);
    const { limit, offset } = paging(query);
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM kernel_operation_runs WHERE ${scope.sql}`)
        .get(...scope.params) as { count: number }
    ).count;
    const values = db
      .prepare(
        `SELECT * FROM kernel_operation_runs
         WHERE ${scope.sql}
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...scope.params, limit, offset) as Record<string, unknown>[];
    return {
      objectType: def.name,
      records: values.map((value) => row(def, value)),
      total,
    };
  },
  get(db, def, id, ctx) {
    const scope = predicate(ctx);
    const value = db
      .prepare(
        `SELECT * FROM kernel_operation_runs WHERE id=? AND ${scope.sql}`
      )
      .get(id, ...scope.params) as Record<string, unknown> | undefined;
    return value ? row(def, value) : null;
  },
  actions: {
    cancel(db, _def, id, _input, ctx) {
      return { cancelled: cancelOperationRun(db, id, ctx) };
    },
  },
};
