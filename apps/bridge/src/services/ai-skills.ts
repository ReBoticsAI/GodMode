import fs from "node:fs";
import path from "node:path";
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";
import {
  ensureKnowledgeImported,
  isOperatorTenantDb,
  listSkillsFromDb,
  upsertSkillInDb,
} from "./knowledge-store.js";

export interface AiSkill {
  id: string;
  name: string;
  description: string;
  tools: string[];
  /** Department ids this skill is scoped to (empty = general/global). */
  departments: string[];
  enabled: boolean;
  /** 'active' = injectable; 'pending' = drafted, awaiting approval. */
  status: "active" | "pending";
  body?: string;
  /** Owner agent id (present on DB-backed list rows). */
  agentId?: string;
  version?: number;
  updatedAt?: string;
}

/**
 * Parses a frontmatter list field written as either a YAML/JSON array
 * (`[a, b]`) or a comma/space-separated scalar (`a, b`). Returns [] when absent.
 */
export function parseListField(header: string, key: string): string[] {
  const arr = header.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, "i"));
  if (arr) {
    return arr[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  const scalar = header.match(new RegExp(`${key}:\\s*(.+)`, "i"));
  if (scalar) {
    return scalar[1]
      .split(/[,\s]+/)
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function skillsDir(): string {
  return path.join(config.repoRoot, "apps", "bridge", "data", "ai", "skills");
}

function parseSkillMd(
  content: string,
  skillId: string
): Omit<AiSkill, "enabled" | "body" | "status"> {
  let name = skillId;
  let description = "";
  let tools: string[] = [];
  let departments: string[] = [];
  let body = content;

  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2].trim();
    const header = fm[1];
    const n = header.match(/name:\s*(.+)/i);
    if (n) name = n[1].trim();
    const d = header.match(/description:\s*(.+)/i);
    if (d) description = d[1].trim();
    tools = parseListField(header, "tools");
    departments = parseListField(header, "departments");
  }

  return { id: skillId, name, description, tools, departments };
}

const DEFAULT_AGENT_ID = "intelligence";

export function listAiSkills(
  db: AppDatabase,
  includeBody = false,
  agentId: string = DEFAULT_AGENT_ID
): AiSkill[] {
  ensureKnowledgeImported(db);
  const fromDb = listSkillsFromDb(db, includeBody, agentId);
  if (fromDb.length > 0) return fromDb;

  if (!isOperatorTenantDb(db)) return [];

  const dir = skillsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const states = new Map<string, { enabled: number; status: string }>();
  for (const row of db
    .prepare(
      `SELECT skill_id, enabled, status FROM ai_agent_skill_state WHERE agent_id = ?`
    )
    .all(agentId) as Array<{ skill_id: string; enabled: number; status: string | null }>) {
    states.set(row.skill_id, { enabled: row.enabled, status: row.status ?? "active" });
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skills: AiSkill[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(dir, ent.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf8");
    const parsed = parseSkillMd(raw, ent.name);
    const st = states.get(parsed.id);
    skills.push({
      ...parsed,
      enabled: st?.enabled !== 0,
      status: st?.status === "pending" ? "pending" : "active",
      body: includeBody ? raw : undefined,
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkillsIndexText(
  db: AppDatabase,
  agentId: string = DEFAULT_AGENT_ID
): string {
  // Pending (drafted, unapproved) skills are never injected into the prompt.
  const enabled = listAiSkills(db, false, agentId).filter(
    (s) => s.enabled && s.status !== "pending"
  );
  if (enabled.length === 0) return "";
  const lines = [
    "--- Available skills (invoke use_skill or /skill before using) ---",
  ];
  for (const s of enabled) {
    lines.push(`- ${s.id}: ${s.description || s.name}`);
  }
  return lines.join("\n");
}

export function loadSkillBody(
  db: AppDatabase,
  skillId: string,
  agentId: string = DEFAULT_AGENT_ID
): string | null {
  const st = db
    .prepare(
      `SELECT enabled FROM ai_agent_skill_state WHERE agent_id = ? AND skill_id = ?`
    )
    .get(agentId, skillId) as { enabled: number } | undefined;
  if (st && st.enabled === 0) return null;

  const row = db
    .prepare(`SELECT body FROM ai_skills WHERE id = ?`)
    .get(skillId) as { body: string } | undefined;
  if (row?.body) return row.body;

  const skillPath = path.join(skillsDir(), skillId, "SKILL.md");
  if (!fs.existsSync(skillPath)) return null;
  return fs.readFileSync(skillPath, "utf8");
}

export function updateAiSkillState(
  db: AppDatabase,
  agentId: string,
  skillId: string,
  enabled: boolean
): void {
  db.prepare(
    `INSERT INTO ai_agent_skill_state (agent_id, skill_id, enabled, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(agent_id, skill_id) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
  ).run(agentId, skillId, enabled ? 1 : 0);
}

/** Filesystem-safe skill id from a free-form name. */
export function slugSkillId(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "skill"
  );
}

/** Set the pending/active status of a skill for an agent (upsert). */
export function setAiSkillStatus(
  db: AppDatabase,
  agentId: string,
  skillId: string,
  status: "active" | "pending"
): void {
  db.prepare(
    `INSERT INTO ai_agent_skill_state (agent_id, skill_id, enabled, status, updated_at)
     VALUES (?, ?, 1, ?, datetime('now'))
     ON CONFLICT(agent_id, skill_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`
  ).run(agentId, skillId, status);
}

export interface CreateSkillInput {
  name: string;
  description: string;
  body: string;
  tools?: string[];
  departments?: string[];
}

/**
 * Write a new file-backed skill (SKILL.md with frontmatter) and register it for
 * an agent with the given status. Returns the resolved skill id. Throws if a
 * skill with the same id already exists, so reflection can't clobber existing
 * skills.
 */
export function createSkillFile(
  db: AppDatabase,
  agentId: string,
  input: CreateSkillInput,
  status: "active" | "pending" = "pending"
): string {
  const id = slugSkillId(input.name);
  const existing = db.prepare(`SELECT id FROM ai_skills WHERE id = ?`).get(id);
  if (existing) throw new Error(`Skill already exists: ${id}`);
  const tools = input.tools ?? [];
  const departments = input.departments ?? [];
  upsertSkillInDb(db, agentId, {
    id,
    name: input.name,
    description: input.description,
    body: input.body.trim(),
    tools,
    departments,
    enabled: true,
    status,
  });
  setAiSkillStatus(db, agentId, id, status);
  return id;
}

/** Delete a skill and its per-agent state (used to reject drafts). */
export function deleteSkillFile(db: AppDatabase, skillId: string): boolean {
  const r = db.prepare(`DELETE FROM ai_skills WHERE id = ?`).run(skillId);
  db.prepare(`DELETE FROM ai_agent_skill_state WHERE skill_id = ?`).run(skillId);
  const skillDir = path.join(skillsDir(), skillId);
  if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
  return r.changes > 0;
}

const DOMAIN_SKILL_IDS = ["optimize-playbook", "platform-self-loop", "shadcn-ui"] as const;

/** Idempotent: ensure active domain recipe skills exist for intelligence + sierra-chart. */
export function seedDomainSkills(db: AppDatabase): void {
  const dir = skillsDir();
  // ai_skills is keyed by id alone, so own the row under 'intelligence' (which
  // listSkillsFromDb surfaces to every agent via its OR clause) and activate the
  // per-agent state for each agent that should treat it as live.
  const activeForAgents = ["intelligence", "sierra-chart"];
  for (const skillId of DOMAIN_SKILL_IDS) {
    const skillPath = path.join(dir, skillId, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf8");
    const parsed = parseSkillMd(raw, skillId);
    upsertSkillInDb(db, "intelligence", {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      body: raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/)?.[1]?.trim() ?? "",
      tools: parsed.tools,
      departments: parsed.departments,
      enabled: true,
      status: "active",
    });
    for (const agentId of activeForAgents) {
      setAiSkillStatus(db, agentId, parsed.id, "active");
    }
  }
}
