import type { AppDatabase } from "../db.js";
import type { FieldDef, ObjectTypeDef, RecordData, RecordRow } from "@godmode/kernel";
import { defaultNativeTableName } from "@godmode/kernel";

function sqlType(field: FieldDef): string {
  switch (field.fieldType) {
    case "Int":
    case "Check":
      return "INTEGER";
    case "Float":
      return "REAL";
    default:
      return "TEXT";
  }
}

export function ensureNativeTable(db: AppDatabase, def: ObjectTypeDef): string {
  if (def.storage.kind !== "native") {
    throw new Error(`${def.name} is not a native ObjectType`);
  }
  const table =
    def.storage.tableName?.trim() || defaultNativeTableName(def.name);
  const cols = def.fields
    .filter((f) => f.fieldType !== "ReadOnly" && f.name !== "id")
    .map((f) => {
      if (["created_at", "updated_at"].includes(f.name)) {
        throw new Error(`Reserved native field: ${f.name}`);
      }
      const required = f.required ? " NOT NULL" : "";
      return `${quoteIdent(f.name)} ${sqlType(f)}${required}`;
    });
  cols.unshift(`id TEXT PRIMARY KEY`);
  cols.push(`_kernel_version INTEGER NOT NULL DEFAULT 1`);
  cols.push(`created_at TEXT NOT NULL DEFAULT (datetime('now'))`);
  cols.push(`updated_at TEXT NOT NULL DEFAULT (datetime('now'))`);
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${cols.join(",\n  ")}\n)`
  );
  const existing = new Set(
    (
      db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
        name: string;
      }>
    ).map((r) => r.name)
  );
  if (!existing.has("_kernel_version")) {
    db.exec(
      `ALTER TABLE ${quoteIdent(table)} ADD COLUMN _kernel_version INTEGER NOT NULL DEFAULT 1`
    );
    existing.add("_kernel_version");
  }
  for (const field of def.fields) {
    if (
      field.name === "id" ||
      field.fieldType === "ReadOnly" ||
      existing.has(field.name)
    ) {
      continue;
    }
    const defaultSql =
      field.default === undefined
        ? ""
        : ` DEFAULT ${sqliteLiteral(field.default, field)}`;
    // SQLite cannot add a required column without a usable default.
    const required = field.required && field.default !== undefined ? " NOT NULL" : "";
    db.exec(
      `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(field.name)} ${sqlType(field)}${required}${defaultSql}`
    );
  }
  return table;
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return `"${name.replaceAll('"', '""')}"`;
}

function sqliteLiteral(value: unknown, field: FieldDef): string {
  const encoded =
    field.fieldType === "JSON" && typeof value !== "string"
      ? JSON.stringify(value)
      : field.fieldType === "Check"
        ? value
          ? 1
          : 0
        : value;
  if (encoded === null) return "NULL";
  if (typeof encoded === "number") return String(encoded);
  return `'${String(encoded).replaceAll("'", "''")}'`;
}

function decodeValue(field: FieldDef, value: unknown): unknown {
  if (value == null) return value;
  if (field.fieldType === "Check") return Boolean(value);
  if (field.fieldType === "JSON" && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function rowToRecord(
  def: ObjectTypeDef,
  row: Record<string, unknown>
): RecordRow {
  const {
    id,
    created_at: _c,
    updated_at: _u,
    _kernel_version,
    ...rest
  } = row;
  const data: RecordData = { id: String(id) };
  for (const field of def.fields) {
    if (field.name === "id" || field.secret || !(field.name in rest)) continue;
    data[field.name] = decodeValue(field, rest[field.name]);
  }
  return {
    id: String(id),
    objectType: def.name,
    data,
    version: String(_kernel_version ?? 1),
  };
}

export function listNativeRecords(
  db: AppDatabase,
  def: ObjectTypeDef,
  opts?: {
    limit?: number;
    offset?: number;
    filters?: Record<string, unknown>;
    sort?: string;
    direction?: "asc" | "desc";
  }
): { records: RecordRow[]; total: number; table: string } {
  const table = ensureNativeTable(db, def);
  const limit = Math.min(Math.max(Number(opts?.limit) || 100, 1), 500);
  const offset = Math.max(Number(opts?.offset) || 0, 0);
  const fields = new Map(def.fields.map((field) => [field.name, field]));
  const where: string[] = [];
  const values: unknown[] = [];
  for (const [name, raw] of Object.entries(opts?.filters ?? {})) {
    const field = fields.get(name);
    if (!field || field.secret || field.fieldType === "ReadOnly") continue;
    let value = raw;
    if (field.fieldType === "JSON" && raw != null && typeof raw !== "string") {
      value = JSON.stringify(raw);
    } else if (field.fieldType === "Check") {
      value = raw ? 1 : 0;
    }
    where.push(`${quoteIdent(name)}=?`);
    values.push(value);
  }
  const predicate = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const sort =
    opts?.sort &&
    (["id", "created_at", "updated_at"].includes(opts.sort) ||
      (fields.has(opts.sort) && !fields.get(opts.sort)?.secret))
      ? opts.sort
      : "updated_at";
  const direction = opts?.direction === "asc" ? "ASC" : "DESC";
  const rows = db
    .prepare(
      `SELECT * FROM ${quoteIdent(table)}${predicate} ORDER BY ${quoteIdent(sort)} ${direction} LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset) as Record<string, unknown>[];
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}${predicate}`)
      .get(...values) as {
      c: number;
    }
  ).c;
  return {
    table,
    total,
    records: rows.map((r) => rowToRecord(def, r)),
  };
}

export function getNativeRecord(
  db: AppDatabase,
  def: ObjectTypeDef,
  id: string
): RecordRow | null {
  const table = ensureNativeTable(db, def);
  const row = db
    .prepare(`SELECT * FROM ${quoteIdent(table)} WHERE id=?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToRecord(def, row) : null;
}

export function createNativeRecord(
  db: AppDatabase,
  def: ObjectTypeDef,
  data: RecordData
): RecordRow {
  const table = ensureNativeTable(db, def);
  const id =
    data.id != null && String(data.id).trim()
      ? String(data.id).trim()
      : crypto.randomUUID();
  const writable = def.fields.filter(
    (f) => f.fieldType !== "ReadOnly" && f.name !== "id"
  );
  const cols = ["id", ...writable.map((f) => f.name)];
  const vals: unknown[] = [id];
  for (const f of writable) {
    let v = data[f.name];
    if (v === undefined) v = f.default ?? null;
    if (f.fieldType === "JSON" && v != null && typeof v !== "string") {
      v = JSON.stringify(v);
    }
    if (f.fieldType === "Check") v = v ? 1 : 0;
    vals.push(v ?? null);
  }
  const placeholders = cols.map(() => "?").join(", ");
  db.prepare(
    `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders})`
  ).run(...vals);
  const row = getNativeRecord(db, def, id);
  if (!row) throw new Error("failed to read created record");
  return row;
}

export function updateNativeRecord(
  db: AppDatabase,
  def: ObjectTypeDef,
  id: string,
  data: RecordData,
  expectedVersion?: string
): RecordRow {
  const table = ensureNativeTable(db, def);
  const existing = getNativeRecord(db, def, id);
  if (!existing) throw Object.assign(new Error("record not found"), { status: 404 });
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of def.fields) {
    if (f.name === "id" || f.fieldType === "ReadOnly") continue;
    if (!(f.name in data)) continue;
    let v = data[f.name];
    if (f.fieldType === "JSON" && v != null && typeof v !== "string") {
      v = JSON.stringify(v);
    }
    if (f.fieldType === "Check") v = v ? 1 : 0;
    sets.push(`${quoteIdent(f.name)}=?`);
    vals.push(v ?? null);
  }
  if (sets.length === 0) return existing;
  sets.push(`updated_at=datetime('now')`);
  vals.push(id);
  sets.push(`_kernel_version=_kernel_version+1`);
  const normalizedExpected = expectedVersion
    ?.replace(/^W\//, "")
    .replace(/^"|"$/g, "");
  if (normalizedExpected) vals.push(Number(normalizedExpected));
  const info = db.prepare(
    `UPDATE ${quoteIdent(table)} SET ${sets.join(", ")} WHERE id=?${
      normalizedExpected ? " AND _kernel_version=?" : ""
    }`
  ).run(...vals);
  if (info.changes === 0) {
    throw Object.assign(new Error("resource version conflict"), {
      status: 412,
      code: "KERNEL_VERSION_CONFLICT",
    });
  }
  const row = getNativeRecord(db, def, id);
  if (!row) throw new Error("failed to read updated record");
  return row;
}

export function deleteNativeRecord(
  db: AppDatabase,
  def: ObjectTypeDef,
  id: string,
  expectedVersion?: string
): void {
  const table = ensureNativeTable(db, def);
  const normalizedExpected = expectedVersion
    ?.replace(/^W\//, "")
    .replace(/^"|"$/g, "");
  const info = db
    .prepare(
      `DELETE FROM ${quoteIdent(table)} WHERE id=?${
        normalizedExpected ? " AND _kernel_version=?" : ""
      }`
    )
    .run(
      id,
      ...(normalizedExpected ? [Number(normalizedExpected)] : [])
    );
  if (info.changes === 0) {
    if (getNativeRecord(db, def, id)) {
      throw Object.assign(new Error("resource version conflict"), {
        status: 412,
        code: "KERNEL_VERSION_CONFLICT",
      });
    }
    throw Object.assign(new Error("record not found"), { status: 404 });
  }
}
