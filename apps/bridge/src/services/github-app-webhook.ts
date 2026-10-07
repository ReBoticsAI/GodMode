/**
 * GitHub App webhook receiver (Projects v2 item → Tasks board sync;
 * Core issues / PRs → PlatformEvent for Agent Support hooks).
 */
import type { Request, Response } from "express";
import { getCloudDb, listAllTenantIds } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { verifyGithubWebhookSignature } from "../services/github-app.js";
import { syncBoardWithGithub } from "../services/github-projects.js";
import { emitEvent } from "./event-bus.js";

type ProjectsV2ItemPayload = {
  action?: string;
  projects_v2_item?: {
    node_id?: string;
    project_node_id?: string;
  };
};

type IssuesPayload = {
  action?: string;
  issue?: {
    number?: number;
    html_url?: string;
    title?: string;
    state?: string;
  };
  pull_request?: {
    number?: number;
    html_url?: string;
    title?: string;
    state?: string;
    draft?: boolean;
    user?: { login?: string };
  };
  repository?: {
    full_name?: string;
  };
};

const PR_WAKE_ACTIONS = new Set([
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
  "edited",
]);

function operatorTenantId(): string | null {
  return (
    (
      getCloudDb()
        .prepare(
          `SELECT id FROM tenants WHERE is_operator = 1 ORDER BY created_at ASC LIMIT 1`
        )
        .get() as { id: string } | undefined
    )?.id ?? null
  );
}

export async function githubAppWebhookHandler(
  req: Request,
  res: Response
): Promise<void> {
  const raw = req.body;
  if (!Buffer.isBuffer(raw)) {
    res.status(400).json({ error: "Expected raw body" });
    return;
  }
  const signature = req.header("x-hub-signature-256") ?? undefined;
  if (!verifyGithubWebhookSignature(raw, signature)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.header("x-github-event") ?? "";
  if (event === "ping") {
    res.status(200).json({ ok: true });
    return;
  }

  let payload: ProjectsV2ItemPayload & IssuesPayload = {};
  try {
    payload = JSON.parse(raw.toString("utf8")) as ProjectsV2ItemPayload &
      IssuesPayload;
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  if (event === "issues" || event === "issue_comment") {
    const fullName = payload.repository?.full_name ?? "";
    if (fullName === "ReBoticsAI/GodMode" && payload.issue?.number) {
      const operatorTenant = operatorTenantId();
      if (operatorTenant) {
        emitEvent({
          type: "support.platform_issue.reported",
          actor: { kind: "system", id: "github-webhook" },
          tenantId: operatorTenant,
          payload: {
            action: payload.action ?? event,
            issueNumber: payload.issue.number,
            htmlUrl: payload.issue.html_url ?? null,
            subject: payload.issue.title ?? null,
            source: "github_webhook",
            event,
          },
        });
      }
    }
    res.status(200).json({ ok: true, accepted: event });
    return;
  }

  if (event === "pull_request") {
    const fullName = payload.repository?.full_name ?? "";
    const action = payload.action ?? "";
    const pr = payload.pull_request;
    if (
      fullName === "ReBoticsAI/GodMode" &&
      pr?.number &&
      PR_WAKE_ACTIONS.has(action)
    ) {
      const operatorTenant = operatorTenantId();
      if (operatorTenant) {
        emitEvent({
          type: "support.platform_pr.updated",
          actor: { kind: "system", id: "github-webhook" },
          tenantId: operatorTenant,
          payload: {
            action,
            prNumber: pr.number,
            htmlUrl: pr.html_url ?? null,
            title: pr.title ?? null,
            draft: Boolean(pr.draft),
            authorLogin: pr.user?.login ?? null,
            source: "github_webhook",
            event,
          },
        });
      }
    }
    res.status(200).json({ ok: true, accepted: event });
    return;
  }

  if (event !== "projects_v2_item") {
    res.status(200).json({ ok: true, ignored: event });
    return;
  }

  const projectNodeId = payload.projects_v2_item?.project_node_id;
  if (!projectNodeId) {
    res.status(200).json({ ok: true, ignored: "no_project" });
    return;
  }

  // Acknowledge quickly; sync in background.
  console.info(
    `[github-webhook] accepted projects_v2_item action=${payload.action ?? "unknown"} project=${projectNodeId}`
  );
  res.status(202).json({
    ok: true,
    accepted: true,
    action: payload.action ?? null,
    projectNodeId,
  });

  void syncBoardsForProject(projectNodeId, payload.action).catch((err) => {
    console.warn(
      "[github-webhook] sync failed:",
      err instanceof Error ? err.message : err
    );
  });
}

async function syncBoardsForProject(
  projectNodeId: string,
  action?: string
): Promise<void> {
  const core = getCloudDb();
  let matched = 0;
  let synced = 0;
  let skipped = 0;
  for (const tenantId of listAllTenantIds(core)) {
    let db;
    try {
      db = getTenantDb(tenantId);
    } catch {
      continue;
    }
    let rows: Array<{ id: string; user_id: string }> = [];
    try {
      rows = db
        .prepare(
          `SELECT id, user_id FROM ai_projects
           WHERE sync_enabled=1
             AND github_project_node_id=?
             AND archived_at IS NULL
             AND user_id IS NOT NULL`
        )
        .all(projectNodeId) as Array<{ id: string; user_id: string }>;
    } catch {
      continue;
    }
    matched += rows.length;
    for (const row of rows) {
      try {
        const result = await syncBoardWithGithub({
          userId: row.user_id,
          db,
          boardId: row.id,
          skipIfBusy: true,
        });
        if (result.skipped) {
          skipped += 1;
          console.info(
            `[github-webhook] skipped busy tenant=${tenantId} board=${row.id} project=${projectNodeId}`
          );
        } else {
          synced += 1;
          console.info(
            `[github-webhook] synced tenant=${tenantId} board=${row.id} pulled=${result.pulled} action=${action ?? ""}`
          );
        }
      } catch (err) {
        console.warn(
          `[github-webhook] tenant=${tenantId} board=${row.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  if (matched === 0) {
    console.info(
      `[github-webhook] no linked boards for project=${projectNodeId} action=${action ?? ""}`
    );
  } else {
    console.info(
      `[github-webhook] done project=${projectNodeId} matched=${matched} synced=${synced} skipped=${skipped}`
    );
  }
}
