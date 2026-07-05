import fs from "node:fs";
import path from "node:path";
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";
import { parseListField } from "./ai-skills.js";
import {
  ensureKnowledgeImported,
  isOperatorTenantDb,
  listRulesFromDb,
  upsertRuleInDb,
} from "./knowledge-store.js";

export interface AiRule {
  id: string;
  description: string;
  body: string;
  alwaysApply: boolean;
  globs: string[];
  /** Department ids this rule is scoped to (empty = not department-scoped). */
  departments: string[];
  priority: number;
  enabled: boolean;
  /** 'active' = applied; 'pending' = drafted, awaiting approval. */
  status: "active" | "pending";
  /** Owner agent id (present on DB-backed list rows). */
  agentId?: string;
  version?: number;
  updatedAt?: string;
}

function rulesDir(): string {
  return path.join(config.repoRoot, "apps", "bridge", "data", "ai", "rules");
}

/** Absolute path to the file-backed rules directory (.mdc files live here). */
export function aiRulesDir(): string {
  return rulesDir();
}

function parseMdc(content: string, filename: string): Omit<AiRule, "enabled" | "status"> {
  const id = path.basename(filename, ".mdc");
  let description = id;
  let alwaysApply = true;
  let globs: string[] = [];
  let departments: string[] = [];
  let priority = 50;
  let body = content;

  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2].trim();
    const header = fm[1];
    const desc = header.match(/description:\s*(.+)/i);
    if (desc) description = desc[1].trim();
    const aa = header.match(/alwaysApply:\s*(true|false)/i);
    if (aa) alwaysApply = aa[1].toLowerCase() === "true";
    globs = parseListField(header, "globs");
    departments = parseListField(header, "departments");
    const pri = header.match(/priority:\s*(\d+)/i);
    if (pri) priority = Number(pri[1]);
    // A rule scoped to a department applies only via that scope, not globally.
    if (departments.length > 0 && !/alwaysApply:/i.test(header)) {
      alwaysApply = false;
    }
  }

  return { id, description, body, alwaysApply, globs, departments, priority };
}

function globMatches(pathname: string, glob: string): boolean {
  const g = glob.replace(/\*\*/g, "%%").replace(/\*/g, "[^/]*").replace(/%%/g, ".*");
  try {
    return new RegExp(`^${g}$`).test(pathname);
  } catch {
    return pathname.includes(glob.replace(/\*\*/g, "").replace(/\*/g, ""));
  }
}

function ruleApplies(
  rule: AiRule,
  pathname?: string,
  departmentId?: string
): boolean {
  if (!rule.enabled) return false;
  // Drafted-but-unapproved rules are never applied.
  if (rule.status === "pending") return false;
  if (
    departmentId &&
    rule.departments.length > 0 &&
    rule.departments.includes(departmentId)
  ) {
    return true;
  }
  if (rule.alwaysApply) return true;
  if (!pathname || rule.globs.length === 0) return false;
  return rule.globs.some((g) => globMatches(pathname, g));
}

const DEFAULT_AGENT_ID = "intelligence";

/** Maps a `dept-<id>` agent id to its department id, else null. */
export function departmentIdForAgent(agentId: string): string | null {
  return agentId.startsWith("dept-") ? agentId.slice("dept-".length) : null;
}

export function listAiRules(
  db: AppDatabase,
  agentId: string = DEFAULT_AGENT_ID
): AiRule[] {
  ensureKnowledgeImported(db);
  const fromDb = listRulesFromDb(db, agentId);
  if (fromDb.length > 0) return fromDb;

  // Shared filesystem rules are operator-only; personal tenants are DB-backed.
  if (!isOperatorTenantDb(db)) return [];

  const dir = rulesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const states = new Map<
    string,
    { enabled: number; priority?: number; status: string }
  >();
  for (const row of db
    .prepare(
      `SELECT rule_id, enabled, priority_override, status FROM ai_agent_rule_state WHERE agent_id = ?`
    )
    .all(agentId) as Array<{
    rule_id: string;
    enabled: number;
    priority_override: number | null;
    status: string | null;
  }>) {
    states.set(row.rule_id, {
      enabled: row.enabled,
      priority: row.priority_override ?? undefined,
      status: row.status ?? "active",
    });
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mdc"));
  const rules: AiRule[] = [];
  for (const file of files) {
    const parsed = parseMdc(fs.readFileSync(path.join(dir, file), "utf8"), file);
    const st = states.get(parsed.id);
    rules.push({
      ...parsed,
      priority: st?.priority ?? parsed.priority,
      enabled: st?.enabled !== 0,
      status: st?.status === "pending" ? "pending" : "active",
    });
  }
  return rules.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function getActiveRulesText(
  db: AppDatabase,
  pathname?: string,
  agentId: string = DEFAULT_AGENT_ID
): string {
  const departmentId = departmentIdForAgent(agentId) ?? undefined;
  const active = listAiRules(db, agentId).filter((r) =>
    ruleApplies(r, pathname, departmentId)
  );
  if (active.length === 0) return "";
  const lines = ["--- Rules (always follow) ---"];
  for (const r of active) {
    lines.push(`\n[${r.id}] ${r.description}`);
    lines.push(r.body);
  }
  return lines.join("\n");
}

export function updateAiRuleState(
  db: AppDatabase,
  agentId: string,
  ruleId: string,
  patch: { enabled?: boolean; priorityOverride?: number | null }
): void {
  const row = db
    .prepare(
      `SELECT enabled, priority_override FROM ai_agent_rule_state WHERE agent_id = ? AND rule_id = ?`
    )
    .get(agentId, ruleId) as
    | { enabled: number; priority_override: number | null }
    | undefined;
  const enabled =
    patch.enabled === undefined ? (row?.enabled ?? 1) : patch.enabled ? 1 : 0;
  const pri =
    patch.priorityOverride === undefined
      ? (row?.priority_override ?? null)
      : patch.priorityOverride;
  db.prepare(
    `INSERT INTO ai_agent_rule_state (agent_id, rule_id, enabled, priority_override, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(agent_id, rule_id) DO UPDATE SET
       enabled = excluded.enabled,
       priority_override = excluded.priority_override,
       updated_at = datetime('now')`
  ).run(agentId, ruleId, enabled, pri);
}

/** Filesystem-safe rule id from a free-form name. */
export function slugRuleId(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "rule"
  );
}

/** Set the pending/active status of a rule for an agent (upsert). */
export function setAiRuleStatus(
  db: AppDatabase,
  agentId: string,
  ruleId: string,
  status: "active" | "pending"
): void {
  db.prepare(
    `INSERT INTO ai_agent_rule_state (agent_id, rule_id, enabled, status, updated_at)
     VALUES (?, ?, 1, ?, datetime('now'))
     ON CONFLICT(agent_id, rule_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`
  ).run(agentId, ruleId, status);
}

export interface CreateRuleInput {
  name: string;
  description: string;
  body: string;
  globs?: string[];
  departments?: string[];
  alwaysApply?: boolean;
  priority?: number;
}

/**
 * Write a new file-backed rule (.mdc with frontmatter) and register it for an
 * agent with the given status. Returns the resolved rule id. Throws if a rule
 * with the same id already exists.
 */
export function createRuleFile(
  db: AppDatabase,
  agentId: string,
  input: CreateRuleInput,
  status: "active" | "pending" = "pending"
): string {
  const id = slugRuleId(input.name);
  const existing = db.prepare(`SELECT id FROM ai_rules WHERE id = ?`).get(id);
  if (existing) throw new Error(`Rule already exists: ${id}`);
  const globs = input.globs ?? [];
  const departments = input.departments ?? [];
  const alwaysApply =
    input.alwaysApply ?? (globs.length === 0 && departments.length === 0);
  upsertRuleInDb(db, agentId, {
    id,
    description: input.description,
    body: input.body.trim(),
    alwaysApply,
    globs,
    departments,
    priority: input.priority ?? 50,
    enabled: true,
    status,
  });
  setAiRuleStatus(db, agentId, id, status);
  return id;
}

/** Delete a rule and its per-agent state (used to reject drafts). */
export function deleteRuleFile(db: AppDatabase, ruleId: string): boolean {
  const r = db.prepare(`DELETE FROM ai_rules WHERE id = ?`).run(ruleId);
  db.prepare(`DELETE FROM ai_agent_rule_state WHERE rule_id = ?`).run(ruleId);
  const file = path.join(rulesDir(), `${ruleId}.mdc`);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  return r.changes > 0;
}
