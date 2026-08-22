import type {
  ListRecordsResult,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import type {
  GodModePluginApi,
  PluginRecordAdapter,
  PluginRecordContext,
  PluginRecordQuery,
} from "@godmode/plugin-api";

/** Minimal better-sqlite3 surface (TenantDb is opaque). */
export type PluginSqliteDb = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes?: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
};

export const DOMAIN_ITEMS_TABLE = "domain_items";

type DomainItemRow = {
  id: string;
  title: string;
  body: string;
  updated_at: string;
};

function asSqlite(db: unknown): PluginSqliteDb {
  return db as PluginSqliteDb;
}

function rowToRecord(objectType: string, row: DomainItemRow): RecordRow {
  return {
    id: row.id,
    objectType,
    version: row.updated_at,
    data: {
      id: row.id,
      title: row.title,
      body: row.body,
      updated_at: row.updated_at,
    },
  };
}

/** Explicit CREATE TABLE for domain scaffold items (no native materializer). */
export function ensureDomainItemsTable(db: unknown): void {
  asSqlite(db).exec(`CREATE TABLE IF NOT EXISTS ${DOMAIN_ITEMS_TABLE} (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`);
}

export function createDomainItemsAdapter(opts: {
  objectTypeName: string;
  openDb: (tenantId: string) => unknown;
}): PluginRecordAdapter {
  const { objectTypeName, openDb } = opts;

  const open = (ctx: PluginRecordContext) => {
    if (!ctx.tenantId) {
      throw new Error("tenantId required for domain SQLite ObjectType");
    }
    return asSqlite(openDb(ctx.tenantId));
  };

  return {
    list(query: PluginRecordQuery, ctx): ListRecordsResult {
      const db = open(ctx);
      const limit =
        query.limit != null && query.limit > 0 ? Math.min(query.limit, 500) : 50;
      const offset = Math.max(Number(query.offset) || 0, 0);
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM ${DOMAIN_ITEMS_TABLE}`)
        .get() as { c: number };
      const rows = db
        .prepare(
          `SELECT id, title, body, updated_at FROM ${DOMAIN_ITEMS_TABLE}
           ORDER BY updated_at DESC LIMIT ? OFFSET ?`
        )
        .all(limit, offset) as DomainItemRow[];
      return {
        objectType: objectTypeName,
        records: rows.map((row) => rowToRecord(objectTypeName, row)),
        total: Number(totalRow?.c ?? 0),
      };
    },
    get(id, ctx): RecordRow | null {
      const db = open(ctx);
      const row = db
        .prepare(
          `SELECT id, title, body, updated_at FROM ${DOMAIN_ITEMS_TABLE} WHERE id = ?`
        )
        .get(id) as DomainItemRow | undefined;
      return row ? rowToRecord(objectTypeName, row) : null;
    },
    create(data: RecordData, ctx): RecordRow {
      const db = open(ctx);
      const id =
        typeof data.id === "string" && data.id.trim()
          ? data.id.trim()
          : crypto.randomUUID();
      const title =
        typeof data.title === "string" && data.title.trim()
          ? data.title.trim()
          : "Untitled";
      const body = typeof data.body === "string" ? data.body : "";
      db.prepare(
        `INSERT INTO ${DOMAIN_ITEMS_TABLE} (id, title, body, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).run(id, title, body);
      const row = db
        .prepare(
          `SELECT id, title, body, updated_at FROM ${DOMAIN_ITEMS_TABLE} WHERE id = ?`
        )
        .get(id) as DomainItemRow;
      return rowToRecord(objectTypeName, row);
    },
    update(id, data: RecordData, ctx): RecordRow {
      const db = open(ctx);
      const existing = db
        .prepare(
          `SELECT id, title, body, updated_at FROM ${DOMAIN_ITEMS_TABLE} WHERE id = ?`
        )
        .get(id) as DomainItemRow | undefined;
      if (!existing) {
        throw new Error(`${objectTypeName} ${id} not found`);
      }
      const title =
        typeof data.title === "string" && data.title.trim()
          ? data.title.trim()
          : existing.title;
      const body = typeof data.body === "string" ? data.body : existing.body;
      db.prepare(
        `UPDATE ${DOMAIN_ITEMS_TABLE}
         SET title = ?, body = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(title, body, id);
      const row = db
        .prepare(
          `SELECT id, title, body, updated_at FROM ${DOMAIN_ITEMS_TABLE} WHERE id = ?`
        )
        .get(id) as DomainItemRow;
      return rowToRecord(objectTypeName, row);
    },
    delete(id, ctx): void {
      const db = open(ctx);
      const result = db
        .prepare(`DELETE FROM ${DOMAIN_ITEMS_TABLE} WHERE id = ?`)
        .run(id);
      if (!result.changes) {
        throw new Error(`${objectTypeName} ${id} not found`);
      }
    },
  };
}

export function domainItemObjectTypeDef(opts: {
  name: string;
  label: string;
  labelPlural?: string;
  description?: string;
  module?: string;
}): ObjectTypeDef {
  return {
    name: opts.name,
    label: opts.label,
    labelPlural: opts.labelPlural ?? `${opts.label}s`,
    description:
      opts.description ??
      `${opts.label} Records stored in plugin SQLite (openPluginDb).`,
    module: opts.module,
    // Runtime register overwrites adapterId; placeholder satisfies validation.
    storage: { kind: "adapter", adapterId: "plugin-sqlite-domain-items" },
    operations: ["list", "get", "create", "update", "delete"],
    fields: [
      { name: "id", label: "Id", fieldType: "Data", required: true },
      {
        name: "title",
        label: "Title",
        fieldType: "Data",
        required: true,
        inList: true,
        inForm: true,
      },
      {
        name: "body",
        label: "Body",
        fieldType: "Text",
        inForm: true,
      },
      {
        name: "updated_at",
        label: "Updated",
        fieldType: "ReadOnly",
        inList: true,
      },
    ],
  };
}

/**
 * Register a domain ObjectType whose Records live only in openPluginDb
 * (`domain_items` table). Call ensureDomainItemsTable from tenant:install.
 */
export function registerDomainSqliteObjectType(
  api: GodModePluginApi,
  opts: {
    pluginId: string;
    objectTypeName: string;
    label: string;
    labelPlural?: string;
    description?: string;
    module?: string;
  }
): void {
  const def = domainItemObjectTypeDef({
    name: opts.objectTypeName,
    label: opts.label,
    labelPlural: opts.labelPlural,
    description: opts.description,
    module: opts.module ?? opts.pluginId,
  });
  const adapter = createDomainItemsAdapter({
    objectTypeName: opts.objectTypeName,
    openDb: (tenantId) => api.host.openPluginDb(opts.pluginId, tenantId),
  });
  api.objectTypes.register(def, adapter);
}
