import type Database from "better-sqlite3";
import { registerMigration } from "./db-migrations.js";

const MIGRATION_VERSION = 2;

export function registerStructureNodesMigration(): void {
  registerMigration(MIGRATION_VERSION, "structure_nodes_flatten_v1", migrateStructureNodes);
}

/**
 * Idempotent purge of legacy auto-provisioned structure agents
 * (`dept-*` / `div-*` / `page-*`) and any orphaned assignments.
 *
 * The flatten migration (v2) only deletes these inside its data-migration
 * transaction, which early-returns once `structure_nodes` is populated. On
 * tenants where `ensureBuiltInStructure` seeded nodes before v2 first ran,
 * that branch was skipped and the orphan agents survived. Auto-provisioning
 * is now permanently disabled, so any agent with these prefixes is legacy
 * and safe to remove. Cheap no-op once cleaned.
 */
export function cleanupProvisionedStructureAgents(db: Database.Database): void {
  const hasAgents = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ai_agents'`
    )
    .get();
  if (!hasAgents) return;

  const orphan = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM ai_agents
         WHERE id LIKE 'dept-%' OR id LIKE 'div-%' OR id LIKE 'page-%'`
      )
      .get() as { c: number }
  ).c;
  if (orphan === 0) return;

  const hasAssignments = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ai_agent_assignments'`
    )
    .get();

  db.transaction(() => {
    if (hasAssignments) {
      db.prepare(
        `DELETE FROM ai_agent_assignments
         WHERE agent_id LIKE 'dept-%'
            OR agent_id LIKE 'div-%'
            OR agent_id LIKE 'page-%'`
      ).run();
    }
    db.prepare(`DELETE FROM ai_agents WHERE id LIKE 'dept-%'`).run();
    db.prepare(`DELETE FROM ai_agents WHERE id LIKE 'div-%'`).run();
    db.prepare(`DELETE FROM ai_agents WHERE id LIKE 'page-%'`).run();
  })();

  console.log(
    `[structure] purged ${orphan} legacy provisioned agent(s) (dept-/div-/page-)`
  );
}

export function migrateStructureNodes(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS structure_nodes (
      id            TEXT PRIMARY KEY,
      parent_id     TEXT REFERENCES structure_nodes(id) ON DELETE CASCADE,
      label         TEXT NOT NULL,
      icon          TEXT NOT NULL,
      segment       TEXT NOT NULL DEFAULT '',
      kind          TEXT NOT NULL DEFAULT 'placeholder',
      right_sidebar TEXT,
      agent_id      TEXT,
      built_in      INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS structure_nodes_by_parent
      ON structure_nodes(parent_id, sort_order);
  `);

  const hasLegacy = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='departments'`
    )
    .get();
  if (!hasLegacy) return;

  const deptCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM departments`).get() as { c: number }
  ).c;
  if (deptCount === 0) return;

  const insertNode = db.prepare(`
    INSERT INTO structure_nodes
      (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  const nodeExists = db.prepare(`SELECT 1 FROM structure_nodes WHERE id=?`);
  const insertNodeIfMissing = (...values: Parameters<typeof insertNode.run>): void => {
    if (nodeExists.get(values[0])) return;
    insertNode.run(...values);
  };

  const depts = db
    .prepare(
      `SELECT id, label, icon, base_path, built_in, sort_order FROM departments ORDER BY sort_order`
    )
    .all() as Array<{
    id: string;
    label: string;
    icon: string;
    base_path: string;
    built_in: number;
    sort_order: number;
  }>;

  const divs = db
    .prepare(
      `SELECT id, department_id, label, icon, right_sidebar, built_in, sort_order
       FROM divisions ORDER BY sort_order`
    )
    .all() as Array<{
    id: string;
    department_id: string;
    label: string;
    icon: string;
    right_sidebar: string | null;
    built_in: number;
    sort_order: number;
  }>;

  const pages = db
    .prepare(
      `SELECT id, division_id, department_id, label, icon, segment, page_kind, built_in, sort_order
       FROM division_pages ORDER BY sort_order`
    )
    .all() as Array<{
    id: string;
    division_id: string;
    department_id: string;
    label: string;
    icon: string;
    segment: string;
    page_kind: string;
    built_in: number;
    sort_order: number;
  }>;

  const pagesByDiv = new Map<string, typeof pages>();
  for (const p of pages) {
    const key = `${p.department_id}/${p.division_id}`;
    const list = pagesByDiv.get(key) ?? [];
    list.push(p);
    pagesByDiv.set(key, list);
  }

  db.transaction(() => {
    for (const dept of depts) {
      const segment = dept.base_path.replace(/^\//, "") || dept.id;
      insertNodeIfMissing(
        dept.id,
        null,
        dept.label,
        dept.icon,
        segment,
        "placeholder",
        null,
        dept.built_in,
        dept.sort_order
      );

      for (const div of divs.filter((d) => d.department_id === dept.id)) {
        const divNodeId = `${dept.id}-${div.id}`;
        const divPages = pagesByDiv.get(`${dept.id}/${div.id}`) ?? [];
        const indexPage = divPages.find((p) => p.segment === "");
        const kind = indexPage?.page_kind ?? "placeholder";

        insertNodeIfMissing(
          divNodeId,
          dept.id,
          div.label,
          div.icon,
          div.id,
          kind,
          div.right_sidebar,
          div.built_in,
          div.sort_order
        );

        for (const page of divPages.filter((p) => p.segment !== "")) {
          const pageNodeId = `${dept.id}-${div.id}-${page.id}`;
          insertNodeIfMissing(
            pageNodeId,
            divNodeId,
            page.label,
            page.icon,
            page.segment,
            page.page_kind,
            null,
            page.built_in,
            page.sort_order
          );
        }
      }
    }

    const hasAssignments = db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_agent_assignments'`
      )
      .get();
    if (hasAssignments) {
      db.prepare(
        `DELETE FROM ai_agent_assignments
         WHERE agent_id LIKE 'dept-%'
            OR agent_id LIKE 'div-%'
            OR agent_id LIKE 'page-%'`
      ).run();
    }
    const hasAgents = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_agents'`)
      .get();
    if (hasAgents) {
      db.prepare(`DELETE FROM ai_agents WHERE id LIKE 'dept-%'`).run();
      db.prepare(`DELETE FROM ai_agents WHERE id LIKE 'div-%'`).run();
      db.prepare(`DELETE FROM ai_agents WHERE id LIKE 'page-%'`).run();
    }
  })();
}
