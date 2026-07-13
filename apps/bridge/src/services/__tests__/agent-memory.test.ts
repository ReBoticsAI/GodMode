/**
 * Agent memory helpers: skill gate, gemma harness delta, wiki FTS sync shape.
 * Run: npx tsx apps/bridge/src/services/__tests__/agent-memory.test.ts
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  allowRememberTool,
  filterSchemasForProfile,
  GEMMA4_PROFILE,
} from "../model-profiles/index.js";
import { gateSkillDraft } from "../skill-quality.js";
import { syncWikiPageToFts, removeWikiPageFromIndex } from "../wiki-rag.js";
import { syncMemoryToFts } from "../vector-rag.js";
import { compactAgentMessages } from "../chat-history.js";

assert.ok(
  GEMMA4_PROFILE.harnessDelta.includes("Memory and wiki sections"),
  "gemma harness mentions memory/wiki restraint"
);
assert.ok(GEMMA4_PROFILE.deferredDiscoveryTools.includes("remember"));

assert.equal(
  allowRememberTool(GEMMA4_PROFILE, { userMessage: "hi" }),
  false
);
assert.equal(
  allowRememberTool(GEMMA4_PROFILE, {
    userMessage: "Please remember that my preferred timezone is America/Denver",
  }),
  true
);

const schemas = [
  { function: { name: "read_file" } },
  { function: { name: "remember" } },
  { function: { name: "list_subagents" } },
];
assert.deepEqual(
  filterSchemasForProfile(schemas, GEMMA4_PROFILE, { userMessage: "hi" }).map(
    (s) => s.function.name
  ),
  ["read_file"]
);

// Skill gate (in-memory sqlite without full migrations — only need skills tables empty).
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE ai_settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE ai_skills (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    name TEXT,
    description TEXT,
    body TEXT,
    tools_json TEXT,
    departments_json TEXT,
    enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    version INTEGER DEFAULT 1,
    updated_at TEXT
  );
  CREATE TABLE ai_agent_skill_state (
    agent_id TEXT,
    skill_id TEXT,
    enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    PRIMARY KEY (agent_id, skill_id)
  );
`);
const short = gateSkillDraft(db as never, "intelligence", {
  name: "X",
  body: "too short",
});
assert.ok(short && /short/i.test(short));

const goodBody = [
  "## When deploying a plugin",
  "1. Run the unit tests in the plugin package",
  "2. Build the plugin with the bridge esbuild path",
  "3. Copy dist into the tenant plugins folder",
  "4. Reload the plugin runtime and smoke-test Intelligence",
].join("\n");
assert.equal(
  gateSkillDraft(db as never, "intelligence", { name: "Deploy", body: goodBody }),
  null
);

// Wiki FTS + memory FTS sync against temporary tables
const core = new Database(":memory:");
core.exec(`
  CREATE TABLE wiki_pages (id TEXT PRIMARY KEY);
  CREATE VIRTUAL TABLE wiki_pages_fts USING fts5(page_id UNINDEXED, title, body);
`);
syncWikiPageToFts(core as never, "p1", "Hello", "world body");
const wikiHit = core
  .prepare(`SELECT page_id FROM wiki_pages_fts WHERE wiki_pages_fts MATCH 'hello'`)
  .get() as { page_id: string } | undefined;
assert.equal(wikiHit?.page_id, "p1");
removeWikiPageFromIndex(core as never, "p1");

const memDb = new Database(":memory:");
memDb.exec(`
  CREATE TABLE ai_memories (id TEXT PRIMARY KEY, text TEXT);
  CREATE VIRTUAL TABLE ai_memories_fts USING fts5(memory_id UNINDEXED, text);
`);
syncMemoryToFts(memDb as never, "m1", "favorite color is blue");
const memHit = memDb
  .prepare(`SELECT memory_id FROM ai_memories_fts WHERE ai_memories_fts MATCH 'blue'`)
  .get() as { memory_id: string } | undefined;
assert.equal(memHit?.memory_id, "m1");

const compacted = compactAgentMessages(
  [
    { role: "user", content: "a".repeat(100) },
    { role: "assistant", content: "b".repeat(100) },
    { role: "user", content: "c".repeat(100) },
    { role: "assistant", content: "d".repeat(100) },
    { role: "user", content: "keep me" },
  ],
  250
);
assert.ok(compacted.droppedTurns >= 1);
assert.ok(compacted.messages.some((m) => m.content === "keep me"));

console.log("agent-memory.test.ts: ok");
