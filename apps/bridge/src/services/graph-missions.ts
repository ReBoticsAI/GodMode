/**
 * Graph missions: verify predicates, award points, Cloud leaderboard.
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { AppDatabase } from "../db.js";
import { getCloudDb, type CoreDatabase } from "../core-db.js";
import { tableExists } from "./db-migrations.js";
import {
  ensureUserUniverseFile,
  resolveUniversePath,
} from "./sqlite-universe-registry.js";
import {
  getGraphMissionDef,
  listGraphMissionDefs,
  missionRewardPoints,
  type GraphMissionDef,
} from "./graph-missions-catalog.js";
import { ensureGraphLeaderboardTables } from "./graph-missions-schema.js";

export type GraphMissionView = GraphMissionDef & {
  points: number;
  degree: number;
  done: boolean;
  open: boolean;
  completedAt: string | null;
};

export type GraphMissionsStatus = {
  catalogVersion: number;
  totalPoints: number;
  missionsCompleted: number;
  missions: GraphMissionView[];
  attentionByNode: Record<string, number>;
  /** Points earned / available rolled up per graph node. */
  scoreByNode: Record<
    string,
    { earned: number; available: number; open: number; done: number }
  >;
};

/** Missions that auto-award when their live predicate is already true. */
const AUTO_COMPLETE_WHEN = new Set([
  "signed_in",
  "vault_slot",
  "vault_any",
  "chat_sent",
]);


function openUserScoreDb(userId: string): Database.Database {
  const file = ensureUserUniverseFile({ userId });
  const db = new Database(file.absolutePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_mission_completions (
      mission_id TEXT PRIMARY KEY,
      points INTEGER NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS graph_score_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function readLocalCompletions(userId: string): Map<string, { points: number; completedAt: string }> {
  const db = openUserScoreDb(userId);
  try {
    const rows = db
      .prepare(
        `SELECT mission_id, points, completed_at FROM graph_mission_completions`
      )
      .all() as Array<{ mission_id: string; points: number; completed_at: string }>;
    return new Map(
      rows.map((r) => [
        r.mission_id,
        { points: r.points, completedAt: r.completed_at },
      ])
    );
  } finally {
    db.close();
  }
}

function secretKeyHints(db: AppDatabase): Set<string> {
  const keys = new Set<string>();
  try {
    if (!tableExists(db, "vault_secrets")) return keys;
    const cols = db.prepare(`PRAGMA table_info(vault_secrets)`).all() as Array<{
      name: string;
    }>;
    const nameCol = cols.some((c) => c.name === "name")
      ? "name"
      : cols.some((c) => c.name === "key")
        ? "key"
        : cols.some((c) => c.name === "id")
          ? "id"
          : null;
    if (!nameCol) return keys;
    const rows = db
      .prepare(`SELECT ${nameCol} AS k FROM vault_secrets LIMIT 40`)
      .all() as Array<{ k: string }>;
    for (const r of rows) {
      if (typeof r.k === "string" && r.k.trim()) keys.add(r.k.toLowerCase());
    }
  } catch {
    /* optional */
  }
  return keys;
}

function vaultHasAny(db: AppDatabase | null | undefined): boolean {
  if (!db || !tableExists(db, "vault_secrets")) return false;
  try {
    const row = db.prepare(`SELECT 1 AS ok FROM vault_secrets LIMIT 1`).get() as
      | { ok: number }
      | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

function slotConnected(hints: Set<string>, needles: string[]): boolean {
  for (const h of hints) {
    for (const n of needles) {
      if (h.includes(n)) return true;
    }
  }
  return false;
}

function userSentChat(opts: {
  userId?: string;
  tenantDb?: AppDatabase | null;
  agentId?: string;
}): boolean {
  const db = opts.tenantDb;
  const userId = opts.userId;
  if (!db || !userId || userId === "system-local") return false;
  if (!tableExists(db, "ai_messages") || !tableExists(db, "ai_chats")) {
    return false;
  }
  try {
    const agentId = (opts.agentId ?? "intelligence").trim() || "intelligence";
    const chatCols = db.prepare(`PRAGMA table_info(ai_chats)`).all() as Array<{
      name: string;
    }>;
    const msgCols = db.prepare(`PRAGMA table_info(ai_messages)`).all() as Array<{
      name: string;
    }>;
    const hasAgentCol = chatCols.some((c) => c.name === "agent_id");
    const hasMsgUser = msgCols.some((c) => c.name === "user_id");
    const userClause = hasMsgUser
      ? `(c.user_id = ? OR m.user_id = ?)`
      : `c.user_id = ?`;
    const params = hasMsgUser ? [userId, userId] : [userId];
    if (hasAgentCol) {
      const row = db
        .prepare(
          `SELECT 1 AS ok
           FROM ai_messages m
           JOIN ai_chats c ON c.id = m.chat_id
           WHERE m.role = 'user'
             AND ${userClause}
             AND (c.agent_id IS NULL OR c.agent_id = '' OR c.agent_id = ?)
           LIMIT 1`
        )
        .get(...params, agentId) as { ok: number } | undefined;
      return Boolean(row);
    }
    const row = db
      .prepare(
        `SELECT 1 AS ok
         FROM ai_messages m
         JOIN ai_chats c ON c.id = m.chat_id
         WHERE m.role = 'user'
           AND ${userClause}
         LIMIT 1`
      )
      .get(...params) as { ok: number } | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

export function missionPredicateSatisfied(opts: {
  mission: GraphMissionDef;
  userId?: string;
  tenantDb?: AppDatabase | null;
}): boolean {
  const { mission, userId, tenantDb } = opts;
  switch (mission.completeWhen) {
    case "signed_in":
      return Boolean(userId && userId !== "system-local");
    case "vault_any":
      return vaultHasAny(tenantDb);
    case "vault_slot": {
      if (!tenantDb) return false;
      const needles = (mission.completeKey ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      return slotConnected(secretKeyHints(tenantDb), needles);
    }
    case "chat_sent":
      return userSentChat({ userId, tenantDb, agentId: "intelligence" });
    case "bridge_ok":
      return true;
    case "manual_ack":
    case "surface_opened":
      return true;
    default:
      return false;
  }
}

/**
 * Award any auto-missions whose live predicates are already satisfied.
 * Safe / idempotent. Call from status GET and after chat turns.
 */
export function syncAutoCompleteMissions(opts: {
  userId: string;
  displayName: string;
  tenantDb?: AppDatabase | null;
  instanceId?: string;
  cloudDb?: CoreDatabase;
}): { awarded: Array<{ missionId: string; points: number }> } {
  if (!opts.userId || opts.userId === "system-local") {
    return { awarded: [] };
  }
  const awarded: Array<{ missionId: string; points: number }> = [];
  for (const def of listGraphMissionDefs()) {
    if (!AUTO_COMPLETE_WHEN.has(def.completeWhen)) continue;
    const existing = readLocalCompletions(opts.userId).get(def.id);
    if (existing) continue;
    if (
      !missionPredicateSatisfied({
        mission: def,
        userId: opts.userId,
        tenantDb: opts.tenantDb,
      })
    ) {
      continue;
    }
    const result = completeGraphMission({
      missionId: def.id,
      userId: opts.userId,
      displayName: opts.displayName,
      tenantDb: opts.tenantDb,
      instanceId: opts.instanceId,
      cloudDb: opts.cloudDb,
    });
    if (!result.alreadyDone && result.pointsAwarded > 0) {
      awarded.push({ missionId: def.id, points: result.pointsAwarded });
    }
  }
  return { awarded };
}

export function getGraphMissionsStatus(opts: {
  userId?: string;
  tenantDb?: AppDatabase | null;
}): GraphMissionsStatus {
  const completions = opts.userId
    ? readLocalCompletions(opts.userId)
    : new Map<string, { points: number; completedAt: string }>();

  const views: GraphMissionView[] = listGraphMissionDefs().map((def) => {
    const points = missionRewardPoints(def);
    const hit = completions.get(def.id);
    const done = Boolean(hit);
    return {
      ...def,
      points,
      degree: Math.round(points / Math.max(1, def.basePoints) - 1),
      done,
      open: !done,
      completedAt: hit?.completedAt ?? null,
    };
  });

  const attentionByNode: Record<string, number> = {};
  const scoreByNode: GraphMissionsStatus["scoreByNode"] = {};
  for (const m of views) {
    if (!scoreByNode[m.nodeId]) {
      scoreByNode[m.nodeId] = { earned: 0, available: 0, open: 0, done: 0 };
    }
    const bucket = scoreByNode[m.nodeId]!;
    bucket.available += m.points;
    if (m.done) {
      bucket.earned += m.points;
      bucket.done += 1;
    } else {
      bucket.open += 1;
      attentionByNode[m.nodeId] = (attentionByNode[m.nodeId] ?? 0) + 1;
    }
  }

  let totalPoints = 0;
  for (const c of completions.values()) totalPoints += c.points;

  return {
    catalogVersion: 1,
    totalPoints,
    missionsCompleted: completions.size,
    missions: views,
    attentionByNode,
    scoreByNode,
  };
}

/** Attention flags for graph projection status (safe booleans only). */
export function attentionStatusForNode(
  nodeId: string,
  attentionByNode: Record<string, number>
): Record<string, boolean | string | number> | undefined {
  const count = attentionByNode[nodeId] ?? 0;
  if (count <= 0) return undefined;
  return {
    attention: true,
    attentionCount: count,
    openMissions: count,
  };
}

export function completeGraphMission(opts: {
  missionId: string;
  userId: string;
  displayName: string;
  tenantDb?: AppDatabase | null;
  instanceId?: string;
  cloudDb?: CoreDatabase;
}): {
  ok: true;
  alreadyDone: boolean;
  pointsAwarded: number;
  totalPoints: number;
  mission: GraphMissionView;
} {
  const mission = getGraphMissionDef(opts.missionId);
  if (!mission) {
    throw Object.assign(new Error(`Unknown mission: ${opts.missionId}`), {
      status: 404,
    });
  }

  const existing = readLocalCompletions(opts.userId).get(mission.id);
  if (existing) {
    const status = getGraphMissionsStatus({
      userId: opts.userId,
      tenantDb: opts.tenantDb,
    });
    const view = status.missions.find((m) => m.id === mission.id)!;
    return {
      ok: true,
      alreadyDone: true,
      pointsAwarded: 0,
      totalPoints: status.totalPoints,
      mission: view,
    };
  }

  if (
    !missionPredicateSatisfied({
      mission,
      userId: opts.userId,
      tenantDb: opts.tenantDb,
    })
  ) {
    throw Object.assign(
      new Error("Mission requirements not met yet"),
      { status: 400 }
    );
  }

  const points = missionRewardPoints(mission);
  const db = openUserScoreDb(opts.userId);
  try {
    db.prepare(
      `INSERT INTO graph_mission_completions (mission_id, points, completed_at)
       VALUES (?, ?, datetime('now'))`
    ).run(mission.id, points);
    const sum = db
      .prepare(`SELECT COALESCE(SUM(points), 0) AS total FROM graph_mission_completions`)
      .get() as { total: number };
    db.prepare(
      `INSERT INTO graph_score_meta (key, value, updated_at)
       VALUES ('total_points', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(String(sum.total));
  } finally {
    db.close();
  }

  publishLeaderboardScore({
    userId: opts.userId,
    displayName: opts.displayName,
    missionId: mission.id,
    points,
    instanceId: opts.instanceId ?? "local",
    cloudDb: opts.cloudDb,
  });

  const status = getGraphMissionsStatus({
    userId: opts.userId,
    tenantDb: opts.tenantDb,
  });
  return {
    ok: true,
    alreadyDone: false,
    pointsAwarded: points,
    totalPoints: status.totalPoints,
    mission: status.missions.find((m) => m.id === mission.id)!,
  };
}

function scrubDisplayName(raw: string): string {
  const t = raw.trim().slice(0, 64);
  return t.replace(/[<>]/g, "") || "Human";
}

export function publishLeaderboardScore(opts: {
  userId: string;
  displayName: string;
  missionId: string;
  points: number;
  instanceId: string;
  cloudDb?: CoreDatabase;
}): void {
  // Local-only guests do not publish to Cloud.
  if (!opts.userId || opts.userId === "system-local") return;

  const cloud = opts.cloudDb ?? getCloudDb();
  ensureGraphLeaderboardTables(cloud);
  const name = scrubDisplayName(opts.displayName);
  const eventId = randomUUID();

  cloud
    .prepare(
      `INSERT INTO graph_leaderboard_events (
         id, user_id, mission_id, points, instance_id
       ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(eventId, opts.userId, opts.missionId, opts.points, opts.instanceId);

  const existing = cloud
    .prepare(
      `SELECT total_points, missions_completed FROM graph_leaderboard_scores WHERE user_id = ?`
    )
    .get(opts.userId) as
    | { total_points: number; missions_completed: number }
    | undefined;

  if (existing) {
    cloud
      .prepare(
        `UPDATE graph_leaderboard_scores
         SET display_name = ?,
             total_points = total_points + ?,
             missions_completed = missions_completed + 1,
             updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .run(name, opts.points, opts.userId);
  } else {
    cloud
      .prepare(
        `INSERT INTO graph_leaderboard_scores (
           user_id, display_name, total_points, missions_completed
         ) VALUES (?, ?, ?, 1)`
      )
      .run(opts.userId, name, opts.points);
  }
}

export function listGraphLeaderboard(opts?: {
  limit?: number;
  cloudDb?: CoreDatabase;
}): Array<{
  rank: number;
  userId: string;
  displayName: string;
  totalPoints: number;
  missionsCompleted: number;
  updatedAt: string;
}> {
  const cloud = opts?.cloudDb ?? getCloudDb();
  ensureGraphLeaderboardTables(cloud);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
  const rows = cloud
    .prepare(
      `SELECT user_id, display_name, total_points, missions_completed, updated_at
       FROM graph_leaderboard_scores
       ORDER BY total_points DESC, updated_at ASC
       LIMIT ?`
    )
    .all(limit) as Array<{
    user_id: string;
    display_name: string;
    total_points: number;
    missions_completed: number;
    updated_at: string;
  }>;
  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    displayName: r.display_name,
    totalPoints: r.total_points,
    missionsCompleted: r.missions_completed,
    updatedAt: r.updated_at,
  }));
}

/** Ensure user actor path resolves (tests). */
export function userScorePathExists(userId: string): boolean {
  const resolved = resolveUniversePath(`actors/users/${userId}.sqlite`);
  return resolved.ok;
}
