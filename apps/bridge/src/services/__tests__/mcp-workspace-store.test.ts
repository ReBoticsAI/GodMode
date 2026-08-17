import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import {
  getWorkspaceMcpOverlay,
  setWorkspaceMcpServers,
} from "../coding/mcp-workspace-store.js";

function memoryDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("mcp-workspace-store", () => {
  it("reports absent until saved", () => {
    expect(getWorkspaceMcpOverlay(memoryDb())).toEqual({
      present: false,
      servers: {},
    });
  });

  it("round-trips servers and keeps empty maps present", () => {
    const db = memoryDb();
    setWorkspaceMcpServers(db, { docs: { type: "http", url: "https://mcp.example/sse" } });
    expect(getWorkspaceMcpOverlay(db)).toEqual({
      present: true,
      servers: { docs: { type: "http", url: "https://mcp.example/sse" } },
    });
    setWorkspaceMcpServers(db, {});
    expect(getWorkspaceMcpOverlay(db)).toEqual({
      present: true,
      servers: {},
    });
  });
});
