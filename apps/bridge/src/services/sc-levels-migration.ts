import type Database from "better-sqlite3";
import {
  addCol,
  columnExists,
  registerMigration,
  tableExists,
} from "./db-migrations.js";

const MIGRATION_VERSION = 5;

export function registerScLevelsMigration(): void {
  registerMigration(MIGRATION_VERSION, "sc_levels_source_key_v1", migrateScLevelsSchema);
}

/**
 * Upgrades the legacy (symbol, label) sc_levels key without discarding rows.
 * The legacy label remains the stable source key until the owning feed rewrites it.
 */
export function migrateScLevelsSchema(db: Database.Database): void {
  if (!tableExists(db, "sc_levels")) return;

  if (!columnExists(db, "sc_levels", "source_key")) {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS sc_levels__upgrade;
        CREATE TABLE sc_levels__upgrade (
          symbol TEXT NOT NULL,
          source_key TEXT NOT NULL,
          label TEXT NOT NULL,
          price REAL NOT NULL,
          kind TEXT,
          chart_number INTEGER,
          study_id INTEGER,
          subgraph_index INTEGER,
          color TEXT,
          line_width INTEGER,
          ts TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (symbol, source_key)
        );
        INSERT INTO sc_levels__upgrade (
          symbol, source_key, label, price, kind, chart_number, study_id,
          subgraph_index, color, line_width, ts, updated_at
        )
        SELECT symbol, label, label, price, kind, chart_number, study_id,
               subgraph_index, NULL, NULL, ts, updated_at
        FROM sc_levels;
        DROP TABLE sc_levels;
        ALTER TABLE sc_levels__upgrade RENAME TO sc_levels;
        CREATE INDEX sc_levels_by_symbol ON sc_levels(symbol, price DESC);
      `);
    })();
    return;
  }

  addCol(db, "sc_levels", "color", "TEXT");
  addCol(db, "sc_levels", "line_width", "INTEGER");
  db.exec(
    `CREATE INDEX IF NOT EXISTS sc_levels_by_symbol ON sc_levels(symbol, price DESC)`
  );
}
