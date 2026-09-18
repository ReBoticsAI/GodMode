import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildArchitectureProjection, buildGraphProjection, chatParentHubId } from "../graph-projection.js";
import { ensureChatUnlockTables } from "../chat-unlock-schema.js";
import type { AppDatabase } from "../../db.js";
import type { CoreDatabase } from "../../core-db.js";

function memoryTenant(): AppDatabase {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ai_chats (
      id TEXT PRIMARY KEY,
      title TEXT,
      user_id TEXT,
      agent_id TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tool_allow_json TEXT
    );
    CREATE TABLE ai_memories (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      agent_id TEXT,
      text TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_agent_skill_state (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    CREATE TABLE ai_workflows (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      name TEXT
    );
    INSERT INTO ai_agents (id, name, tool_allow_json)
      VALUES ('intelligence', 'Intelligence', '["web_search","read_file"]');
    INSERT INTO ai_chats (id, title, user_id, agent_id)
      VALUES ('c1', 'Hello', 'u1', 'intelligence');
    INSERT INTO ai_memories (id, chat_id, agent_id, text)
      VALUES ('m1', 'c1', 'intelligence', 'Remember this');
  `);
  return db as unknown as AppDatabase;
}

function memoryCloud(): CoreDatabase {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@b.c', 'A')`
  ).run();
  ensureChatUnlockTables(db);
  return db as unknown as CoreDatabase;
}

describe("graph-projection", () => {
  it("builds Chat-Agent-User triad with memories and tools", () => {
    const tenant = memoryTenant();
    const cloud = memoryCloud();
    const proj = buildGraphProjection({
      tenantDb: tenant,
      focusType: "chat",
      focusId: "c1",
      userId: "u1",
      userLabel: "A",
      cloudDb: cloud,
    });
    expect(proj.nodes.some((n) => n.id === "chat:c1")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "agent:intelligence")).toBe(true);
    expect(proj.nodes.some((n) => n.kind === "user")).toBe(true);
    expect(proj.edges.some((e) => e.kind === "chat-agent")).toBe(true);
    expect(proj.edges.some((e) => e.kind === "agent-user")).toBe(true);
    expect(proj.nodes.some((n) => n.kind === "memory")).toBe(true);
    expect(proj.nodes.some((n) => n.kind === "tool")).toBe(true);
  });

  it("builds public architecture spine without tenant DB", () => {
    const proj = buildArchitectureProjection({});
    expect(proj.focusType).toBe("architecture");
    expect(proj.nodes.some((n) => n.id === "hub:you")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:intelligence")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:heart")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:vault-you")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:vault-platform")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:admin")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:wiki")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:coding")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:releases")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:settings")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agents")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:users")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:wiki-you")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:wiki-intelligence")).toBe(
      false
    );
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:vault-platform"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:wiki"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) =>
          e.source === "hub:knowledge-you" && e.target === "hub:wiki-you"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:you" && e.target === "hub:admin"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:admin"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:you" && e.target === "hub:vault-platform"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:you" && e.target === "hub:vault-you"
      )
    ).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:account")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:cloud")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "vault:llm")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:workspace")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:life-you")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:life-intelligence")).toBe(
      false
    );
    expect(proj.nodes.some((n) => n.id === "hub:structure-you")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:structure-intelligence")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:memories-you")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:departments-you")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:wallet-you")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:wallet-intelligence")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:calendar-you")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:calendar-intelligence")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:marketplace")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:shared")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:support")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:support-tickets")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:support-chat")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:shared-grants")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:shared-network")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:marketplace-official")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:marketplace-official-packs")).toBe(
      true
    );
    expect(
      proj.nodes.some((n) => n.id === "hub:marketplace-official-connectors")
    ).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:marketplace-community")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:marketplace-local")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:marketplace-installed")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:marketplace-sell")).toBe(true);
    expect(
      proj.edges.some(
        (e) =>
          e.source === "hub:marketplace-official" &&
          e.target === "hub:marketplace-official-packs"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:support" && e.target === "hub:support-tickets"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) =>
          e.source === "hub:marketplace" &&
          e.target === "hub:marketplace-sell"
      )
    ).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agents")).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:you" && e.target === "hub:agents"
      )
    ).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agent-department")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:ws-personal")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:ws-project-alpha")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:ws-family")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agents-personal")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:agents-project-alpha")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:agents-family")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agent-research")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agent-ops")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agent-builder")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:agent-coordinator")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:structure-personal")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:chat-ws-personal")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:chat-agent-research")).toBe(
      false
    );
    expect(proj.nodes.some((n) => n.id === "hub:chat-agent-ops")).toBe(false);
    expect(proj.nodes.some((n) => n.kind === "chat")).toBe(false);
    expect(
      proj.edges.some(
        (e) =>
          e.source === "hub:agent-research" &&
          e.target === "hub:chat-agent-research"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) =>
          e.source === "hub:agent-ops" && e.target === "hub:chat-agent-ops"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:ws-personal" && e.target === "hub:chat-ws-personal"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:workspace" && e.target === "hub:ws-personal"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) =>
          e.source === "hub:intelligence" && e.target === "hub:agent-research"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:intelligence" && e.target === "hub:agent-ops"
      )
    ).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:vault-research")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:life-research")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:structure-research")).toBe(
      true
    );
    expect(proj.nodes.some((n) => n.id === "hub:vault-ops")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "hub:life-ops")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:structure-ops")).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:agent-research"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:agent-ops"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:support"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:shared"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:marketplace"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:heart" && e.target === "hub:workspace"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:support" && e.target === "hub:shared"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:shared" && e.target === "hub:marketplace"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:marketplace" && e.target === "hub:workspace"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) =>
          (e.source === "hub:you" && e.target === "hub:workspace") ||
          (e.source === "hub:workspace" && e.target === "hub:you")
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:workspace" && e.target === "hub:vault-you"
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:chat-you" && e.target === "hub:heart"
      )
    ).toBe(false);
    expect(proj.nodes.find((n) => n.id === "hub:heart")?.position.x).toBeGreaterThan(
      0
    );
    expect(proj.nodes.some((n) => n.id === "hub:chat-you")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:chat-intelligence")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:structure")).toBe(false);
    expect(proj.nodes.some((n) => n.id === "hub:unlock")).toBe(false);
    expect(
      proj.nodes.some((n) => Boolean(n.status?.attention))
    ).toBe(true);
    expect(
      proj.nodes.find((n) => n.id === "hub:intelligence")?.windows?.length
    ).toBe(1);
    expect(proj.nodes.every((n) => !("secret" in (n.status ?? {})))).toBe(true);
    expect(proj.catalogVersion).toBeGreaterThanOrEqual(37);

    // Vault sits behind owner: shared owner→Vault delta for You + agent pairs.
    // Platform Vault peers behind Hub with the same delta.
    const vaultBehindPairs: Array<[string, string]> = [
      ["hub:you", "hub:vault-you"],
      ["hub:heart", "hub:vault-platform"],
      ["hub:intelligence", "hub:vault-intelligence"],
      ["hub:agent-research", "hub:vault-research"],
      ["hub:agent-ops", "hub:vault-ops"],
    ];
    const vaultDelta = { x: -1.25, y: -0.55, z: -2.15 };
    for (const [ownerId, vaultId] of vaultBehindPairs) {
      const owner = proj.nodes.find((n) => n.id === ownerId);
      const vault = proj.nodes.find((n) => n.id === vaultId);
      expect(owner).toBeDefined();
      expect(vault).toBeDefined();
      expect(vault!.position.x - owner!.position.x).toBeCloseTo(vaultDelta.x);
      expect(vault!.position.y - owner!.position.y).toBeCloseTo(vaultDelta.y);
      expect(vault!.position.z - owner!.position.z).toBeCloseTo(vaultDelta.z);
      expect(vault!.position.z).toBeLessThan(owner!.position.z);
    }
    // Owner surfaces hang directly off You / agents (no Life hub).
    expect(
      proj.edges.some(
        (e) => e.source === "hub:you" && e.target === "hub:structure-you"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) =>
          e.source === "hub:intelligence" &&
          e.target === "hub:knowledge-intelligence"
      )
    ).toBe(true);
    expect(proj.edges.some((e) => e.kind === "life")).toBe(false);
    expect(
      proj.edges.some(
        (e) =>
          (e.source === "hub:you" && e.target === "hub:intelligence") ||
          (e.source === "hub:intelligence" && e.target === "hub:you")
      )
    ).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.source === "hub:you" && e.target === "hub:heart"
      )
    ).toBe(true);
    expect(
      proj.edges.some(
        (e) =>
          (e.source === "hub:intelligence" && e.target === "hub:heart") ||
          (e.source === "hub:heart" && e.target === "hub:intelligence")
      )
    ).toBe(true);
    expect(
      proj.nodes
        .find((n) => n.id === "hub:intelligence")
        ?.windows?.every((w) => w.kind !== "chat")
    ).toBe(true);
  });

  it("lays out live enrichment near catalog anchors (not chat-focus origin)", () => {
    const tenant = memoryTenant();
    const cloud = memoryCloud();
    tenant
      .prepare(
        `INSERT INTO ai_workflows (id, agent_id, name) VALUES ('w1', 'intelligence', 'Flow')`
      )
      .run();
    tenant
      .prepare(
        `INSERT INTO ai_chats (id, title, user_id, agent_id) VALUES
          ('c-you', 'My notes', 'u1', 'digital-you'),
          ('c-res', 'Research dig', 'u1', 'research')`
      )
      .run();
    const proj = buildArchitectureProjection({
      userId: "u1",
      userLabel: "A",
      tenantDb: tenant,
      cloudDb: cloud,
      enrichLiveNeighborhood: true,
    });
    expect(proj.nodes.some((n) => n.kind === "chat")).toBe(false);
    expect(proj.nodes.some((n) => n.id.startsWith("chat:"))).toBe(false);
    expect(
      proj.edges.some(
        (e) => e.kind === "live-instance" && e.target.startsWith("chat:")
      )
    ).toBe(false);
    const liveFlows = proj.nodes.filter(
      (n) => n.kind === "workflow" && n.status?.liveInstance
    );
    expect(liveFlows.length).toBeGreaterThan(0);
    expect(
      proj.edges.some(
        (e) =>
          e.kind === "live-instance" &&
          e.source === "hub:automations-intelligence"
      )
    ).toBe(true);
    const toolSummary = proj.nodes.find((n) => n.id === "live:tools:intelligence");
    expect(toolSummary?.label).toMatch(/tools \(\d+\)$/i);
    expect(Number(toolSummary?.status?.toolCount)).toBeGreaterThan(0);
    expect(proj.nodes.filter((n) => n.id.startsWith("tool:")).length).toBe(0);
    expect(
      proj.edges.some(
        (e) =>
          e.kind === "live-instance" &&
          e.source === "hub:heart" &&
          e.target === "live:tools:intelligence"
      )
    ).toBe(true);
  });

  it("maps chat agent_id to the owning agent hub", () => {
    const ids = new Set([
      "hub:you",
      "hub:intelligence",
      "hub:agent-research",
      "hub:agent-ops",
      "hub:agent-builder",
    ]);
    expect(chatParentHubId("intelligence", ids)).toBe("hub:intelligence");
    expect(chatParentHubId("digital-you", ids)).toBe("hub:you");
    expect(chatParentHubId(null, ids)).toBe("hub:you");
    expect(chatParentHubId("research", ids)).toBe("hub:agent-research");
    expect(chatParentHubId("ops", ids)).toBe("hub:agent-ops");
    expect(chatParentHubId("builder", ids)).toBe("hub:agent-builder");
  });

  it("marks agent hubs working from running turns and in-progress cards", () => {
    const tenant = memoryTenant();
    const cloud = memoryCloud();
    tenant.exec(`ALTER TABLE ai_chats ADD COLUMN turn_state_json TEXT`);
    tenant
      .prepare(
        `UPDATE ai_chats SET turn_state_json = ? WHERE id = 'c1'`
      )
      .run(
        JSON.stringify({
          status: "running",
          userMessageId: "m-user",
          agentId: "intelligence",
          userId: "u1",
          generation: "g1",
          checkpoint: [],
        })
      );
    tenant.exec(`
      CREATE TABLE ai_project_cards (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        column_id TEXT NOT NULL,
        title TEXT,
        status TEXT,
        assigned_agent_id TEXT
      );
      CREATE TABLE ai_workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    tenant
      .prepare(
        `INSERT INTO ai_workflows (id, agent_id, name) VALUES ('wf1', 'research', 'Dig')`
      )
      .run();
    tenant
      .prepare(
        `INSERT INTO ai_workflow_runs (id, workflow_id, status)
         VALUES ('run1', 'wf1', 'running')`
      )
      .run();
    tenant
      .prepare(
        `INSERT INTO ai_project_cards
          (id, project_id, column_id, title, status, assigned_agent_id)
         VALUES ('card1', 'p1', 'in_progress', 'Ship', 'working', 'ops')`
      )
      .run();

    const proj = buildArchitectureProjection({
      userId: "u1",
      userLabel: "A",
      tenantDb: tenant,
      cloudDb: cloud,
      enrichLiveNeighborhood: false,
    });

    expect(proj.nodes.find((n) => n.id === "hub:intelligence")?.status?.working).toBe(
      true
    );
    expect(proj.nodes.find((n) => n.id === "hub:agent-research")?.status?.working).toBe(
      true
    );
    expect(
      proj.nodes.find((n) => n.id === "hub:automations-research")?.status?.working
    ).toBe(true);
    expect(proj.nodes.find((n) => n.id === "hub:agent-ops")?.status?.working).toBe(
      true
    );
    expect(proj.nodes.find((n) => n.id === "hub:tasks-ops")?.status?.working).toBe(
      true
    );
    expect(proj.nodes.find((n) => n.id === "hub:you")?.status?.working).toBeFalsy();
  });

  it("ALTERs ai_chats.agent_id when the column is missing", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ai_chats (
        id TEXT PRIMARY KEY,
        title TEXT,
        user_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tool_allow_json TEXT
      );
      CREATE TABLE ai_memories (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        agent_id TEXT,
        text TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO ai_agents (id, name, tool_allow_json)
        VALUES ('intelligence', 'Intelligence', '[]');
      INSERT INTO ai_chats (id, title, user_id)
        VALUES ('c2', 'Legacy', 'u1');
    `);
    const cloud = memoryCloud();
    const proj = buildGraphProjection({
      tenantDb: db as unknown as AppDatabase,
      focusType: "chat",
      focusId: "c2",
      userId: "u1",
      userLabel: "A",
      cloudDb: cloud,
    });
    const cols = db
      .prepare(`PRAGMA table_info(ai_chats)`)
      .all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "agent_id")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "agent:intelligence")).toBe(true);
    expect(proj.nodes.some((n) => n.id === "chat:c2")).toBe(true);
  });
});
