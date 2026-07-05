import type Database from "better-sqlite3";

export type MigrationFn = (db: Database.Database) => void;

const migrations: Array<{ version: number; name: string; up: MigrationFn }> = [];

export function registerMigration(
  version: number,
  name: string,
  up: MigrationFn
): void {
  // Registration is idempotent: the register* wrappers run once per
  // migrateTenantDb() call, so without this guard a second tenant migration
  // in the same process would duplicate entries and replay already-applied
  // versions (UNIQUE constraint on schema_version.version).
  if (migrations.some((m) => m.version === version)) return;
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
  ensureSchemaVersionTable(db);
  const row = db
    .prepare(`SELECT MAX(version) AS v FROM schema_version`)
    .get() as { v: number | null };
  return row?.v ?? 0;
}

export function runPendingMigrations(db: Database.Database): void {
  ensureSchemaVersionTable(db);
  const current = getCurrentSchemaVersion(db);
  const insert = db.prepare(
    `INSERT INTO schema_version (version, name) VALUES (?, ?)`
  );

  for (const m of migrations) {
    if (m.version <= current) continue;
    try {
      m.up(db);
      insert.run(m.version, m.name);
      console.log(`[db] migration ${m.version}: ${m.name}`);
    } catch (err) {
      console.error(`[db] migration ${m.version} (${m.name}) failed`, err);
      throw err;
    }
  }
}

/** Idempotent ADD COLUMN helper used by legacy inline migrations. */
export function addCol(
  db: Database.Database,
  table: string,
  col: string,
  def: string
): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  } catch {
    /* column exists */
  }
}
