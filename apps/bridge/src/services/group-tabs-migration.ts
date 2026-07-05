import type Database from "better-sqlite3";
import { addCol } from "./db-migrations.js";
import { registerMigration } from "./db-migrations.js";
import { GROUP_TAB_DEFAULTS, tabsJsonForKind } from "./group-tab-definitions.js";

const MIGRATION_VERSION = 4;

function backfillGroupTabs(db: Database.Database): void {
  const update = db.prepare(
    `UPDATE structure_nodes SET tabs_json = ?, updated_at = datetime('now')
     WHERE kind = ? AND (tabs_json IS NULL OR tabs_json = '')`
  );
  for (const kind of Object.keys(GROUP_TAB_DEFAULTS)) {
    const json = tabsJsonForKind(kind);
    if (json) update.run(json, kind);
  }
}

function migrateGroupTabs(db: Database.Database): void {
  addCol(db, "structure_nodes", "tabs_json", "TEXT");
  backfillGroupTabs(db);
}

export function registerGroupTabsMigration(): void {
  registerMigration(MIGRATION_VERSION, "structure_group_tabs_v1", migrateGroupTabs);
}
