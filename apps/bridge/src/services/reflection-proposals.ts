import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { getCoreDb } from "../core-db.js";
import { deleteRuleFile } from "./ai-rules.js";
import { deleteSkillFile } from "./ai-skills.js";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  updateWorkflow,
  type WorkflowGraph,
} from "./ai-workflows.js";
import { upsertRuleInDb, upsertSkillInDb } from "./knowledge-store.js";
import { refreshUserAgentPrompt } from "./agents/user-agent.js";

export type ReflectionProposalKind =
  | "memory"
  | "rule"
  | "skill"
  | "workflow"
  | "artifact"
  | "user_profile"
  | "user_memory";

export type ReflectionProposalAction = "update" | "delete";

export interface ReflectionProposal {
  id: string;
  agent_id: string;
  kind: ReflectionProposalKind;
  target_id: string | null;
  action: ReflectionProposalAction;
  payload_json: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface ReflectionProposalPayload {
  text?: string;
  category?: string | null;
  enabled?: boolean;
  description?: string;
  body?: string;
  globs?: string[];
  departments?: string[];
  alwaysApply?: boolean;
  priority?: number;
  name?: string;
  tools?: string[];
  config?: WorkflowGraph;
  workflowName?: string;
  enabledWorkflow?: boolean;
  field?: string;
  value?: string | null;
}

export function listReflectionProposals(
  db: AppDatabase,
  agentId: string,
  status: "pending" | "approved" | "rejected" | "all" = "pending"
): ReflectionProposal[] {
  if (status === "all") {
    return db
      .prepare(
        `SELECT * FROM ai_reflection_proposals WHERE agent_id = ? ORDER BY created_at DESC LIMIT 200`
      )
      .all(agentId) as ReflectionProposal[];
  }
  return db
    .prepare(
      `SELECT * FROM ai_reflection_proposals WHERE agent_id = ? AND status = ?
       ORDER BY created_at DESC LIMIT 200`
    )
    .all(agentId, status) as ReflectionProposal[];
}

export function createReflectionProposal(
  db: AppDatabase,
  input: {
    agentId: string;
    kind: ReflectionProposalKind;
    targetId: string;
    action: ReflectionProposalAction;
    payload?: ReflectionProposalPayload;
  }
): string {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_reflection_proposals
       (id, agent_id, kind, target_id, action, payload_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).run(
    id,
    input.agentId,
    input.kind,
    input.targetId,
    input.action,
    JSON.stringify(input.payload ?? {})
  );
  return id;
}

export function rejectReflectionProposal(db: AppDatabase, id: string): boolean {
  const r = db
    .prepare(
      `UPDATE ai_reflection_proposals SET status = 'rejected', updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    )
    .run(id);
  return r.changes > 0;
}

export function approveReflectionProposal(db: AppDatabase, id: string): boolean {
  const row = db
    .prepare(`SELECT * FROM ai_reflection_proposals WHERE id = ? AND status = 'pending'`)
    .get(id) as ReflectionProposal | undefined;
  if (!row) return false;

  const payload = JSON.parse(row.payload_json || "{}") as ReflectionProposalPayload;
  const agentId = row.agent_id;

  switch (row.kind) {
    case "memory":
      if (row.action === "delete") {
        db.prepare(`DELETE FROM ai_memories WHERE id = ? AND agent_id = ?`).run(
          row.target_id,
          agentId
        );
      } else {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (payload.text != null) {
          sets.push("text = ?");
          params.push(payload.text);
        }
        if (payload.category !== undefined) {
          sets.push("category = ?");
          params.push(payload.category);
        }
        if (payload.enabled != null) {
          sets.push("enabled = ?");
          params.push(payload.enabled ? 1 : 0);
        }
        if (sets.length) {
          sets.push("updated_at = datetime('now')");
          params.push(row.target_id, agentId);
          db.prepare(
            `UPDATE ai_memories SET ${sets.join(", ")} WHERE id = ? AND agent_id = ?`
          ).run(...params);
        }
      }
      break;
    case "rule":
      if (row.action === "delete") {
        deleteRuleFile(db, row.target_id!);
      } else {
        upsertRuleInDb(db, agentId, {
          id: row.target_id!,
          description: payload.description ?? row.target_id!,
          body: payload.body ?? "",
          alwaysApply: payload.alwaysApply ?? false,
          globs: payload.globs ?? [],
          departments: payload.departments ?? [],
          priority: payload.priority ?? 50,
          enabled: payload.enabled !== false,
          status: "active",
        });
      }
      break;
    case "skill":
      if (row.action === "delete") {
        deleteSkillFile(db, row.target_id!);
      } else {
        upsertSkillInDb(db, agentId, {
          id: row.target_id!,
          name: payload.name ?? row.target_id!,
          description: payload.description ?? "",
          body: payload.body ?? "",
          tools: payload.tools ?? [],
          departments: payload.departments ?? [],
          enabled: payload.enabled !== false,
          status: "active",
        });
      }
      break;
    case "workflow":
      if (row.action === "delete") {
        deleteWorkflow(db, row.target_id!);
      } else if (row.target_id && getWorkflow(db, row.target_id)) {
        updateWorkflow(db, row.target_id, {
          name: payload.workflowName,
          config: payload.config,
          enabled: payload.enabledWorkflow,
        });
      }
      break;
    case "user_profile": {
      const userId = agentId.startsWith("user-") ? agentId.slice("user-".length) : null;
      if (!userId) break;
      const field = payload.field ?? row.target_id;
      const columnMap: Record<string, string> = {
        headline: "headline",
        bio: "bio",
        pronouns: "pronouns",
        location: "location",
        timezone: "timezone",
        phone: "phone",
        company: "company",
        jobTitle: "job_title",
        job_title: "job_title",
        website: "website",
        twitter: "twitter",
        github: "github",
        linkedin: "linkedin",
        emoji: "emoji",
        birthday: "birthday",
        languages: "languages",
        interests: "interests",
        values: "values",
        goals: "goals",
        personalityNotes: "personality_notes",
        personality_notes: "personality_notes",
        decisionStyle: "decision_style",
        decision_style: "decision_style",
        riskTolerance: "risk_tolerance",
        risk_tolerance: "risk_tolerance",
      };
      const column = field ? columnMap[field] : undefined;
      if (column) {
        const core = getCoreDb();
        core.prepare(
          `INSERT INTO user_profiles (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`
        ).run(userId);
        core.prepare(
          `UPDATE user_profiles SET "${column}"=?, updated_at=datetime('now') WHERE user_id=?`
        ).run(payload.value ?? null, userId);
        refreshUserAgentPrompt(db, userId);
      }
      break;
    }
    case "user_memory": {
      const text = payload.text?.trim();
      if (text) {
        const id = row.target_id || uuidv4();
        db.prepare(
          `INSERT INTO ai_memories (id, scope, chat_id, agent_id, text, category, source, status, enabled)
           VALUES (?, 'global', NULL, ?, ?, 'user_identity', 'reflection', 'active', 1)
           ON CONFLICT(id) DO UPDATE SET text=excluded.text, updated_at=datetime('now')`
        ).run(id, agentId, text);
        const userId = agentId.startsWith("user-") ? agentId.slice("user-".length) : null;
        if (userId) refreshUserAgentPrompt(db, userId);
      }
      break;
    }
    default:
      break;
  }

  db.prepare(
    `UPDATE ai_reflection_proposals SET status = 'approved', updated_at = datetime('now') WHERE id = ?`
  ).run(id);
  return true;
}
