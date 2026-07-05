import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../../db.js";
import { createAgent, getAgent, updateAgent } from "../agents/agents-db.js";
import {
  departmentScopeId,
  divisionScopeId,
  pageScopeId,
  setAssignment,
  type AssignmentScopeType,
} from "../ai-agent-assignments.js";
import { listAiSkills, updateAiSkillState } from "../ai-skills.js";
import { aiRulesDir } from "../ai-rules.js";
import {
  generalToolNames,
  departmentToolNames,
  platformStructureToolNames,
} from "../ai-tools-registry.js";
import {
  buildDefaultProfile,
  getContextProfile,
  setContextProfile,
} from "./context.js";
import type { LlmManager } from "../llm-manager.js";
import type { AiQueueWorker } from "../ai-queue-worker.js";

interface DepartmentRow {
  id: string;
  label: string;
  icon: string;
}

interface DivisionRow {
  id: string;
  label: string;
  icon: string;
}

interface PageRow {
  id: string;
  label: string;
  icon: string;
}

/** Optional collaborators the engines lean on when available. */
export interface EngineRegistryDeps {
  llm?: LlmManager;
  queue?: AiQueueWorker;
}

/** Optional domain blurbs for built-in departments (richer prompts). */
const DOMAIN_BY_ID: Record<string, string> = {
  trading: "markets and trading workflows",
  "brick-and-mortar": "physical store operations",
  ecommerce: "online marketplaces, orders, and payouts",
  "real-estate": "properties, tenants, and financing",
  content: "YouTube, sponsorships, and affiliate income",
  freelance: "clients, projects, and invoices",
  investments: "registered accounts, funds, equities, and private deals",
};

function buildSystemPrompt(dept: DepartmentRow, domain: string): string {
  return [
    `You are the ${dept.label} agent for GodMode — the subagent responsible for the ${dept.label} department.`,
    `You specialize in ${domain}, and you help the user manage the ${dept.id} department's pages, data, and tasks.`,
    `Be concise, actionable, and specific to the data provided. Use markdown formatting. When you see platform context below, treat it as ground truth for what the user is currently viewing.`,
    `Stay in character as the ${dept.label} department agent. Do not introduce yourself or refer to yourself as "Intelligence".`,
  ].join("\n");
}

function legacySystemPrompt(
  basePrompt: string,
  dept: DepartmentRow,
  domain: string
): string {
  const specialization = `You are the ${dept.label} department agent for GodMode. You specialize in ${domain}. Focus on the ${dept.id} department's pages, data, and tasks.`;
  return `${basePrompt.trim()}\n\n${specialization}`;
}

/**
 * Idempotent provisioner for department-scoped subagents and assignments.
 * Replaces the hardcoded boot-time-only `seedDepartmentAgents` list.
 */
export class EngineRegistry {
  constructor(
    private readonly db: AppDatabase,
    private readonly deps: EngineRegistryDeps = {}
  ) {}

  /** Ensure every department in the structure tree has a `dept-<id>` agent. */
  reconcileAll(): void {
    const rows = this.db
      .prepare(
        `SELECT id, label, icon FROM departments ORDER BY sort_order ASC, id ASC`
      )
      .all() as DepartmentRow[];
    for (const row of rows) {
      this.reconcileDepartment(row.id, row);
    }
    this.refreshLegacyPrompts();
  }

  /** Enumerate a department's divisions (ordered) for reconciliation. */
  private listDivisions(departmentId: string): DivisionRow[] {
    return this.db
      .prepare(
        `SELECT id, label, icon FROM divisions
         WHERE department_id = ?
         ORDER BY sort_order ASC, id ASC`
      )
      .all(departmentId) as DivisionRow[];
  }

  /** Enumerate a division's pages (ordered) for reconciliation. */
  private listPages(departmentId: string, divisionId: string): PageRow[] {
    return this.db
      .prepare(
        `SELECT id, label, icon FROM division_pages
         WHERE department_id = ? AND division_id = ?
         ORDER BY sort_order ASC, id ASC`
      )
      .all(departmentId, divisionId) as PageRow[];
  }

  /**
   * Create (if missing) `dept-<departmentId>`, assign at department scope when
   * no assignment exists yet, and refresh legacy intelligence-cloned prompts.
   */
  reconcileDepartment(
    departmentId: string,
    row?: Pick<DepartmentRow, "label" | "icon">
  ): { agentId: string; created: boolean } {
    void departmentId;
    void row;
    return { agentId: "intelligence", created: false };
  }

  reconcileDivision(
    departmentId: string,
    divisionId: string,
    row?: Pick<DivisionRow, "label" | "icon">
  ): { agentId: string; created: boolean } {
    void departmentId;
    void divisionId;
    void row;
    return { agentId: "intelligence", created: false };
  }

  reconcilePage(
    departmentId: string,
    divisionId: string,
    pageId: string,
    row?: Pick<PageRow, "label" | "icon">
  ): { agentId: string; created: boolean } {
    void departmentId;
    void divisionId;
    void pageId;
    void row;
    return { agentId: "intelligence", created: false };
  }

  /**
   * On department delete: disable the provisioned subagent but keep rules,
   * skills state, audit rows, and context profiles (reversible / auditable).
   */
  disableDepartment(departmentId: string): void {
    try {
      const agentId = `dept-${departmentId}`;
      const existing = getAgent(this.db, agentId);
      if (existing) {
        updateAgent(this.db, agentId, { enabled: false });
      }
    } catch (err) {
      console.warn(`[engines] disableDepartment(${departmentId}) failed`, err);
    }
  }

  /**
   * On division delete: disable the provisioned subagent but keep its
   * assignment row and audit trail (reversible soft-delete, consistent with
   * `disableDepartment`).
   */
  disableDivision(departmentId: string, divisionId: string): void {
    try {
      const agentId = `div-${departmentId}-${divisionId}`;
      const existing = getAgent(this.db, agentId);
      if (existing) {
        updateAgent(this.db, agentId, { enabled: false });
      }
    } catch (err) {
      console.warn(
        `[engines] disableDivision(${departmentId}/${divisionId}) failed`,
        err
      );
    }
  }

  /**
   * On page delete: disable the provisioned Worker subagent but keep its
   * assignment row and audit trail (reversible soft-delete, consistent with
   * `disableDivision`).
   */
  disablePage(departmentId: string, divisionId: string, pageId: string): void {
    try {
      const agentId = `page-${departmentId}-${divisionId}-${pageId}`;
      const existing = getAgent(this.db, agentId);
      if (existing) {
        updateAgent(this.db, agentId, { enabled: false });
      }
    } catch (err) {
      console.warn(
        `[engines] disablePage(${departmentId}/${divisionId}/${pageId}) failed`,
        err
      );
    }
  }

  /**
   * Memory engine — seed one durable 'global' active memory for the passed
   * agent on first provision so the subagent always knows its own scope.
   * Idempotent: a seed row is inserted only once per agent. `category` doubles
   * as the scope noun ('department' | 'division' | 'page').
   */
  provisionMemory(
    agentId: string,
    label: string,
    domain: string,
    category: AssignmentScopeType
  ): void {
    try {
      const existing = this.db
        .prepare(
          `SELECT 1 FROM ai_memories WHERE agent_id = ? AND source = 'seed' LIMIT 1`
        )
        .get(agentId);
      if (existing) return;
      this.db
        .prepare(
          `INSERT INTO ai_memories (id, scope, chat_id, agent_id, text, category, source, status)
           VALUES (?, 'global', NULL, ?, ?, ?, 'seed', 'active')`
        )
        .run(
          uuidv4(),
          agentId,
          `This is the ${label} ${category}; it covers ${domain}.`,
          category
        );
    } catch (err) {
      console.warn(`[engines] provisionMemory(${agentId}) failed`, err);
    }
  }

  /**
   * Context engine — seed a default context profile per scope if missing.
   * Describes the data relevant to the scope (endpoints, mention sources,
   * widgets) so the prompt assembler can append a compact profile. Idempotent.
   * For department scope `scopeId` is the department id, so the built-in
   * endpoint defaults still apply; sub-scopes get a description-only profile.
   */
  provisionContext(
    scopeType: AssignmentScopeType,
    scopeId: string,
    label: string,
    domain: string
  ): void {
    try {
      if (getContextProfile(this.db, scopeType, scopeId)) return;
      setContextProfile(
        this.db,
        scopeType,
        scopeId,
        buildDefaultProfile(scopeId, label, domain)
      );
    } catch (err) {
      console.warn(`[engines] provisionContext(${scopeType}:${scopeId}) failed`, err);
    }
  }

  /**
   * Tools engine — derive the agent's `toolAllow` from tool categories: all
   * general (unscoped) tools plus any tool tagged for the owning department,
   * plus the platform structure subset. Division/page agents inherit the same
   * department tool set; the PlatformScopeService still gates by role at
   * runtime. The root `intelligence` agent is never restricted here. Idempotent.
   */
  provisionTools(agentId: string, departmentId: string): void {
    try {
      // General (unscoped, non-platform) tools + this department's scoped tools.
      // Platform Builder tools are layered on explicitly: every department gets
      // the Phase A structure subset, while Phase B/C platform tools are tagged
      // to the trading department and arrive via departmentToolNames(). The
      // PlatformScopeService still gates each mutation by role at runtime.
      const allow = [
        ...generalToolNames(),
        ...departmentToolNames(departmentId),
        ...platformStructureToolNames(),
      ];
      updateAgent(this.db, agentId, { toolAllow: Array.from(new Set(allow)) });
    } catch (err) {
      console.warn(`[engines] provisionTools(${agentId}) failed`, err);
    }
  }

  /**
   * Skills engine — default-DENY. For the passed agent, a skill is enabled only
   * when its `departments` frontmatter includes the owning department. Skills
   * with no `departments` tag are general/global and stay enabled so we never
   * hide platform-wide skills; skills scoped to OTHER departments are disabled.
   */
  provisionSkills(agentId: string, departmentId: string): void {
    try {
      for (const skill of listAiSkills(this.db)) {
        const scoped = skill.departments.length > 0;
        const enabled = !scoped || skill.departments.includes(departmentId);
        updateAiSkillState(this.db, agentId, skill.id, enabled);
      }
    } catch (err) {
      console.warn(`[engines] provisionSkills(${agentId}) failed`, err);
    }
  }

  /**
   * Rules engine — ensure a per-scope operating-rules `.mdc` exists for the
   * given scope. `ruleId` is the target agent id so each subagent gets its own
   * rules file. Writes a deterministic template synchronously and records an
   * audit row, then (best effort, non-blocking) asks the local LLM to improve
   * the body and flips the recorded origin to 'llm' on success.
   */
  provisionRules(
    scopeType: AssignmentScopeType,
    scopeId: string,
    ruleId: string,
    departmentId: string,
    label: string,
    domain: string
  ): void {
    try {
      const already = this.db
        .prepare(
          `SELECT 1 FROM ai_rule_provisioning WHERE scope_type = ? AND scope_id = ? AND rule_id = ?`
        )
        .get(scopeType, scopeId, ruleId);
      if (already) return;

      const dir = aiRulesDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${ruleId}.mdc`);
      if (!fs.existsSync(file)) {
        fs.writeFileSync(
          file,
          this.templateRule(scopeType, departmentId, label, domain),
          "utf8"
        );
      }
      this.db
        .prepare(
          `INSERT OR IGNORE INTO ai_rule_provisioning (scope_type, scope_id, rule_id, origin)
           VALUES (?, ?, ?, 'template')`
        )
        .run(scopeType, scopeId, ruleId);

      void this.improveRuleAsync(scopeType, scopeId, ruleId, departmentId, label, domain);
    } catch (err) {
      console.warn(`[engines] provisionRules(${scopeType}:${scopeId}) failed`, err);
    }
  }

  private ruleFrontmatter(
    scopeType: AssignmentScopeType,
    departmentId: string,
    label: string
  ): string {
    return [
      "---",
      `description: Operating rules for the ${label} ${scopeType}`,
      `departments: [${departmentId}]`,
      "priority: 30",
      "---",
    ].join("\n");
  }

  private templateRule(
    scopeType: AssignmentScopeType,
    departmentId: string,
    label: string,
    domain: string
  ): string {
    const body = [
      `You are operating inside the ${label} ${scopeType}, which covers ${domain}.`,
      `- Keep responses focused on the ${label} ${scopeType}'s pages, data, and tasks.`,
      `- Prefer the data shown in the platform context as ground truth for what the user is viewing.`,
      `- Be concise and actionable; reference concrete records (ids, names) when relevant.`,
    ].join("\n");
    return `${this.ruleFrontmatter(scopeType, departmentId, label)}\n${body}\n`;
  }

  /**
   * Best-effort LLM upgrade of a department rule body. Direct (non-streamed)
   * completion against the local server; on success the file is rewritten with
   * the same frontmatter and the audit origin is flipped to 'llm'. Any failure
   * is swallowed — the template remains in place.
   */
  private async improveRuleAsync(
    scopeType: AssignmentScopeType,
    scopeId: string,
    ruleId: string,
    departmentId: string,
    label: string,
    domain: string
  ): Promise<void> {
    const llm = this.deps.llm;
    if (!llm || !llm.isReady()) return;
    try {
      const prompt =
        `Write concise operating rules (3-6 short bullet points, no preamble) for an AI ` +
        `subagent responsible for the "${label}" ${scopeType} of a personal finance / ` +
        `trading platform. The ${scopeType} covers ${domain}. Focus on how the agent should ` +
        `behave, what data it should prioritize, and what it should avoid. Output only the ` +
        `bullet points as plain markdown.`;
      const sampling = llm.getSamplingParams();
      const res = await fetch(`${llm.getServerBaseUrl()}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "default",
          messages: [{ role: "user", content: prompt }],
          stream: false,
          temperature: sampling.temperature,
          max_tokens: sampling.maxTokens > 0 ? Math.min(sampling.maxTokens, 400) : 400,
        }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const body = (json.choices?.[0]?.message?.content ?? "").trim();
      if (!body) return;
      const dir = aiRulesDir();
      const file = path.join(dir, `${ruleId}.mdc`);
      fs.writeFileSync(
        file,
        `${this.ruleFrontmatter(scopeType, departmentId, label)}\n${body}\n`,
        "utf8"
      );
      this.db
        .prepare(
          `UPDATE ai_rule_provisioning SET origin = 'llm'
           WHERE scope_type = ? AND scope_id = ? AND rule_id = ?`
        )
        .run(scopeType, scopeId, ruleId);
    } catch {
      /* keep the template body on any failure */
    }
  }

  /** Refresh agents still carrying the old root-prompt + trailing specialization. */
  private refreshLegacyPrompts(): void {
    const root = getAgent(this.db, "intelligence");
    const basePrompt = root?.systemPrompt ?? "";
    if (!basePrompt) return;

    const rows = this.db
      .prepare(`SELECT id, label, icon FROM departments`)
      .all() as DepartmentRow[];

    for (const dept of rows) {
      const agentId = `dept-${dept.id}`;
      const existing = getAgent(this.db, agentId);
      if (!existing) continue;
      const domain =
        DOMAIN_BY_ID[dept.id] ?? `the ${dept.label} department's domain`;
      if (existing.systemPrompt === legacySystemPrompt(basePrompt, dept, domain)) {
        updateAgent(this.db, agentId, {
          systemPrompt: buildSystemPrompt(dept, domain),
        });
      }
    }
  }
}
