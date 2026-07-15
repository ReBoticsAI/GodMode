import type { AppDatabase } from "../../db.js";
import type { ObjectTypeDef, RecordData, RecordRow } from "@godmode/kernel";
import { getCoreDb } from "../../core-db.js";
import type {
  OperationContext,
  RecordAdapter,
  RecordQuery,
} from "../adapter-registry.js";

export interface SqlReadAdapterOptions {
  id: string;
  table: string;
  database?: "tenant" | "core";
  idColumn?: string;
  /** Restrict rows to the active tenant or user when the column exists. */
  scope?: "tenant" | "user" | "admin";
  scopeColumn?: string;
  defaultSort?: string;
}

function ident(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function sourceDb(
  tenantDb: AppDatabase,
  options: SqlReadAdapterOptions
): AppDatabase {
  return options.database === "core" ? getCoreDb() : tenantDb;
}

function scopeClause(
  options: SqlReadAdapterOptions,
  ctx: OperationContext,
  where: string[],
  values: unknown[]
): void {
  if (options.scope === "admin") {
    if (!ctx.isAdmin) {
      where.push("1=0");
    }
    return;
  }
  if (options.scope === "tenant") {
    if (!ctx.tenantId) {
      where.push("1=0");
      return;
    }
    where.push(`${ident(options.scopeColumn ?? "tenant_id")}=?`);
    values.push(ctx.tenantId);
  }
  if (options.scope === "user") {
    if (!ctx.userId) {
      where.push("1=0");
      return;
    }
    where.push(`${ident(options.scopeColumn ?? "user_id")}=?`);
    values.push(ctx.userId);
  }
}

function decode(def: ObjectTypeDef, row: Record<string, unknown>): RecordRow {
  const id = String(row.__record_id ?? row.id);
  const data: RecordData = { id };
  for (const field of def.fields) {
    if (field.name === "id" || field.secret || !(field.name in row)) continue;
    const raw = row[field.name];
    if (field.fieldType === "Check") data[field.name] = Boolean(raw);
    else if (field.fieldType === "JSON" && typeof raw === "string") {
      try {
        data[field.name] = JSON.parse(raw);
      } catch {
        data[field.name] = raw;
      }
    } else data[field.name] = raw;
  }
  return { id, objectType: def.name, data };
}

export function createSqlReadAdapter(
  options: SqlReadAdapterOptions
): RecordAdapter {
  const table = ident(options.table);
  const idColumn = options.idColumn ?? "id";
  const idSelect = `${ident(idColumn)} AS __record_id`;
  return {
    id: options.id,
    policy: {
      authorize(_operation, _def, ctx) {
        if (options.scope === "admin") return ctx.isAdmin === true;
        if (options.scope === "tenant") return Boolean(ctx.tenantId);
        if (options.scope === "user") return Boolean(ctx.userId);
        return true;
      },
    },
    list(tenantDb, def, query, ctx) {
      const db = sourceDb(tenantDb, options);
      const where: string[] = [];
      const values: unknown[] = [];
      scopeClause(options, ctx, where, values);
      const allowed = new Set(def.fields.map((field) => field.name));
      for (const [name, value] of Object.entries(query.filters ?? {})) {
        if (!allowed.has(name) || name === "id") continue;
        where.push(`${ident(name)}=?`);
        values.push(value);
      }
      const sort =
        query.sort && allowed.has(query.sort)
          ? query.sort
          : options.defaultSort && allowed.has(options.defaultSort)
            ? options.defaultSort
            : idColumn;
      const direction = query.direction === "asc" ? "ASC" : "DESC";
      const predicate = where.length ? ` WHERE ${where.join(" AND ")}` : "";
      const total = (
        db.prepare(`SELECT COUNT(*) AS c FROM ${table}${predicate}`).get(
          ...values
        ) as { c: number }
      ).c;
      const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const rows = db
        .prepare(
          `SELECT ${idSelect}, * FROM ${table}${predicate} ORDER BY ${ident(sort)} ${direction} LIMIT ? OFFSET ?`
        )
        .all(...values, limit, offset) as Record<string, unknown>[];
      return {
        objectType: def.name,
        records: rows.map((row) => decode(def, row)),
        total,
      };
    },
    get(tenantDb, def, id, ctx) {
      const db = sourceDb(tenantDb, options);
      const where = [`${ident(idColumn)}=?`];
      const values: unknown[] = [id];
      scopeClause(options, ctx, where, values);
      const row = db
        .prepare(
          `SELECT ${idSelect}, * FROM ${table} WHERE ${where.join(" AND ")} LIMIT 1`
        )
        .get(...values) as Record<string, unknown> | undefined;
      return row ? decode(def, row) : null;
    },
  };
}
