import { createHash } from "node:crypto";
import type { AppDatabase } from "../db.js";
import { AI_TOOL_REGISTRY, isToolVisibleForAgent } from "./ai-tools-registry.js";
import { listAiSkills } from "./ai-skills.js";
import { getWorkflow } from "./ai-workflows.js";
import type { EmbeddingClient } from "./embeddings/embedding-client.js";
import { blobToVector } from "./embeddings/embedding-client.js";

export type CapabilityKind = "tool" | "skill" | "workflow";

export interface CapabilityDoc {
  kind: CapabilityKind;
  id: string;
  agentId: string;
  name: string;
  description: string;
  whenToUse: string;
  pairsWith: string;
  text: string;
  metadata: Record<string, unknown>;
}

const TOOL_WHEN_TO_USE: Record<string, { when: string; pairs?: string[] }> = {
  todo_write: {
    when: "Planning or tracking multi-step work on the Kanban board.",
    pairs: ["list_project_cards", "create_project_card", "move_project_card"],
  },
  use_skill: {
    when: "Loading a multi-step recipe when capabilities suggest a matching skill.",
    pairs: ["todo_write"],
  },
  run_workflow: {
    when: "Running a stored automation graph instead of improvising long tool chains.",
    pairs: ["list_workflows", "create_schedule"],
  },
  create_hook: {
    when: "Setting up event or schedule driven self-loops for an agent.",
    pairs: ["create_schedule", "run_agent", "list_hooks"],
  },
  create_schedule: {
    when: "Cron-triggering a workflow on a recurring basis.",
    pairs: ["create_workflow", "run_workflow", "list_schedules"],
  },
  list_project_cards: {
    when: "Reading Kanban backlog or in-progress cards for autonomous work.",
    pairs: ["todo_write", "move_project_card", "update_card"],
  },
  run_terminal: {
    when: "Running shell commands for builds, scripts, or sc-control.ps1.",
    pairs: ["read_file", "grep"],
  },
  read_file: {
    when: "Inspecting source or config before editing or debugging.",
    pairs: ["edit_file", "grep", "glob"],
  },
  edit_file: {
    when: "Making targeted code changes after reading context.",
    pairs: ["read_file", "run_terminal"],
  },
  remember: {
    when: "Persisting a durable fact for future turns or reflection.",
    pairs: [],
  },
  ask_cursor_agent: {
    when: "Only when USER explicitly requests Cursor CLI — Intelligence codes natively by default.",
    pairs: ["read_file", "grep", "edit_file", "run_terminal"],
  },
  list_workflows: {
    when: "Discovering automations before run_workflow or create_schedule.",
    pairs: ["run_workflow", "create_schedule"],
  },
  create_workflow: {
    when: "Building a reusable multi-node automation graph.",
    pairs: ["create_schedule", "run_workflow"],
  },
};

const WORKFLOW_WHEN_TO_USE: Record<string, { when: string; pairs?: string[] }> = {
  "autonomous-task-runner": {
    when:
      "Kanban-driven autonomous loop: check backlog, plan subtasks, work cards, review, complete. Prefer over manual todo chains for ongoing optimization.",
    pairs: ["todo_write", "list_project_cards", "run_workflow", "create_schedule"],
  },
};

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function toolPairsWith(name: string): string {
  const meta = TOOL_WHEN_TO_USE[name];
  if (meta?.pairs?.length) return meta.pairs.join(", ");
  const tool = AI_TOOL_REGISTRY.find((t) => t.name === name);
  if (!tool?.category) return "";
  return AI_TOOL_REGISTRY.filter((t) => t.category === tool.category && t.name !== name)
    .slice(0, 4)
    .map((t) => t.name)
    .join(", ");
}

function summarizeWorkflowTools(configJson: string): string[] {
  try {
    const cfg = JSON.parse(configJson) as { nodes?: Array<{ type?: string; config?: { tool?: string } }> };
    const tools = new Set<string>();
    for (const n of cfg.nodes ?? []) {
      if (n.type === "tool" && typeof n.config?.tool === "string") tools.add(n.config.tool);
    }
    return [...tools];
  } catch {
    return [];
  }
}

function summarizeWorkflowKinds(configJson: string): string {
  try {
    const cfg = JSON.parse(configJson) as { nodes?: Array<{ type?: string }> };
    const kinds = new Set((cfg.nodes ?? []).map((n) => n.type).filter(Boolean));
    return [...kinds].join(", ");
  } catch {
    return "";
  }
}

function toolVisible(db: AppDatabase, agentId: string, toolName: string): boolean {
  return isToolVisibleForAgent(db, agentId, toolName);
}

export function buildCapabilityDocs(db: AppDatabase, agentId: string): CapabilityDoc[] {
  const docs: CapabilityDoc[] = [];

  for (const tool of AI_TOOL_REGISTRY) {
    if (!toolVisible(db, agentId, tool.name)) continue;
    const meta = TOOL_WHEN_TO_USE[tool.name];
    const whenToUse = meta?.when ?? tool.description;
    const pairsWith = meta?.pairs?.join(", ") ?? toolPairsWith(tool.name);
    const text = [
      `[tool] ${tool.name}`,
      tool.description,
      `Mode: ${tool.mode}${tool.write ? " (writes)" : ""}`,
      tool.category ? `Category: ${tool.category}` : "",
      whenToUse ? `When to use: ${whenToUse}` : "",
      pairsWith ? `Pairs with: ${pairsWith}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    docs.push({
      kind: "tool",
      id: tool.name,
      agentId,
      name: tool.name,
      description: tool.description,
      whenToUse,
      pairsWith,
      text,
      metadata: { mode: tool.mode, category: tool.category ?? null },
    });
  }

  for (const skill of listAiSkills(db, true, agentId)) {
    if (skill.status !== "active" || !skill.enabled) continue;
    const pairsWith = skill.tools.join(", ");
    const whenToUse =
      skill.description ||
      `Multi-step recipe "${skill.name}". Load with use_skill then follow steps.`;
    const text = [
      `[skill] ${skill.id}: ${skill.name}`,
      skill.description,
      skill.tools.length ? `Tools: ${skill.tools.join(", ")}` : "",
      `When to use: ${whenToUse}`,
      pairsWith ? `Pairs with: ${pairsWith}` : "",
      skill.body ? `Steps:\n${skill.body.slice(0, 1200)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    docs.push({
      kind: "skill",
      id: skill.id,
      agentId,
      name: skill.name,
      description: skill.description,
      whenToUse,
      pairsWith,
      text,
      metadata: { tools: skill.tools },
    });
  }

  const wfRows = db
    .prepare(
      `SELECT id, name, config_json, enabled, agent_id FROM ai_workflows
       WHERE enabled = 1 AND (agent_id = ? OR agent_id IS NULL OR agent_id = 'intelligence')`
    )
    .all(agentId) as Array<{
    id: string;
    name: string;
    config_json: string;
    enabled: number;
    agent_id: string | null;
  }>;

  for (const row of wfRows) {
    const wfMeta = WORKFLOW_WHEN_TO_USE[row.id];
    const toolNodes = summarizeWorkflowTools(row.config_json);
    const kinds = summarizeWorkflowKinds(row.config_json);
    const whenToUse =
      wfMeta?.when ??
      `Automation graph "${row.name}" with nodes: ${kinds || "unknown"}.`;
    const pairsWith =
      wfMeta?.pairs?.join(", ") ?? (toolNodes.length ? toolNodes.join(", ") : "");
    const text = [
      `[workflow] ${row.id}: ${row.name}`,
      `When to use: ${whenToUse}`,
      kinds ? `Node kinds: ${kinds}` : "",
      toolNodes.length ? `Tools in graph: ${toolNodes.join(", ")}` : "",
      pairsWith ? `Pairs with: ${pairsWith}` : "",
      "Invoke via run_workflow tool.",
    ]
      .filter(Boolean)
      .join("\n");
    docs.push({
      kind: "workflow",
      id: row.id,
      agentId,
      name: row.name,
      description: row.name,
      whenToUse,
      pairsWith,
      text,
      metadata: { toolNodes, kinds },
    });
  }

  return docs;
}

export function syncCapabilityToFts(
  db: AppDatabase,
  kind: string,
  id: string,
  agentId: string,
  text: string
): void {
  try {
    db.prepare(
      `DELETE FROM ai_capability_fts WHERE kind = ? AND id = ? AND agent_id = ?`
    ).run(kind, id, agentId);
    db.prepare(
      `INSERT INTO ai_capability_fts (kind, id, agent_id, text) VALUES (?, ?, ?, ?)`
    ).run(kind, id, agentId, text);
  } catch {
    /* fts may not exist yet */
  }
}

export async function rebuildCapabilityIndex(
  db: AppDatabase,
  agentId: string,
  embedder?: EmbeddingClient
): Promise<number> {
  const docs = buildCapabilityDocs(db, agentId);
  const upsert = db.prepare(
    `INSERT INTO ai_capability_embeddings
       (kind, id, agent_id, name, description, when_to_use, pairs_with, text, metadata_json,
        embedding, embedding_dim, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(kind, id, agent_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       when_to_use = excluded.when_to_use,
       pairs_with = excluded.pairs_with,
       text = excluded.text,
       metadata_json = excluded.metadata_json,
       embedding = CASE WHEN excluded.content_hash = ai_capability_embeddings.content_hash
         THEN ai_capability_embeddings.embedding ELSE excluded.embedding END,
       embedding_dim = CASE WHEN excluded.content_hash = ai_capability_embeddings.content_hash
         THEN ai_capability_embeddings.embedding_dim ELSE excluded.embedding_dim END,
       content_hash = excluded.content_hash,
       updated_at = datetime('now')`
  );

  let updated = 0;
  for (const doc of docs) {
    const contentHash = hashContent(doc.text);
    const existing = db
      .prepare(
        `SELECT content_hash FROM ai_capability_embeddings WHERE kind = ? AND id = ? AND agent_id = ?`
      )
      .get(doc.kind, doc.id, doc.agentId) as { content_hash: string } | undefined;

    let embedding: Buffer | null = null;
    let embeddingDim: number | null = null;
    if (!existing || existing.content_hash !== contentHash) {
      if (embedder?.isReady()) {
        const vec = await embedder.embed(doc.text);
        if (vec) {
          embedding = Buffer.from(vec.buffer);
          embeddingDim = vec.length;
        }
      }
    }

    upsert.run(
      doc.kind,
      doc.id,
      doc.agentId,
      doc.name,
      doc.description,
      doc.whenToUse,
      doc.pairsWith,
      doc.text,
      JSON.stringify(doc.metadata),
      embedding,
      embeddingDim,
      contentHash
    );
    syncCapabilityToFts(db, doc.kind, doc.id, doc.agentId, doc.text);
    updated++;
  }

  const validKeys = new Set(docs.map((d) => `${d.kind}:${d.id}:${d.agentId}`));
  const stale = db
    .prepare(`SELECT kind, id, agent_id FROM ai_capability_embeddings WHERE agent_id = ?`)
    .all(agentId) as Array<{ kind: string; id: string; agent_id: string }>;
  for (const row of stale) {
    const key = `${row.kind}:${row.id}:${row.agent_id}`;
    if (!validKeys.has(key)) {
      db.prepare(
        `DELETE FROM ai_capability_embeddings WHERE kind = ? AND id = ? AND agent_id = ?`
      ).run(row.kind, row.id, row.agent_id);
      try {
        db.prepare(
          `DELETE FROM ai_capability_fts WHERE kind = ? AND id = ? AND agent_id = ?`
        ).run(row.kind, row.id, row.agent_id);
      } catch {
        /* ignore */
      }
    }
  }

  return updated;
}

export async function rebuildAllAgentCapabilityIndexes(
  db: AppDatabase,
  embedder?: EmbeddingClient
): Promise<number> {
  const agents = db
    .prepare(`SELECT id FROM ai_agents WHERE enabled = 1`)
    .all() as Array<{ id: string }>;
  let total = 0;
  for (const { id } of agents) {
    total += await rebuildCapabilityIndex(db, id, embedder);
  }
  return total;
}

export function countCapabilityIndex(db: AppDatabase): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ai_capability_embeddings`).get() as {
    c: number;
  };
  return row.c;
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
const pendingRebuilds = new Map<string, AppDatabase>();

export function scheduleCapabilityRebuild(db: AppDatabase, agentId: string): void {
  pendingRebuilds.set(agentId, db);
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    const jobs = [...pendingRebuilds.entries()];
    pendingRebuilds.clear();
    void (async () => {
      for (const [agentId, jobDb] of jobs) {
        try {
          await rebuildCapabilityIndex(jobDb, agentId);
        } catch (err) {
          console.warn(
            `[capability-index] rebuild failed for ${agentId}:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    })();
  }, 1500);
}

export function getWorkflowCapabilitySummary(db: AppDatabase, workflowId: string): string {
  const wf = getWorkflow(db, workflowId);
  if (!wf) return "";
  const meta = WORKFLOW_WHEN_TO_USE[workflowId];
  return meta?.when ?? `Workflow ${wf.name}`;
}
