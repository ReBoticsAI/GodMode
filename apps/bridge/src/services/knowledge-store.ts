import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";
import { parseListField } from "./ai-skills.js";
import type { AiRule } from "./ai-rules.js";
import type { AiSkill } from "./ai-skills.js";
import { isOperatorTenantDb, isPersonalTenantDb } from "./tenant-kind.js";
import { updateAgent, getAgent } from "./agents/agents-db.js";
import {
  personalIntelligenceToolNames,
  isPersonalExcludedTool,
} from "./ai-tools-registry.js";
import {
  PERSONAL_BOOTSTRAP_RULE_IDS,
  PERSONAL_BOOTSTRAP_SKILL_IDS,
  RETIRED_PERSONAL_BOOTSTRAP_RULE_IDS,
  RETIRED_PERSONAL_BOOTSTRAP_SKILL_IDS,
} from "./personal-os-structure-manifest.js";

export { isOperatorTenantDb, isPersonalTenantDb } from "./tenant-kind.js";

function rulesDir(): string {
  return path.join(config.repoRoot, "apps", "bridge", "data", "ai", "rules");
}

function bootstrapRulesDir(): string {
  return path.join(config.repoRoot, "apps", "bridge", "data", "ai", "rules-bootstrap");
}

function skillsDir(): string {
  return path.join(config.repoRoot, "apps", "bridge", "data", "ai", "skills");
}

function bootstrapSkillsDir(): string {
  return path.join(config.repoRoot, "apps", "bridge", "data", "ai", "skills-bootstrap");
}

function parseMdc(content: string, filename: string) {
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
    if (departments.length > 0 && !/alwaysApply:/i.test(header)) alwaysApply = false;
  }
  return { id, description, body, alwaysApply, globs, departments, priority };
}

function parseSkillMd(content: string, skillId: string) {
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
  return { id: skillId, name, description, tools, departments, body };
}

const importedDbs = new WeakSet<AppDatabase>();

export function ensureKnowledgeImported(db: AppDatabase): void {
  if (importedDbs.has(db)) return;
  importedDbs.add(db);
  repairPersonalTenantDefaults(db);
  importRulesFromFiles(db);
  importSkillsFromFiles(db);
  purgeLegacyCursorUserImport(db);
  syncPersonalBootstrapKnowledge(db);
}

/** Remove obsolete host Cursor-user import rows (feature removed). */
function purgeLegacyCursorUserImport(db: AppDatabase): void {
  const ruleRows = db
    .prepare(`SELECT id FROM ai_rules WHERE source_plugin_id = '__cursor_user__'`)
    .all() as Array<{ id: string }>;
  for (const row of ruleRows) {
    db.prepare(`DELETE FROM ai_agent_rule_state WHERE rule_id = ?`).run(row.id);
  }
  db.prepare(`DELETE FROM ai_rules WHERE source_plugin_id = '__cursor_user__'`).run();
  const skillRows = db
    .prepare(`SELECT id FROM ai_skills WHERE source_plugin_id = '__cursor_user__'`)
    .all() as Array<{ id: string }>;
  for (const row of skillRows) {
    db.prepare(`DELETE FROM ai_agent_skill_state WHERE skill_id = ?`).run(row.id);
  }
  db.prepare(`DELETE FROM ai_skills WHERE source_plugin_id = '__cursor_user__'`).run();
}

function personalTenantHasLeakedRules(db: AppDatabase): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM ai_rules
     WHERE departments_json != '[]'
        OR id GLOB 'dept-*'
        OR id GLOB 'div-*'
        OR id GLOB 'page-*'
        OR id IN ('order-safety', 'trading-pages')`
  ).get() as { c: number };
  return row.c > 0;
}

/** Operator-only domain skills — never on personal workspaces. */
const OPERATOR_ONLY_SKILL_IDS = ["deploy-playbook", "optimize-playbook"] as const;

function removeLeakedPersonalSkills(db: AppDatabase): void {
  const placeholders = OPERATOR_ONLY_SKILL_IDS.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM ai_agent_skill_state
     WHERE skill_id IN (
       SELECT id FROM ai_skills
       WHERE departments_json != '[]' OR id IN (${placeholders})
     )`
  ).run(...OPERATOR_ONLY_SKILL_IDS);
  db.prepare(
    `DELETE FROM ai_skills
     WHERE departments_json != '[]' OR id IN (${placeholders})`
  ).run(...OPERATOR_ONLY_SKILL_IDS);
}

/** Remove operator-scoped rules/skills wrongly imported into a personal tenant DB. */
function repairPersonalTenantKnowledge(db: AppDatabase): void {
  if (isOperatorTenantDb(db)) return;

  if (personalTenantHasLeakedRules(db)) {
    db.prepare(`DELETE FROM ai_agent_rule_state`).run();
    db.prepare(`DELETE FROM ai_rules`).run();
  }

  removeLeakedPersonalSkills(db);
}

/**
 * Merge registry defaults into an existing Intelligence allowlist.
 * Adds newly registered personal tools; strips trading/excluded tools.
 * Does not remove intentionally kept names that are still valid.
 */
export function mergeIntelligenceToolAllowWithRegistry(
  existing: string[]
): string[] {
  const merged = new Set(
    existing.filter((name) => name && !isPersonalExcludedTool(name))
  );
  for (const name of personalIntelligenceToolNames()) {
    if (!isPersonalExcludedTool(name)) merged.add(name);
  }
  return [...merged].sort();
}

function intelligenceToolAllowNeedsRepair(db: AppDatabase): boolean {
  const intel = getAgent(db, "intelligence");
  if (!intel) return false;
  const allow = intel.toolAllow;
  // null → seed full defaults. [] → explicit lockdown; leave alone.
  if (allow === null || allow === undefined) return true;
  if (allow.length === 0) return false;
  if (allow.some((name) => isPersonalExcludedTool(name))) return true;
  // Stale snapshot: registry grew (e.g. git_clone) but agent allowlist did not.
  const defaults = personalIntelligenceToolNames();
  return defaults.some((name) => !allow.includes(name));
}

/** Full personal-tenant defaults repair: knowledge, tools, bootstrap sync. */
export function repairPersonalTenantDefaults(db: AppDatabase): void {
  if (isOperatorTenantDb(db)) return;
  repairPersonalTenantKnowledge(db);
  if (!intelligenceToolAllowNeedsRepair(db)) return;
  const intel = getAgent(db, "intelligence");
  if (!intel) return;
  const allow = intel.toolAllow;
  if (allow === null || allow === undefined) {
    updateAgent(db, "intelligence", {
      toolAllow: personalIntelligenceToolNames(),
    });
    return;
  }
  if (allow.length === 0) return;
  updateAgent(db, "intelligence", {
    toolAllow: mergeIntelligenceToolAllowWithRegistry(allow),
  });
}

/**
 * After a mid-session plugin install/reload, merge live registry + plugin tools
 * into personal Intelligence toolAllow so the next schema build can see them (#645).
 */
export function refreshIntelligenceToolsAfterPluginInstall(db: AppDatabase): void {
  repairPersonalTenantDefaults(db);
}

export function syncPersonalBootstrapKnowledge(db: AppDatabase): void {
  if (isOperatorTenantDb(db)) return;
  syncBootstrapRules(db);
  syncBootstrapSkills(db);
}

function syncBootstrapRules(db: AppDatabase): void {
  const dir = bootstrapRulesDir();
  if (!fs.existsSync(dir)) return;
  for (const ruleId of PERSONAL_BOOTSTRAP_RULE_IDS) {
    const filePath = path.join(dir, `${ruleId}.mdc`);
    if (!fs.existsSync(filePath)) continue;
    upsertBootstrapRuleFromFile(db, filePath, `${ruleId}.mdc`);
  }
  for (const ruleId of RETIRED_PERSONAL_BOOTSTRAP_RULE_IDS) {
    const row = db
      .prepare(`SELECT user_edited, source_plugin_id FROM ai_rules WHERE id = ?`)
      .get(ruleId) as
      | { user_edited: number; source_plugin_id: string | null }
      | undefined;
    if (!row) continue;
    // Keep user edits and pack-owned rows (e.g. coding-conventions ui-shadcn).
    if (Number(row.user_edited) !== 0) continue;
    if (row.source_plugin_id != null && String(row.source_plugin_id).trim() !== "") {
      continue;
    }
    db.prepare(`DELETE FROM ai_agent_rule_state WHERE rule_id = ?`).run(ruleId);
    db.prepare(`DELETE FROM ai_rules WHERE id = ?`).run(ruleId);
  }
}

function syncBootstrapSkills(db: AppDatabase): void {
  const dir = bootstrapSkillsDir();
  if (!fs.existsSync(dir)) return;
  for (const skillId of PERSONAL_BOOTSTRAP_SKILL_IDS) {
    const skillPath = path.join(dir, skillId, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf8");
    const parsed = parseSkillMd(raw, skillId);
    const edited = db
      .prepare(`SELECT user_edited FROM ai_skills WHERE id = ?`)
      .get(skillId) as { user_edited: number } | undefined;
    if (edited && Number(edited.user_edited) !== 0) continue;
    upsertSkillInDb(db, "intelligence", {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      tools: parsed.tools,
      departments: parsed.departments,
      enabled: true,
      status: "active",
    });
  }
  for (const skillId of [
    ...RETIRED_PERSONAL_BOOTSTRAP_SKILL_IDS,
    ...OPERATOR_ONLY_SKILL_IDS,
  ]) {
    const edited = db
      .prepare(`SELECT user_edited FROM ai_skills WHERE id = ?`)
      .get(skillId) as { user_edited: number } | undefined;
    if (edited && Number(edited.user_edited) !== 0) continue;
    db.prepare(`DELETE FROM ai_agent_skill_state WHERE skill_id = ?`).run(skillId);
    db.prepare(`DELETE FROM ai_skills WHERE id = ?`).run(skillId);
  }
}

function insertRuleFromFile(
  db: AppDatabase,
  filePath: string,
  filename: string
): void {
  const parsed = parseMdc(fs.readFileSync(filePath, "utf8"), filename);
  const st = db
    .prepare(
      `SELECT enabled, priority_override, status FROM ai_agent_rule_state
       WHERE agent_id = 'intelligence' AND rule_id = ?`
    )
    .get(parsed.id) as
    | { enabled: number; priority_override: number | null; status: string | null }
    | undefined;
  db.prepare(
    `INSERT OR IGNORE INTO ai_rules
     (id, agent_id, description, body, always_apply, globs_json, departments_json, priority, enabled, status)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, ?, 1, 'active')`
  ).run(
    parsed.id,
    parsed.description,
    parsed.body,
    parsed.alwaysApply ? 1 : 0,
    JSON.stringify(parsed.globs),
    JSON.stringify(parsed.departments),
    st?.priority_override ?? parsed.priority
  );
}

/** Upsert bootstrap rules for personal tenants; skip rows the user edited. */
function upsertBootstrapRuleFromFile(
  db: AppDatabase,
  filePath: string,
  filename: string
): void {
  const parsed = parseMdc(fs.readFileSync(filePath, "utf8"), filename);
  const existing = db
    .prepare(`SELECT user_edited FROM ai_rules WHERE id = ?`)
    .get(parsed.id) as { user_edited: number } | undefined;
  if (existing && Number(existing.user_edited) !== 0) return;
  const st = db
    .prepare(
      `SELECT enabled, priority_override, status FROM ai_agent_rule_state
       WHERE agent_id = 'intelligence' AND rule_id = ?`
    )
    .get(parsed.id) as
    | { enabled: number; priority_override: number | null; status: string | null }
    | undefined;
  db.prepare(
    `INSERT INTO ai_rules
     (id, agent_id, description, body, always_apply, globs_json, departments_json, priority, enabled, status, updated_at)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, ?, 1, 'active', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       description=excluded.description,
       body=excluded.body,
       always_apply=excluded.always_apply,
       globs_json=excluded.globs_json,
       departments_json=excluded.departments_json,
       priority=excluded.priority,
       enabled=1,
       status='active',
       version=ai_rules.version+1,
       updated_at=datetime('now')
     WHERE COALESCE(ai_rules.user_edited, 0) = 0`
  ).run(
    parsed.id,
    parsed.description,
    parsed.body,
    parsed.alwaysApply ? 1 : 0,
    JSON.stringify(parsed.globs),
    JSON.stringify(parsed.departments),
    st?.priority_override ?? parsed.priority
  );
}

function importRulesFromDir(db: AppDatabase, dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mdc"))) {
    insertRuleFromFile(db, path.join(dir, file), file);
  }
}

function importRulesFromFiles(db: AppDatabase): void {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM ai_rules`).get() as { c: number };
  if (count.c > 0) return;

  if (isOperatorTenantDb(db)) {
    importRulesFromDir(db, rulesDir());
  }
  // Personal (and first-touch operator empty DB): only the lean bootstrap set.
  for (const ruleId of PERSONAL_BOOTSTRAP_RULE_IDS) {
    const filePath = path.join(bootstrapRulesDir(), `${ruleId}.mdc`);
    if (!fs.existsSync(filePath)) continue;
    insertRuleFromFile(db, filePath, `${ruleId}.mdc`);
  }
}

function importSkillsFromFiles(db: AppDatabase): void {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM ai_skills`).get() as { c: number };
  if (count.c > 0) return;

  if (isOperatorTenantDb(db)) {
    importSkillsFromDir(db, skillsDir());
  }
  // Bootstrap skills: only the personal allowlist (extra folders on disk are ignored).
  const dir = bootstrapSkillsDir();
  if (!fs.existsSync(dir)) return;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO ai_skills
     (id, agent_id, name, description, body, tools_json, departments_json, enabled, status)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, 1, 'active')`
  );
  for (const skillId of PERSONAL_BOOTSTRAP_SKILL_IDS) {
    const skillPath = path.join(dir, skillId, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const parsed = parseSkillMd(fs.readFileSync(skillPath, "utf8"), skillId);
    ins.run(
      parsed.id,
      parsed.name,
      parsed.description,
      parsed.body,
      JSON.stringify(parsed.tools),
      JSON.stringify(parsed.departments)
    );
  }
}

function importSkillsFromDir(db: AppDatabase, dir: string): void {
  if (!fs.existsSync(dir)) return;
  const operator = isOperatorTenantDb(db);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO ai_skills
     (id, agent_id, name, description, body, tools_json, departments_json, enabled, status)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, 1, 'active')`
  );
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(dir, ent.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf8");
    const parsed = parseSkillMd(raw, ent.name);
    if (!operator) {
      if (parsed.departments.length > 0) continue;
      if ((OPERATOR_ONLY_SKILL_IDS as readonly string[]).includes(parsed.id)) continue;
    }
    ins.run(
      parsed.id,
      parsed.name,
      parsed.description,
      parsed.body,
      JSON.stringify(parsed.tools),
      JSON.stringify(parsed.departments)
    );
  }
}

export function listRulesFromDb(
  db: AppDatabase,
  agentId = "intelligence"
): AiRule[] {
  ensureKnowledgeImported(db);
  const rows = db
    .prepare(
      `SELECT r.*, s.enabled AS st_enabled, s.priority_override, s.status AS st_status
       FROM ai_rules r
       LEFT JOIN ai_agent_rule_state s ON s.rule_id = r.id AND s.agent_id = ?
       WHERE r.agent_id = ? OR r.agent_id = 'intelligence'
       ORDER BY COALESCE(s.priority_override, r.priority), r.id`
    )
    .all(agentId, agentId) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    // Fallback: legacy file scan handled by ai-rules.ts until import runs
    return [];
  }

  return rows.map((r) => ({
    id: String(r.id),
    description: String(r.description),
    body: String(r.body),
    alwaysApply: Boolean(r.always_apply),
    globs: JSON.parse(String(r.globs_json ?? "[]")) as string[],
    departments: JSON.parse(String(r.departments_json ?? "[]")) as string[],
    priority: Number(r.priority_override ?? r.priority ?? 50),
    // LEFT JOIN yields null (not undefined) when no agent state row exists.
    enabled:
      r.st_enabled != null ? Number(r.st_enabled) !== 0 : Boolean(r.enabled),
    status: (r.st_status === "pending" || r.status === "pending"
      ? "pending"
      : "active") as "active" | "pending",
    agentId: String(r.agent_id ?? "intelligence"),
    version: r.version != null ? Number(r.version) : undefined,
    updatedAt: r.updated_at != null ? String(r.updated_at) : undefined,
    sourcePluginId:
      r.source_plugin_id != null ? String(r.source_plugin_id) : null,
    userEdited: Number(r.user_edited ?? 0) !== 0,
  }));
}

export function listSkillsFromDb(
  db: AppDatabase,
  includeBody: boolean,
  agentId = "intelligence"
): AiSkill[] {
  ensureKnowledgeImported(db);
  const rows = db
    .prepare(
      `SELECT sk.*, s.enabled AS st_enabled, s.status AS st_status
       FROM ai_skills sk
       LEFT JOIN ai_agent_skill_state s ON s.skill_id = sk.id AND s.agent_id = ?
       WHERE sk.agent_id = ? OR sk.agent_id = 'intelligence'
       ORDER BY sk.name`
    )
    .all(agentId, agentId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    tools: JSON.parse(String(r.tools_json ?? "[]")) as string[],
    departments: JSON.parse(String(r.departments_json ?? "[]")) as string[],
    enabled:
      r.st_enabled != null ? Number(r.st_enabled) !== 0 : Boolean(r.enabled),
    status: (r.st_status === "pending" || r.status === "pending"
      ? "pending"
      : "active") as "active" | "pending",
    body: includeBody ? String(r.body) : undefined,
    agentId: String(r.agent_id ?? "intelligence"),
    version: r.version != null ? Number(r.version) : undefined,
    updatedAt: r.updated_at != null ? String(r.updated_at) : undefined,
    sourcePluginId:
      r.source_plugin_id != null ? String(r.source_plugin_id) : null,
    userEdited: Number(r.user_edited ?? 0) !== 0,
  }));
}

export function upsertRuleInDb(
  db: AppDatabase,
  agentId: string,
  rule: Omit<AiRule, "enabled" | "status"> & { enabled?: boolean; status?: string }
): void {
  db.prepare(
    `INSERT INTO ai_rules (id, agent_id, description, body, always_apply, globs_json, departments_json, priority, enabled, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       description=excluded.description, body=excluded.body, always_apply=excluded.always_apply,
       globs_json=excluded.globs_json, departments_json=excluded.departments_json,
       priority=excluded.priority, enabled=excluded.enabled, status=excluded.status,
       version=ai_rules.version+1, updated_at=datetime('now')`
  ).run(
    rule.id,
    agentId,
    rule.description,
    rule.body,
    rule.alwaysApply ? 1 : 0,
    JSON.stringify(rule.globs),
    JSON.stringify(rule.departments),
    rule.priority,
    rule.enabled !== false ? 1 : 0,
    rule.status ?? "active"
  );
}

export function upsertSkillInDb(
  db: AppDatabase,
  agentId: string,
  skill: {
    id: string;
    name: string;
    description: string;
    body: string;
    tools: string[];
    departments: string[];
    enabled?: boolean;
    status?: string;
  }
): void {
  db.prepare(
    `INSERT INTO ai_skills (id, agent_id, name, description, body, tools_json, departments_json, enabled, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, description=excluded.description, body=excluded.body,
       tools_json=excluded.tools_json, departments_json=excluded.departments_json,
       enabled=excluded.enabled, status=excluded.status,
       version=ai_skills.version+1, updated_at=datetime('now')`
  ).run(
    skill.id,
    agentId,
    skill.name,
    skill.description,
    skill.body,
    JSON.stringify(skill.tools),
    JSON.stringify(skill.departments),
    skill.enabled !== false ? 1 : 0,
    skill.status ?? "active"
  );
}

export function savePromptInDb(
  db: AppDatabase,
  agentId: string,
  kind: string,
  content: string,
  label?: string
): string {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_prompts (id, agent_id, kind, label, content)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, agentId, kind, label ?? null, content);
  return id;
}

export function getLatestPrompt(
  db: AppDatabase,
  agentId: string,
  kind: string
): string | null {
  const row = db
    .prepare(
      `SELECT content FROM ai_prompts WHERE agent_id = ? AND kind = ?
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(agentId, kind) as { content: string } | undefined;
  return row?.content ?? null;
}

function upsertRuleFromFile(
  db: AppDatabase,
  filePath: string,
  filename: string,
  sourcePluginId?: string
): void {
  const parsed = parseMdc(fs.readFileSync(filePath, "utf8"), filename);
  db.prepare(
    `INSERT INTO ai_rules
     (id, agent_id, description, body, always_apply, globs_json, departments_json, priority, enabled, status, source_plugin_id, updated_at)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, ?, 1, 'active', ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       description=excluded.description, body=excluded.body, always_apply=excluded.always_apply,
       globs_json=excluded.globs_json, departments_json=excluded.departments_json,
       priority=excluded.priority, source_plugin_id=excluded.source_plugin_id,
       version=ai_rules.version+1, updated_at=datetime('now')`
  ).run(
    parsed.id,
    parsed.description,
    parsed.body,
    parsed.alwaysApply ? 1 : 0,
    JSON.stringify(parsed.globs),
    JSON.stringify(parsed.departments),
    parsed.priority,
    sourcePluginId ?? null
  );
}

function upsertSkillFromDir(
  db: AppDatabase,
  skillPath: string,
  skillId: string,
  sourcePluginId: string
): void {
  const raw = fs.readFileSync(skillPath, "utf8");
  const parsed = parseSkillMd(raw, skillId);
  db.prepare(
    `INSERT INTO ai_skills
     (id, agent_id, name, description, body, tools_json, departments_json, enabled, status, source_plugin_id, updated_at)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, 1, 'active', ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, description=excluded.description, body=excluded.body,
       tools_json=excluded.tools_json, departments_json=excluded.departments_json,
       source_plugin_id=excluded.source_plugin_id,
       version=ai_skills.version+1, updated_at=datetime('now')`
  ).run(
    parsed.id,
    parsed.name,
    parsed.description,
    parsed.body,
    JSON.stringify(parsed.tools),
    JSON.stringify(parsed.departments),
    sourcePluginId
  );
}

/** Import or refresh plugin-shipped rules/skills from data/ai into the tenant DB. */
export function importPluginKnowledgeFromRoot(
  db: AppDatabase,
  pluginRoot: string,
  pluginId: string
): { rules: number; skills: number } {
  let rules = 0;
  let skills = 0;
  const rulesDir = path.join(path.resolve(pluginRoot), "data", "ai", "rules");
  if (fs.existsSync(rulesDir)) {
    for (const file of fs.readdirSync(rulesDir).filter((f) => f.endsWith(".mdc"))) {
      upsertRuleFromFile(db, path.join(rulesDir, file), file, pluginId);
      rules++;
    }
  }
  const skillsDir = path.join(path.resolve(pluginRoot), "data", "ai", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const skillPath = path.join(skillsDir, ent.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;
      upsertSkillFromDir(db, skillPath, ent.name, pluginId);
      skills++;
    }
  }
  return { rules, skills };
}

/** Remove knowledge rows owned by a plugin (on uninstall). */
export function removePluginKnowledge(db: AppDatabase, pluginId: string): void {
  const ruleIds = db
    .prepare(`SELECT id FROM ai_rules WHERE source_plugin_id = ?`)
    .all(pluginId) as Array<{ id: string }>;
  for (const row of ruleIds) {
    db.prepare(`DELETE FROM ai_agent_rule_state WHERE rule_id = ?`).run(row.id);
  }
  db.prepare(`DELETE FROM ai_rules WHERE source_plugin_id = ?`).run(pluginId);

  const skillIds = db
    .prepare(`SELECT id FROM ai_skills WHERE source_plugin_id = ?`)
    .all(pluginId) as Array<{ id: string }>;
  for (const row of skillIds) {
    db.prepare(`DELETE FROM ai_agent_skill_state WHERE skill_id = ?`).run(row.id);
  }
  db.prepare(`DELETE FROM ai_skills WHERE source_plugin_id = ?`).run(pluginId);
}

/**
 * Sentinel `source_plugin_id` for repo AGENTS.md + `.cursor/rules` +
 * `.cursor/skills` imports.
 */
export const CURSOR_WORKSPACE_SOURCE = "__cursor_workspace__";

const cursorWorkspaceSyncFp = new Map<string, string>();

/** Stable Knowledge ids for AGENTS.md surfaces (Cursor workspace instructions). */
export const CURSOR_WS_AGENTS_MD_ID = "cursor-ws-agents-md";
export const CURSOR_WS_DOT_CURSOR_AGENTS_MD_ID = "cursor-ws-dot-cursor-agents-md";

function walkMdcFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkMdcFiles(abs, base));
    } else if (ent.isFile() && ent.name.endsWith(".mdc")) {
      out.push(abs);
    }
  }
  return out;
}

function cursorRuleIdFromPath(
  rulesRoot: string,
  filePath: string,
  idPrefix: string
): string {
  const rel = path
    .relative(rulesRoot, filePath)
    .replace(/\\/g, "/")
    .replace(/\.mdc$/i, "");
  const slug = rel
    .split("/")
    .map((p) => p.replace(/[^a-zA-Z0-9._-]+/g, "-"))
    .filter(Boolean)
    .join("--");
  return `${idPrefix}${slug || "rule"}`;
}

function pushMtimePart(parts: string[], filePath: string): void {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      parts.push(`${filePath}:${fs.statSync(filePath).mtimeMs}`);
    }
  } catch {
    /* ignore */
  }
}

function fingerprintCursorWorkspace(codingRoot: string): string {
  const parts: string[] = [];
  pushMtimePart(parts, path.join(codingRoot, "AGENTS.md"));
  const cursorDir = path.join(codingRoot, ".cursor");
  pushMtimePart(parts, path.join(cursorDir, "AGENTS.md"));
  if (fs.existsSync(cursorDir) && fs.statSync(cursorDir).isDirectory()) {
    const rulesDir = path.join(cursorDir, "rules");
    for (const file of walkMdcFiles(rulesDir)) {
      try {
        parts.push(`${file}:${fs.statSync(file).mtimeMs}`);
      } catch {
        /* ignore */
      }
    }
    const skillsDir = path.join(cursorDir, "skills");
    if (fs.existsSync(skillsDir)) {
      for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const skillPath = path.join(skillsDir, ent.name, "SKILL.md");
        if (!fs.existsSync(skillPath)) continue;
        try {
          parts.push(`${skillPath}:${fs.statSync(skillPath).mtimeMs}`);
        } catch {
          /* ignore */
        }
      }
    }
  }
  parts.sort();
  return parts.join("|");
}

function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

function upsertImportedRule(
  db: AppDatabase,
  sourcePluginId: string,
  id: string,
  description: string,
  body: string,
  alwaysApply: boolean,
  globs: string[],
  departments: string[],
  priority: number
): boolean {
  const hash = contentHash(body);
  const existing = db
    .prepare(
      `SELECT user_edited FROM ai_rules WHERE id = ? AND source_plugin_id = ?`
    )
    .get(id, sourcePluginId) as { user_edited: number } | undefined;
  if (existing && Number(existing.user_edited) !== 0) {
    return false;
  }
  db.prepare(
    `INSERT INTO ai_rules
     (id, agent_id, description, body, always_apply, globs_json, departments_json, priority, enabled, status, source_plugin_id, content_hash, user_edited, updated_at)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, 0, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       description=excluded.description, body=excluded.body, always_apply=excluded.always_apply,
       globs_json=excluded.globs_json, departments_json=excluded.departments_json,
       priority=excluded.priority, source_plugin_id=excluded.source_plugin_id,
       content_hash=excluded.content_hash,
       version=ai_rules.version+1, updated_at=datetime('now')
     WHERE COALESCE(ai_rules.user_edited, 0) = 0`
  ).run(
    id,
    description,
    body,
    alwaysApply ? 1 : 0,
    JSON.stringify(globs),
    JSON.stringify(departments),
    priority,
    sourcePluginId,
    hash
  );
  return true;
}

function upsertImportedSkill(
  db: AppDatabase,
  sourcePluginId: string,
  id: string,
  name: string,
  description: string,
  body: string,
  tools: string[],
  departments: string[]
): boolean {
  const hash = contentHash(body);
  const existing = db
    .prepare(
      `SELECT user_edited FROM ai_skills WHERE id = ? AND source_plugin_id = ?`
    )
    .get(id, sourcePluginId) as { user_edited: number } | undefined;
  if (existing && Number(existing.user_edited) !== 0) {
    return false;
  }
  db.prepare(
    `INSERT INTO ai_skills
     (id, agent_id, name, description, body, tools_json, departments_json, enabled, status, source_plugin_id, content_hash, user_edited, updated_at)
     VALUES (?, 'intelligence', ?, ?, ?, ?, ?, 1, 'active', ?, ?, 0, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, description=excluded.description, body=excluded.body,
       tools_json=excluded.tools_json, departments_json=excluded.departments_json,
       source_plugin_id=excluded.source_plugin_id, content_hash=excluded.content_hash,
       version=ai_skills.version+1, updated_at=datetime('now')
     WHERE COALESCE(ai_skills.user_edited, 0) = 0`
  ).run(
    id,
    name,
    description,
    body,
    JSON.stringify(tools),
    JSON.stringify(departments),
    sourcePluginId,
    hash
  );
  return true;
}

function importAgentsMdFile(
  db: AppDatabase,
  filePath: string,
  id: string,
  description: string
): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const body = fs.readFileSync(filePath, "utf8").trim();
  if (!body) return false;
  return upsertImportedRule(
    db,
    CURSOR_WORKSPACE_SOURCE,
    id,
    description,
    body,
    true,
    [],
    [],
    45
  );
}

/**
 * Import coding-root AGENTS.md, .cursor rules (mdc files, recursive), and
 * skill SKILL.md folders into the tenant knowledge DB for local/provider
 * backends. IDs are prefixed to avoid colliding with GodMode core rules.
 * Skipped for cursor_cloud agents (SDK settingSources loads project
 * instructions instead). Does not overwrite rows marked user_edited.
 */
export function importCursorWorkspaceKnowledge(
  db: AppDatabase,
  codingRoot: string
): { rules: number; skills: number; ruleIds: string[]; skillIds: string[] } {
  const root = path.resolve(codingRoot);
  const cursorDir = path.join(root, ".cursor");
  let rules = 0;
  let skills = 0;
  const ruleIds: string[] = [];
  const skillIds: string[] = [];

  if (
    importAgentsMdFile(
      db,
      path.join(root, "AGENTS.md"),
      CURSOR_WS_AGENTS_MD_ID,
      "Workspace AGENTS.md"
    )
  ) {
    rules++;
    ruleIds.push(CURSOR_WS_AGENTS_MD_ID);
  } else if (fs.existsSync(path.join(root, "AGENTS.md"))) {
    ruleIds.push(CURSOR_WS_AGENTS_MD_ID);
  }
  if (
    importAgentsMdFile(
      db,
      path.join(cursorDir, "AGENTS.md"),
      CURSOR_WS_DOT_CURSOR_AGENTS_MD_ID,
      "Workspace .cursor/AGENTS.md"
    )
  ) {
    rules++;
    ruleIds.push(CURSOR_WS_DOT_CURSOR_AGENTS_MD_ID);
  } else if (fs.existsSync(path.join(cursorDir, "AGENTS.md"))) {
    ruleIds.push(CURSOR_WS_DOT_CURSOR_AGENTS_MD_ID);
  }

  const rulesDir = path.join(cursorDir, "rules");
  for (const file of walkMdcFiles(rulesDir)) {
    const parsed = parseMdc(fs.readFileSync(file, "utf8"), path.basename(file));
    const id = cursorRuleIdFromPath(rulesDir, file, "cursor-ws-");
    ruleIds.push(id);
    if (
      upsertImportedRule(
        db,
        CURSOR_WORKSPACE_SOURCE,
        id,
        parsed.description,
        parsed.body,
        parsed.alwaysApply,
        parsed.globs,
        parsed.departments,
        parsed.priority
      )
    ) {
      rules++;
    }
  }

  const skillsDir = path.join(cursorDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const skillPath = path.join(skillsDir, ent.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;
      const parsed = parseSkillMd(fs.readFileSync(skillPath, "utf8"), ent.name);
      const id = `cursor-ws-skill-${ent.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
      skillIds.push(id);
      if (
        upsertImportedSkill(
          db,
          CURSOR_WORKSPACE_SOURCE,
          id,
          parsed.name,
          parsed.description,
          parsed.body,
          parsed.tools,
          parsed.departments
        )
      ) {
        skills++;
      }
    }
  }

  return { rules, skills, ruleIds, skillIds };
}

/**
 * Refresh workspace Cursor knowledge when AGENTS.md / `.cursor/` mtimes change.
 * Non-destructive: never deletes or overwrites user-edited workspace rows.
 */
export function syncCursorWorkspaceKnowledge(
  db: AppDatabase,
  codingRoot: string,
  opts?: { force?: boolean }
): { rules: number; skills: number; synced: boolean } {
  const root = path.resolve(codingRoot);
  const key = `${root}`;
  const fp = fingerprintCursorWorkspace(root);
  if (!opts?.force && cursorWorkspaceSyncFp.get(key) === fp) {
    return { rules: 0, skills: 0, synced: false };
  }

  if (!fp) {
    // Remove only non-edited workspace imports when disk artifacts disappear.
    pruneMissingImportedKnowledge(db, CURSOR_WORKSPACE_SOURCE, [], []);
    cursorWorkspaceSyncFp.set(key, "");
    return { rules: 0, skills: 0, synced: true };
  }

  const result = importCursorWorkspaceKnowledge(db, root);
  pruneMissingImportedKnowledge(
    db,
    CURSOR_WORKSPACE_SOURCE,
    result.ruleIds,
    result.skillIds
  );
  cursorWorkspaceSyncFp.set(key, fp);
  return {
    rules: result.rules,
    skills: result.skills,
    synced: true,
  };
}

/** Drop imported rows that vanished from disk, keeping user-edited rows. */
function pruneMissingImportedKnowledge(
  db: AppDatabase,
  sourcePluginId: string,
  keepRuleIds: string[],
  keepSkillIds: string[]
): void {
  const keepRules = new Set(keepRuleIds);
  const keepSkills = new Set(keepSkillIds);
  const ruleRows = db
    .prepare(
      `SELECT id, user_edited FROM ai_rules WHERE source_plugin_id = ?`
    )
    .all(sourcePluginId) as Array<{ id: string; user_edited: number }>;
  for (const row of ruleRows) {
    if (keepRules.has(row.id)) continue;
    if (Number(row.user_edited) !== 0) continue;
    db.prepare(`DELETE FROM ai_agent_rule_state WHERE rule_id = ?`).run(row.id);
    db.prepare(`DELETE FROM ai_rules WHERE id = ?`).run(row.id);
  }
  const skillRows = db
    .prepare(
      `SELECT id, user_edited FROM ai_skills WHERE source_plugin_id = ?`
    )
    .all(sourcePluginId) as Array<{ id: string; user_edited: number }>;
  for (const row of skillRows) {
    if (keepSkills.has(row.id)) continue;
    if (Number(row.user_edited) !== 0) continue;
    db.prepare(`DELETE FROM ai_agent_skill_state WHERE skill_id = ?`).run(row.id);
    db.prepare(`DELETE FROM ai_skills WHERE id = ?`).run(row.id);
  }
}

/** @internal test helper */
export function clearCursorWorkspaceSyncCacheForTests(): void {
  cursorWorkspaceSyncFp.clear();
}
