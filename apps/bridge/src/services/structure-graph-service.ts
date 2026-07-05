import type { AppDatabase } from "../db.js";
import type { StructureGraphLayout } from "@godmode/flow-core";
import { readStructure, type StructureTree } from "./structure.js";

const LAYOUT_KEY = "structure.graph_json";

export function readStructureGraphLayout(
  db: AppDatabase
): StructureGraphLayout | null {
  const row = db
    .prepare(`SELECT value FROM ai_settings WHERE key = ?`)
    .get(LAYOUT_KEY) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as StructureGraphLayout;
  } catch {
    return null;
  }
}

export function writeStructureGraphLayout(
  db: AppDatabase,
  layout: StructureGraphLayout
): void {
  db.prepare(
    `INSERT INTO ai_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(LAYOUT_KEY, JSON.stringify(layout));
}

/** Canonical structure record: tree spec + optional layout sidecar. */
export function readStructureGraphRecord(db: AppDatabase): {
  tree: StructureTree;
  layout: StructureGraphLayout | null;
} {
  return {
    tree: readStructure(db),
    layout: readStructureGraphLayout(db),
  };
}
