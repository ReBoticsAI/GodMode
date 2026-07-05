import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { createRuleFile, deleteRuleFile, listAiRules, setAiRuleStatus } from "./ai-rules.js";
import { createSkillFile, deleteSkillFile, listAiSkills, setAiSkillStatus } from "./ai-skills.js";
import { upsertRuleInDb, upsertSkillInDb } from "./knowledge-store.js";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  type WorkflowGraph,
} from "./ai-workflows.js";
import {
  deleteArtifact,
  listArtifacts,
  readArtifact,
  saveArtifact,
} from "./ai-artifacts.js";
import type { ToolExecContext } from "./ai-tool-executor.js";
import type { ReflectionMode } from "./reflection-config.js";
import { isUserAgentId } from "./agents/user-agent-prompt.js";
import {
  createReflectionProposal,
  type ReflectionProposalKind,
} from "./reflection-proposals.js";

export const REFLECTION_TOOL_NAMES = new Set([
  "read_recent_chats",
  "read_chat_transcript",
  "list_my_knowledge",
  "create_memory",
  "update_memory",
  "delete_memory",
  "create_rule",
  "update_rule",
  "delete_rule",
  "create_skill",
  "update_skill",
  "delete_skill",
  "create_workflow",
  "update_workflow",
  "delete_workflow",
  "save_artifact",
  "read_artifact",
  "list_artifacts",
  "delete_artifact",
  "propose_user_profile_update",
  "propose_user_memory",
]);

function reflectionMode(ctx: ToolExecContext): ReflectionMode {
  return ctx.reflectionMode === "auto" ? "auto" : "approval";
}

function agentId(ctx: ToolExecContext): string {
  return ctx.activeAgentId ?? "intelligence";
}

function objSchema(
  props: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return { type: "object", properties: props, required, additionalProperties: false };
}

export function getReflectionToolSchemas(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  const tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> = [
    {
      name: "read_recent_chats",
      description: "List chats for this agent updated since the reflection watermark.",
      parameters: objSchema({ limit: { type: "number" } }),
    },
    {
      name: "read_chat_transcript",
      description: "Read messages for a chat id (user/assistant turns).",
      parameters: objSchema({ chatId: { type: "string" } }, ["chatId"]),
    },
    {
      name: "list_my_knowledge",
      description:
        "Summarize this agent's rules, skills, memories, artifacts, and workflows (ids + titles only).",
      parameters: objSchema({}),
    },
    {
      name: "create_memory",
      description: "Create a durable memory for this agent.",
      parameters: objSchema(
        {
          text: { type: "string" },
          category: { type: "string" },
        },
        ["text"]
      ),
    },
    {
      name: "update_memory",
      description: "Update an existing memory by id.",
      parameters: objSchema(
        {
          id: { type: "string" },
          text: { type: "string" },
          category: { type: "string" },
          enabled: { type: "boolean" },
        },
        ["id"]
      ),
    },
    {
      name: "delete_memory",
      description: "Delete a memory by id.",
      parameters: objSchema({ id: { type: "string" } }, ["id"]),
    },
    {
      name: "create_rule",
      description: "Create a rule (guardrail) for this agent.",
      parameters: objSchema(
        {
          name: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
          globs: { type: "array", items: { type: "string" } },
          departments: { type: "array", items: { type: "string" } },
          alwaysApply: { type: "boolean" },
          priority: { type: "number" },
        },
        ["name", "description", "body"]
      ),
    },
    {
      name: "update_rule",
      description: "Update an existing rule by id.",
      parameters: objSchema(
        {
          id: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
          globs: { type: "array", items: { type: "string" } },
          departments: { type: "array", items: { type: "string" } },
          alwaysApply: { type: "boolean" },
          priority: { type: "number" },
          enabled: { type: "boolean" },
        },
        ["id"]
      ),
    },
    {
      name: "delete_rule",
      description: "Delete a rule by id.",
      parameters: objSchema({ id: { type: "string" } }, ["id"]),
    },
    {
      name: "create_skill",
      description: "Create a skill (instruction bundle) for this agent.",
      parameters: objSchema(
        {
          name: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
          departments: { type: "array", items: { type: "string" } },
        },
        ["name", "description", "body"]
      ),
    },
    {
      name: "update_skill",
      description: "Update an existing skill by id.",
      parameters: objSchema(
        {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
          departments: { type: "array", items: { type: "string" } },
          enabled: { type: "boolean" },
        },
        ["id"]
      ),
    },
    {
      name: "delete_skill",
      description: "Delete a skill by id.",
      parameters: objSchema({ id: { type: "string" } }, ["id"]),
    },
    {
      name: "create_workflow",
      description: "Create a workflow graph for this agent's automation.",
      parameters: objSchema(
        {
          name: { type: "string" },
          config: { type: "object" },
          enabled: { type: "boolean" },
        },
        ["name", "config"]
      ),
    },
    {
      name: "update_workflow",
      description: "Update a workflow by id.",
      parameters: objSchema(
        {
          id: { type: "string" },
          name: { type: "string" },
          config: { type: "object" },
          enabled: { type: "boolean" },
        },
        ["id"]
      ),
    },
    {
      name: "delete_workflow",
      description: "Delete a workflow by id.",
      parameters: objSchema({ id: { type: "string" } }, ["id"]),
    },
    {
      name: "save_artifact",
      description: "Save a text artifact for this agent.",
      parameters: objSchema(
        {
          name: { type: "string" },
          content: { type: "string" },
          kind: { type: "string" },
          description: { type: "string" },
        },
        ["name", "content"]
      ),
    },
    {
      name: "read_artifact",
      description: "Read artifact content by id or name.",
      parameters: objSchema({ id: { type: "string" }, name: { type: "string" } }),
    },
    {
      name: "list_artifacts",
      description: "List artifacts for this agent.",
      parameters: objSchema({ limit: { type: "number" } }),
    },
    {
      name: "delete_artifact",
      description: "Delete an artifact by id or name.",
      parameters: objSchema({ id: { type: "string" }, name: { type: "string" } }),
    },
    {
      name: "propose_user_profile_update",
      description:
        "Propose updating a field on the user's profile (persona agent only). Use after learning something new about the user.",
      parameters: objSchema(
        { field: { type: "string" }, value: { type: "string" } },
        ["field", "value"]
      ),
    },
    {
      name: "propose_user_memory",
      description:
        "Propose a durable personal-context memory about the user (persona agent only).",
      parameters: objSchema({ text: { type: "string" } }, ["text"]),
    },
  ];

  return tools.map((t) => ({
    type: "function" as const,
    function: t,
  }));
}

function stageOrApply(
  db: AppDatabase,
  ctx: ToolExecContext,
  kind: ReflectionProposalKind,
  targetId: string,
  action: "update" | "delete",
  payload: Record<string, unknown>,
  apply: () => unknown
): unknown {
  if (reflectionMode(ctx) === "approval") {
    const proposalId = createReflectionProposal(db, {
      agentId: agentId(ctx),
      kind,
      targetId,
      action,
      payload: payload as never,
    });
    return { ok: true, staged: true, proposalId, action, targetId };
  }
  apply();
  return { ok: true, applied: true, action, targetId };
}

export async function executeReflectionTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<unknown> {
  const db = ctx.db;
  const aid = agentId(ctx);
  const mode = reflectionMode(ctx);

  switch (name) {
    case "read_recent_chats": {
      const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 50);
      const watermark =
        (ctx.reflectionWatermark as string | undefined) ?? "1970-01-01 00:00:00";
      return db
        .prepare(
          `SELECT c.id, c.title, c.updated_at,
                  (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = c.id) AS message_count
           FROM ai_chats c
           WHERE c.updated_at > ?
           ORDER BY c.updated_at DESC
           LIMIT ?`
        )
        .all(watermark, limit);
    }
    case "read_chat_transcript": {
      const chatId = String(args.chatId ?? "");
      if (!chatId) throw new Error("chatId required");
      const rows = db
        .prepare(
          `SELECT role, content_json, created_at FROM ai_messages
           WHERE chat_id = ? ORDER BY created_at ASC LIMIT 200`
        )
        .all(chatId) as Array<{ role: string; content_json: string; created_at: string }>;
      return rows.map((r) => {
        let preview = r.content_json;
        try {
          const parsed = JSON.parse(r.content_json) as { text?: string };
          preview = parsed.text ?? r.content_json;
        } catch {
          /* keep raw */
        }
        return { role: r.role, text: String(preview).slice(0, 4000), at: r.created_at };
      });
    }
    case "list_my_knowledge": {
      const rules = listAiRules(db, aid).map((r) => ({
        id: r.id,
        description: r.description,
        status: r.status,
        enabled: r.enabled,
      }));
      const skills = listAiSkills(db, false, aid).map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        enabled: s.enabled,
      }));
      const memories = db
        .prepare(
          `SELECT id, text, status, enabled, category FROM ai_memories
           WHERE agent_id = ? OR (agent_id = 'intelligence' AND ? = 'intelligence')
           ORDER BY updated_at DESC LIMIT 40`
        )
        .all(aid, aid) as Array<{
        id: string;
        text: string;
        status: string;
        enabled: number;
        category: string | null;
      }>;
      const artifacts = listArtifacts(db, aid, 30).map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        size_bytes: a.size_bytes,
      }));
      const workflows = listWorkflows(db).map((w) => ({
        id: w.id,
        name: w.name,
        enabled: w.enabled === 1,
      }));
      return { rules, skills, memories, artifacts, workflows };
    }
    case "create_memory": {
      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("text required");
      const id = uuidv4();
      const status = mode === "auto" ? "active" : "pending";
      db.prepare(
        `INSERT INTO ai_memories (id, scope, chat_id, agent_id, text, category, source, status)
         VALUES (?, 'global', NULL, ?, ?, ?, 'reflection', ?)`
      ).run(id, aid, text, args.category ? String(args.category) : null, status);
      return { ok: true, id, status };
    }
    case "update_memory": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      const row = db
        .prepare(`SELECT id, status FROM ai_memories WHERE id = ? AND agent_id = ?`)
        .get(id, aid) as { id: string; status: string } | undefined;
      if (!row) throw new Error("memory not found");
      const payload = {
        text: args.text != null ? String(args.text) : undefined,
        category: args.category != null ? String(args.category) : undefined,
        enabled: args.enabled != null ? Boolean(args.enabled) : undefined,
      };
      if (row.status === "pending" || mode === "auto") {
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
          params.push(id);
          db.prepare(`UPDATE ai_memories SET ${sets.join(", ")} WHERE id = ?`).run(...params);
        }
        return { ok: true, id, applied: true };
      }
      return stageOrApply(db, ctx, "memory", id, "update", payload, () => {});
    }
    case "delete_memory": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      return stageOrApply(db, ctx, "memory", id, "delete", {}, () => {
        db.prepare(`DELETE FROM ai_memories WHERE id = ? AND agent_id = ?`).run(id, aid);
      });
    }
    case "create_rule": {
      const status = mode === "auto" ? "active" : "pending";
      const id = createRuleFile(
        db,
        aid,
        {
          name: String(args.name ?? ""),
          description: String(args.description ?? ""),
          body: String(args.body ?? ""),
          globs: Array.isArray(args.globs) ? args.globs.map(String) : undefined,
          departments: Array.isArray(args.departments)
            ? args.departments.map(String)
            : undefined,
          alwaysApply: typeof args.alwaysApply === "boolean" ? args.alwaysApply : undefined,
          priority: args.priority != null ? Number(args.priority) : undefined,
        },
        status
      );
      return { ok: true, id, status };
    }
    case "update_rule": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      const existing = listAiRules(db, aid).find((r) => r.id === id);
      if (!existing) throw new Error("rule not found");
      const payload = {
        description: args.description != null ? String(args.description) : undefined,
        body: args.body != null ? String(args.body) : undefined,
        globs: Array.isArray(args.globs) ? args.globs.map(String) : undefined,
        departments: Array.isArray(args.departments)
          ? args.departments.map(String)
          : undefined,
        alwaysApply: typeof args.alwaysApply === "boolean" ? args.alwaysApply : undefined,
        priority: args.priority != null ? Number(args.priority) : undefined,
        enabled: args.enabled != null ? Boolean(args.enabled) : undefined,
      };
      if (existing.status === "pending" || mode === "auto") {
        const status = mode === "auto" ? "active" : "pending";
        upsertRuleInDb(db, aid, {
          id,
          description: payload.description ?? existing.description,
          body: payload.body ?? existing.body ?? "",
          globs: payload.globs ?? existing.globs,
          departments: payload.departments ?? existing.departments,
          alwaysApply: payload.alwaysApply ?? existing.alwaysApply,
          priority: payload.priority ?? existing.priority,
          enabled: payload.enabled ?? existing.enabled,
          status,
        });
        setAiRuleStatus(db, aid, id, status);
        return { ok: true, id, applied: true, status };
      }
      return stageOrApply(db, ctx, "rule", id, "update", payload, () => {});
    }
    case "delete_rule": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      return stageOrApply(db, ctx, "rule", id, "delete", {}, () => {
        deleteRuleFile(db, id);
      });
    }
    case "create_skill": {
      const status = mode === "auto" ? "active" : "pending";
      const id = createSkillFile(
        db,
        aid,
        {
          name: String(args.name ?? ""),
          description: String(args.description ?? ""),
          body: String(args.body ?? ""),
          tools: Array.isArray(args.tools) ? args.tools.map(String) : undefined,
          departments: Array.isArray(args.departments)
            ? args.departments.map(String)
            : undefined,
        },
        status
      );
      return { ok: true, id, status };
    }
    case "update_skill": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      const existing = listAiSkills(db, false, aid).find((s) => s.id === id);
      if (!existing) throw new Error("skill not found");
      const payload = {
        name: args.name != null ? String(args.name) : undefined,
        description: args.description != null ? String(args.description) : undefined,
        body: args.body != null ? String(args.body) : undefined,
        tools: Array.isArray(args.tools) ? args.tools.map(String) : undefined,
        departments: Array.isArray(args.departments)
          ? args.departments.map(String)
          : undefined,
        enabled: args.enabled != null ? Boolean(args.enabled) : undefined,
      };
      if (existing.status === "pending" || mode === "auto") {
        const status = mode === "auto" ? "active" : "pending";
        upsertSkillInDb(db, aid, {
          id,
          name: payload.name ?? existing.name,
          description: payload.description ?? existing.description,
          body: payload.body ?? existing.body ?? "",
          tools: payload.tools ?? existing.tools,
          departments: payload.departments ?? existing.departments,
          enabled: payload.enabled ?? existing.enabled,
          status,
        });
        setAiSkillStatus(db, aid, id, status);
        return { ok: true, id, applied: true, status };
      }
      return stageOrApply(db, ctx, "skill", id, "update", payload, () => {});
    }
    case "delete_skill": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      return stageOrApply(db, ctx, "skill", id, "delete", {}, () => {
        deleteSkillFile(db, id);
      });
    }
    case "create_workflow": {
      const wf = createWorkflow(db, {
        name: String(args.name ?? "Reflection workflow"),
        config: (args.config as WorkflowGraph) ?? { nodes: [], edges: [] },
        enabled: args.enabled !== false,
      });
      if (mode === "approval") {
        updateWorkflow(db, wf.id, { enabled: false });
        return { ok: true, id: wf.id, status: "pending", note: "created disabled until approved" };
      }
      return { ok: true, id: wf.id, status: "active" };
    }
    case "update_workflow": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      if (!getWorkflow(db, id)) throw new Error("workflow not found");
      const payload = {
        workflowName: args.name != null ? String(args.name) : undefined,
        config: args.config as WorkflowGraph | undefined,
        enabledWorkflow: args.enabled != null ? Boolean(args.enabled) : undefined,
      };
      return stageOrApply(db, ctx, "workflow", id, "update", payload, () => {
        updateWorkflow(db, id, {
          name: payload.workflowName,
          config: payload.config,
          enabled: payload.enabledWorkflow,
        });
      });
    }
    case "delete_workflow": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      return stageOrApply(db, ctx, "workflow", id, "delete", {}, () => {
        deleteWorkflow(db, id);
      });
    }
    case "save_artifact": {
      const name = String(args.name ?? "").trim();
      const content = String(args.content ?? "");
      if (!name || !content) throw new Error("name and content required");
      const artifact = saveArtifact(db, aid, {
        name,
        content,
        kind: args.kind ? String(args.kind) : undefined,
        description: args.description ? String(args.description) : undefined,
        source: "reflection",
      });
      return { ok: true, id: artifact.id, name: artifact.name };
    }
    case "read_artifact": {
      const idOrName = String(args.id ?? args.name ?? "");
      if (!idOrName) throw new Error("id or name required");
      const { artifact, content } = readArtifact(db, aid, idOrName);
      return { artifact, content: content.slice(0, 12000) };
    }
    case "list_artifacts": {
      const limit = Math.min(Math.max(Number(args.limit ?? 30) || 30, 1), 100);
      return listArtifacts(db, aid, limit);
    }
    case "delete_artifact": {
      const idOrName = String(args.id ?? args.name ?? "");
      if (!idOrName) throw new Error("id or name required");
      const ok = deleteArtifact(db, aid, idOrName);
      return { ok };
    }
    case "propose_user_profile_update": {
      if (!isUserAgentId(aid)) throw new Error("user persona agent only");
      const field = String(args.field ?? "").trim();
      if (!field) throw new Error("field required");
      const value = args.value == null ? null : String(args.value);
      return stageOrApply(db, ctx, "user_profile", field, "update", { field, value }, () => {});
    }
    case "propose_user_memory": {
      if (!isUserAgentId(aid)) throw new Error("user persona agent only");
      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("text required");
      const id = uuidv4();
      return stageOrApply(db, ctx, "user_memory", id, "update", { text }, () => {
        db.prepare(
          `INSERT INTO ai_memories (id, scope, chat_id, agent_id, text, category, source, status, enabled)
           VALUES (?, 'global', NULL, ?, ?, 'user_identity', 'reflection', 'active', 1)`
        ).run(id, aid, text);
      });
    }
    default:
      throw new Error(`Unknown reflection tool: ${name}`);
  }
}

export function reflectionToolRequiresConfirmation(_name: string): boolean {
  return false;
}
