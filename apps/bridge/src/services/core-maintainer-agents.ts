/**
 * Seed operator-tenant Core Issues + Core PRs maintainer Agents and wake hooks.
 */
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import type { CoreDatabase } from "../core-db.js";
import type { AppDatabase } from "../db.js";
import {
  createAgent,
  getAgent,
  updateAgent,
} from "./agents/agents-db.js";
import type { AgentBackendKind } from "./agents/types.js";
import { updateAiSkillState } from "./ai-skills.js";
import { ensureHooksWorkspaceSchema } from "./hooks-workspace-migrate.js";

/** Cloud Admin: Cursor subscription. Local operator: inherit Intelligence (usually local). */
function maintainerBackend(): AgentBackendKind | undefined {
  return config.isSaas ? "cursor_cloud" : undefined;
}

export const CORE_ISSUES_AGENT_ID = "core-issues";
export const CORE_PRS_AGENT_ID = "core-prs";

function ensureMaintainerAgent(
  db: AppDatabase,
  opts: {
    id: string;
    name: string;
    description: string;
    skillId: string;
  }
): void {
  if (!getAgent(db, "intelligence")) return;
  const backend = maintainerBackend();
  const existing = getAgent(db, opts.id);
  if (!existing) {
    createAgent(db, {
      id: opts.id,
      name: opts.name,
      description: opts.description,
      icon: "shield",
      team: "maintainer",
      parentId: "intelligence",
      ...(backend ? { backend } : {}),
      config: {
        knowsUser: false,
        codeAccess: true,
        codeAutonomy: "full",
      },
      autoApprove: ["*"],
    });
  } else if (backend && existing.backend === "local") {
    // Prior seeds inherited local; Cloud has no chat GGUF so promote to Cursor.
    updateAgent(db, opts.id, { backend });
  }
  try {
    updateAiSkillState(db, opts.id, opts.skillId, true);
    updateAiSkillState(db, opts.id, "support", false);
  } catch {
    /* skill state optional during early migrate */
  }
}

function ensureRunAgentHook(
  workspaceDb: CoreDatabase,
  opts: {
    agentId: string;
    ownerTenantId: string;
    name: string;
    eventType: string;
    prompt: string;
  }
): boolean {
  ensureHooksWorkspaceSchema(workspaceDb);
  const existing = workspaceDb
    .prepare(
      `SELECT id FROM hooks
       WHERE owner_kind = ? AND owner_id = ? AND name = ?`
    )
    .get("agent", opts.agentId, opts.name) as { id: string } | undefined;
  if (existing) return false;

  const id = uuidv4();
  const actionConfig = JSON.stringify({
    agentId: opts.agentId,
    prompt: opts.prompt,
  });
  workspaceDb
    .prepare(
      `INSERT INTO hooks
       (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
        trigger_kind, event_type, schedule_cron, condition_json,
        action_kind, action_config_json, rate_limit_per_hour, require_approval)
       VALUES (?, 'agent', ?, ?, ?, 1, 'event', ?, NULL, NULL, 'run_agent', ?, 30, 0)`
    )
    .run(
      id,
      opts.agentId,
      opts.ownerTenantId,
      opts.name,
      opts.eventType,
      actionConfig
    );
  return true;
}

/**
 * Idempotent: Core Issues + Core PRs agents and event → run_agent wake hooks.
 */
export function ensureCoreMaintainerAgents(
  db: AppDatabase,
  ownerTenantId: string
): { agents: string[]; hooks: string[] } {
  const agents: string[] = [];
  const hooks: string[] = [];

  if (!getAgent(db, "intelligence")) {
    return { agents, hooks };
  }

  ensureMaintainerAgent(db, {
    id: CORE_ISSUES_AGENT_ID,
    name: "Core Issues",
    description:
      "Triage ReBoticsAI/GodMode GitHub issues from Support webhooks. Never merges PRs.",
    skillId: "support-triage",
  });
  agents.push(CORE_ISSUES_AGENT_ID);

  ensureMaintainerAgent(db, {
    id: CORE_PRS_AGENT_ID,
    name: "Core PRs",
    description:
      "Review Core PRs, enforce the merge matrix, merge only when every hard gate passes.",
    skillId: "support-pr-review",
  });
  agents.push(CORE_PRS_AGENT_ID);

  const workspaceDb = db as unknown as CoreDatabase;
  if (
    ensureRunAgentHook(workspaceDb, {
      agentId: CORE_ISSUES_AGENT_ID,
      ownerTenantId,
      name: "support-platform-issue-wake-core-issues",
      eventType: "support.platform_issue.reported",
      prompt:
        "A Core GitHub issue event arrived (support.platform_issue.reported). Use skill support-triage: read the latest platform event context if present, triage the issue (labels, Ready / need-info / duplicate), notify the operator. Never merge PRs.",
    })
  ) {
    hooks.push("support-platform-issue-wake-core-issues");
  }
  if (
    ensureRunAgentHook(workspaceDb, {
      agentId: CORE_PRS_AGENT_ID,
      ownerTenantId,
      name: "support-platform-pr-wake-core-prs",
      eventType: "support.platform_pr.updated",
      prompt:
        "A Core GitHub pull_request event arrived (support.platform_pr.updated). Use skill support-pr-review: watch_pr_checks, then github_pr_merge only if the hard-gate matrix passes. Fail closed otherwise; request changes. Never force-merge.",
    })
  ) {
    hooks.push("support-platform-pr-wake-core-prs");
  }

  return { agents, hooks };
}
