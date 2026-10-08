/**
 * Seed Automations hooks for Agent Support report events (notify staff/owner path).
 * Idempotent: skips when a hook with the same name already exists on the tenant.
 */
import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase } from "../core-db.js";
import { ensureHooksWorkspaceSchema } from "./hooks-workspace-migrate.js";

const SEEDED: Array<{
  name: string;
  eventType: string;
  title: string;
  body: string;
}> = [
  {
    name: "support-platform-issue-notify",
    eventType: "support.platform_issue.reported",
    title: "Platform issue reported",
    body: "A GodMode Agent filed or updated a Core GitHub issue. Check notifications for the link.",
  },
  {
    name: "support-ops-report-notify",
    eventType: "ops.report.created",
    title: "Admin ops report",
    body: "A GodMode Agent filed a private Admin ops report. Check Admin → Support and notifications.",
  },
  {
    name: "support-resource-issue-notify",
    eventType: "support.resource_issue.reported",
    title: "Shared resource issue",
    body: "A GodMode Agent reported a shared-resource issue to the grant owner.",
  },
  {
    name: "support-platform-pr-notify",
    eventType: "support.platform_pr.updated",
    title: "Core pull request updated",
    body: "A ReBoticsAI/GodMode pull request was opened or updated. Core PRs Agent wakes on support.platform_pr.updated.",
  },
];

export function ensureSupportReportHooks(
  workspaceDb: CoreDatabase,
  opts: {
    ownerKind: "agent" | "user";
    ownerId: string;
    ownerTenantId: string;
  }
): { created: string[] } {
  ensureHooksWorkspaceSchema(workspaceDb);
  const created: string[] = [];
  for (const seed of SEEDED) {
    const existing = workspaceDb
      .prepare(
        `SELECT id FROM hooks
         WHERE owner_kind = ? AND owner_id = ? AND name = ?`
      )
      .get(opts.ownerKind, opts.ownerId, seed.name) as { id: string } | undefined;
    if (existing) continue;

    const id = uuidv4();
    const actionConfig = JSON.stringify({
      title: seed.title,
      body: seed.body,
      category: "support",
      link: "/admin?tab=support",
    });
    workspaceDb
      .prepare(
        `INSERT INTO hooks
         (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
          trigger_kind, event_type, schedule_cron, condition_json,
          action_kind, action_config_json, rate_limit_per_hour, require_approval)
         VALUES (?, ?, ?, ?, ?, 1, 'event', ?, NULL, NULL, 'notify', ?, 20, 0)`
      )
      .run(
        id,
        opts.ownerKind,
        opts.ownerId,
        opts.ownerTenantId,
        seed.name,
        seed.eventType,
        actionConfig
      );
    created.push(seed.name);
  }
  return { created };
}
