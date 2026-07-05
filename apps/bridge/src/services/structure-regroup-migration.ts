import type Database from "better-sqlite3";
import { registerMigration } from "./db-migrations.js";

const MIGRATION_VERSION = 3;

/** Legacy leaf page ids removed when regrouping Sierra/Polymarket. */
const LEGACY_SIERRA_CHILDREN = [
  "trading-sierra-routines",
  "trading-sierra-performance",
  "trading-sierra-trading-plan",
  "trading-sierra-playbooks",
  "trading-sierra-builder",
  "trading-sierra-monitor",
  "trading-sierra-journal",
  "trading-sierra-backtest",
];

const LEGACY_POLYMARKET_CHILDREN = [
  "trading-polymarket-markets",
  "trading-polymarket-trade",
  "trading-polymarket-inefficiencies",
  "trading-polymarket-activity",
  "trading-polymarket-arbitrage",
  "trading-polymarket-no-buy",
  "trading-polymarket-market-making",
  "trading-polymarket-negrisk-basket",
  "trading-polymarket-trending",
  "trading-polymarket-liquidity-crunch",
  "trading-polymarket-stale-quotes",
  "trading-polymarket-wallets",
  "trading-polymarket-positions",
  "trading-polymarket-deposits",
  "trading-polymarket-builder",
  "trading-polymarket-settings",
];

export function registerStructureRegroupMigration(): void {
  registerMigration(MIGRATION_VERSION, "structure_regroup_sierra_polymarket", migrateRegroup);
}

function upsertGroup(
  db: Database.Database,
  row: {
    id: string;
    parentId: string;
    label: string;
    icon: string;
    segment: string;
    kind: string;
    sortOrder: number;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO structure_nodes
       (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?)`
  ).run(
    row.id,
    row.parentId,
    row.label,
    row.icon,
    row.segment,
    row.kind,
    row.sortOrder
  );
  db.prepare(
    `UPDATE structure_nodes
     SET parent_id=?, label=?, icon=?, segment=?, kind=?, built_in=1, sort_order=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    row.parentId,
    row.label,
    row.icon,
    row.segment,
    row.kind,
    row.sortOrder,
    row.id
  );
}

function migrateRegroup(db: Database.Database): void {
  const hasTable = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='structure_nodes'`
    )
    .get();
  if (!hasTable) return;

  const hasSierra = db
    .prepare(`SELECT id FROM structure_nodes WHERE id='trading-sierra'`)
    .get();
  if (!hasSierra) return;

  db.transaction(() => {
    for (const id of [...LEGACY_SIERRA_CHILDREN, ...LEGACY_POLYMARKET_CHILDREN]) {
      db.prepare(`DELETE FROM structure_nodes WHERE id=?`).run(id);
    }

    db.prepare(
      `UPDATE structure_nodes SET kind='sierra-dashboard-group', updated_at=datetime('now') WHERE id='trading-sierra'`
    ).run();
    db.prepare(
      `UPDATE structure_nodes SET kind='pm-dashboard-group', updated_at=datetime('now') WHERE id='trading-polymarket'`
    ).run();

    const sierraGroups: Array<[string, string, string, string, string, number]> = [
      ["trading-plan", "Trading Plan", "target", "trading-plan", "sierra-trading-plan-group", 1],
      ["playbooks", "Playbooks", "book-open", "playbooks", "sierra-playbooks-group", 2],
      ["config", "Config", "settings-2", "config", "sierra-config-group", 3],
    ];
    for (const [slug, label, icon, segment, kind, sort] of sierraGroups) {
      upsertGroup(db, {
        id: `trading-sierra-${slug}`,
        parentId: "trading-sierra",
        label,
        icon,
        segment,
        kind,
        sortOrder: sort,
      });
    }

    const polymarketGroups: Array<[string, string, string, string, string, number]> = [
      ["trading-plan", "Trading Plan", "target", "trading-plan", "pm-trading-plan-group", 1],
      ["playbooks", "Playbooks", "book-open", "playbooks", "pm-playbooks-group", 2],
      ["config", "Config", "settings-2", "config", "pm-config-group", 3],
    ];
    for (const [slug, label, icon, segment, kind, sort] of polymarketGroups) {
      upsertGroup(db, {
        id: `trading-polymarket-${slug}`,
        parentId: "trading-polymarket",
        label,
        icon,
        segment,
        kind,
        sortOrder: sort,
      });
    }
  })();
}
