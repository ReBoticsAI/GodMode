import type Database from "better-sqlite3";

/** Production SQLite PRAGMAs applied on every connection open. */
export function configureDbPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -64000");
  db.pragma("mmap_size = 268435456");
  db.pragma("temp_store = MEMORY");
  db.pragma("wal_autocheckpoint = 1000");

  // Foreign keys are opt-in until data passes validation (see runForeignKeyCheck).
  if (process.env.SQLITE_FOREIGN_KEYS === "true") {
    db.pragma("foreign_keys = ON");
  }
}

/** Returns FK violations, if any. Safe to run with foreign_keys OFF. */
export function runForeignKeyCheck(db: Database.Database): string[] {
  try {
    const rows = db.prepare("PRAGMA foreign_key_check").all() as Array<{
      table: string;
      rowid: number;
      parent: string;
      fkid: number;
    }>;
    return rows.map(
      (r) => `${r.table} rowid=${r.rowid} -> ${r.parent} (fk ${r.fkid})`
    );
  } catch {
    return [];
  }
}

export function logDbConfig(db: Database.Database): void {
  const journal = db.pragma("journal_mode", { simple: true }) as string;
  const sync = db.pragma("synchronous", { simple: true }) as number;
  const busy = db.pragma("busy_timeout", { simple: true }) as number;
  const fks = db.pragma("foreign_keys", { simple: true }) as number;
  console.log(
    `[db] journal=${journal} synchronous=${sync} busy_timeout=${busy}ms foreign_keys=${fks ? "ON" : "OFF"}`
  );
}
