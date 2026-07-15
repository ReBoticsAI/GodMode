import type Database from "better-sqlite3";

export type MigrationFn = (db: Database.Database) => void;

export interface Migration {
  version: number;
  name: string;
  up: MigrationFn;
  foreignKeysOff?: boolean;
}

const migrations: Migration[] = [];

export function registerMigration(
  version: number,
  name: string,
  up: MigrationFn
): void {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error(`Migration version must be a positive integer: ${version}`);
  }
  const existing = migrations.find((m) => m.version === version);
  if (existing) {
    if (existing.name !== name || existing.up !== up) {
      throw new Error(
        `Migration version ${version} is already registered as "${existing.name}"`
      );
    }
    return;
  }
  migrations.push({ version, name, up });
  migrations.sort((a, b) => a.version - b.version);
}

export function ensureSchemaVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getCurrentSchemaVersion(db: Database.Database): number {
  const applied = getAppliedSchemaVersions(db);
  let contiguousVersion = 0;
  while (applied.has(contiguousVersion + 1)) contiguousVersion += 1;
  return contiguousVersion;
}

export function getAppliedSchemaVersions(db: Database.Database): Set<number> {
  ensureSchemaVersionTable(db);
  const rows = db.prepare(`SELECT version FROM schema_version`).all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((row) => row.version));
}

export function runMigrations(
  db: Database.Database,
  availableMigrations: readonly Migration[]
): void {
  ensureSchemaVersionTable(db);
  const applied = getAppliedSchemaVersions(db);
  const insert = db.prepare(
    `INSERT INTO schema_version (version, name) VALUES (?, ?)`
  );

  for (const m of [...availableMigrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    const restoreForeignKeys =
      m.foreignKeysOff && db.pragma("foreign_keys", { simple: true }) === 1;
    try {
      if (restoreForeignKeys) db.pragma("foreign_keys = OFF");
      db.transaction(() => {
        m.up(db);
        if (m.foreignKeysOff) {
          const violations = db.prepare("PRAGMA foreign_key_check").all();
          if (violations.length > 0) {
            throw new Error(
              `Migration ${m.version} introduced ${violations.length} foreign key violation(s)`
            );
          }
        }
        insert.run(m.version, m.name);
      })();
      applied.add(m.version);
      console.log(`[db] migration ${m.version}: ${m.name}`);
    } catch (err) {
      console.error(`[db] migration ${m.version} (${m.name}) failed`, err);
      throw err;
    } finally {
      if (restoreForeignKeys) db.pragma("foreign_keys = ON");
    }
  }
}

export function runPendingMigrations(db: Database.Database): void {
  runMigrations(db, migrations);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table)
  );
}

export function columnExists(
  db: Database.Database,
  table: string,
  column: string
): boolean {
  if (!tableExists(db, table)) return false;
  const rows = db
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

/** Idempotent ADD COLUMN helper with explicit existence checks. */
export function addCol(
  db: Database.Database,
  table: string,
  col: string,
  def: string
): void {
  if (!tableExists(db, table)) {
    throw new Error(`Cannot add column ${col}: table ${table} does not exist`);
  }
  if (columnExists(db, table, col)) return;
  db.exec(
    `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(col)} ${def}`
  );
}
