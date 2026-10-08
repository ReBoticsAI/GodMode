import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import { isRunAgentLlmReady } from "../hook-dispatcher.js";

function emptyDb(): AppDatabase {
  return new Database(":memory:") as unknown as AppDatabase;
}

describe("isRunAgentLlmReady", () => {
  it("allows any backend when local LLM is ready", () => {
    expect(isRunAgentLlmReady(true, "local", emptyDb(), "core-issues")).toBe(
      true
    );
  });

  it("blocks local backend when local LLM is down", () => {
    expect(isRunAgentLlmReady(false, "local", emptyDb(), "core-issues")).toBe(
      false
    );
  });

  it("allows provider / cli / cursor backends without local LLM", () => {
    const db = emptyDb();
    expect(isRunAgentLlmReady(false, "provider", db, "core-issues")).toBe(true);
    expect(isRunAgentLlmReady(false, "cli", db, "core-prs")).toBe(true);
    expect(isRunAgentLlmReady(false, "cursor", db, "core-prs")).toBe(true);
  });
});
