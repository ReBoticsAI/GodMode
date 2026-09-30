/**
 * Cloud leaderboard schema for Graph missions (GodMode Cloud hub).
 */
import type { CoreDatabase } from "../core-db.js";

export function ensureGraphLeaderboardTables(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_leaderboard_scores (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      total_points INTEGER NOT NULL DEFAULT 0,
      missions_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS graph_leaderboard_scores_points_idx
      ON graph_leaderboard_scores(total_points DESC);

    CREATE TABLE IF NOT EXISTS graph_leaderboard_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      points INTEGER NOT NULL,
      instance_id TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS graph_leaderboard_events_user_idx
      ON graph_leaderboard_events(user_id, created_at DESC);
  `);
}
