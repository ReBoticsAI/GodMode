import type Database from "better-sqlite3";
import { registerMigration } from "./db-migrations.js";

const MIGRATION_VERSION = 3;

/**
 * Historical one-shot regroup of trading structure nodes.
 * Domain plugins now own their structure seeds; this migration is a no-op
 * kept only for schema_version bookkeeping on existing tenants.
 */
export function registerStructureRegroupMigration(): void {
  registerMigration(MIGRATION_VERSION, "structure_regroup_v1", migrateRegroup);
}

function migrateRegroup(_db: Database.Database): void {
  // no-op — trading structure is installed by plugins
}
