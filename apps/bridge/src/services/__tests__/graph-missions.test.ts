import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../../config.js";
import {
  catalogNodeDegree,
  listGraphMissionDefs,
  missionRewardPoints,
} from "../graph-missions-catalog.js";
import {
  completeGraphMission,
  getGraphMissionsStatus,
  listGraphLeaderboard,
  syncAutoCompleteMissions,
} from "../graph-missions.js";
import { ensureGraphLeaderboardTables } from "../graph-missions-schema.js";
import { closeRegistryDb } from "../sqlite-universe-registry.js";
import type { CoreDatabase } from "../../core-db.js";
import type { AppDatabase } from "../../db.js";

describe("graph-missions", () => {
  const prev = config.dataDir;
  let tmp: string;

  afterEach(() => {
    closeRegistryDb();
    config.dataDir = prev;
    if (tmp && fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("weights rewards by catalog degree", () => {
    const meet = listGraphMissionDefs().find((m) => m.id === "intelligence.meet")!;
    const { degree } = catalogNodeDegree(meet.nodeId);
    expect(degree).toBeGreaterThan(0);
    expect(missionRewardPoints(meet)).toBe(
      Math.max(1, Math.round(meet.basePoints * (1 + degree)))
    );
  });

  it("awards points once and publishes Cloud leaderboard", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-missions-"));
    config.dataDir = tmp;

    const cloud = new Database(":memory:") as unknown as CoreDatabase;
    ensureGraphLeaderboardTables(cloud);

    const first = completeGraphMission({
      missionId: "hub.check",
      userId: "user-1",
      displayName: "Dane",
      cloudDb: cloud,
      instanceId: "test",
    });
    expect(first.alreadyDone).toBe(false);
    expect(first.pointsAwarded).toBeGreaterThan(0);

    const second = completeGraphMission({
      missionId: "hub.check",
      userId: "user-1",
      displayName: "Dane",
      cloudDb: cloud,
      instanceId: "test",
    });
    expect(second.alreadyDone).toBe(true);
    expect(second.pointsAwarded).toBe(0);
    expect(second.totalPoints).toBe(first.totalPoints);

    const board = listGraphLeaderboard({ cloudDb: cloud, limit: 10 });
    expect(board[0]?.displayName).toBe("Dane");
    expect(board[0]?.totalPoints).toBe(first.pointsAwarded);
    expect(board[0]?.missionsCompleted).toBe(1);

    const dayBoard = listGraphLeaderboard({
      cloudDb: cloud,
      limit: 10,
      timeframe: "day",
    });
    expect(dayBoard[0]?.displayName).toBe("Dane");
    expect(dayBoard[0]?.totalPoints).toBe(first.pointsAwarded);

    const allBoard = listGraphLeaderboard({
      cloudDb: cloud,
      limit: 10,
      timeframe: "all",
    });
    expect(allBoard[0]?.displayName).toBe("Dane");

    const status = getGraphMissionsStatus({ userId: "user-1" });
    expect(status.attentionByNode["hub:heart"]).toBeUndefined();
    expect(status.missions.find((m) => m.id === "hub.check")?.done).toBe(
      true
    );
    expect(status.scoreByNode["hub:heart"]?.earned).toBe(first.pointsAwarded);
  });

  it("auto-awards Meet Intelligence after a user chat message", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-missions-"));
    config.dataDir = tmp;
    const cloud = new Database(":memory:") as unknown as CoreDatabase;
    ensureGraphLeaderboardTables(cloud);
    const tenant = new Database(":memory:");
    tenant.exec(`
      CREATE TABLE ai_chats (
        id TEXT PRIMARY KEY,
        title TEXT,
        user_id TEXT,
        agent_id TEXT
      );
      CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        user_id TEXT,
        content_json TEXT NOT NULL
      );
    `);
    tenant
      .prepare(
        `INSERT INTO ai_chats (id, title, user_id, agent_id) VALUES ('c1','Hi','user-3','intelligence')`
      )
      .run();
    tenant
      .prepare(
        `INSERT INTO ai_messages (id, chat_id, role, user_id, content_json)
         VALUES ('m1','c1','user','user-3','{"text":"hello"}')`
      )
      .run();

    const { awarded } = syncAutoCompleteMissions({
      userId: "user-3",
      displayName: "Alex",
      tenantDb: tenant as unknown as AppDatabase,
      cloudDb: cloud,
    });
    expect(awarded.some((a) => a.missionId === "intelligence.meet")).toBe(true);
    const status = getGraphMissionsStatus({
      userId: "user-3",
      tenantDb: tenant as unknown as AppDatabase,
    });
    expect(status.missions.find((m) => m.id === "intelligence.meet")?.done).toBe(
      true
    );
  });

  it("rejects vault.llm.connect until vault slot exists", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-missions-"));
    config.dataDir = tmp;
    const tenant = new Database(":memory:");
    tenant.exec(`
      CREATE TABLE vault_secrets (
        id TEXT PRIMARY KEY,
        name TEXT
      );
    `);
    expect(() =>
      completeGraphMission({
        missionId: "vault.llm.connect",
        userId: "user-2",
        displayName: "Pat",
        tenantDb: tenant as unknown as AppDatabase,
        cloudDb: new Database(":memory:") as unknown as CoreDatabase,
      })
    ).toThrow(/not met/i);

    tenant
      .prepare(`INSERT INTO vault_secrets (id, name) VALUES (?, ?)`)
      .run("openrouter_key", "openrouter");
    const ok = completeGraphMission({
      missionId: "vault.llm.connect",
      userId: "user-2",
      displayName: "Pat",
      tenantDb: tenant as unknown as AppDatabase,
      cloudDb: (() => {
        const c = new Database(":memory:") as unknown as CoreDatabase;
        ensureGraphLeaderboardTables(c);
        return c;
      })(),
    });
    expect(ok.pointsAwarded).toBeGreaterThan(0);
  });
});
