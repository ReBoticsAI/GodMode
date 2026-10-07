/**
 * Agent Support report jobs (replacing ticket inbox as the SoR for new reports).
 * Job 1: GitHub OSS (dedupe). Job 2: private Admin ops. Job 3: shared-resource owner.
 */
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import type { CoreDatabase } from "../core-db.js";
import { getCloudDb } from "../core-db.js";
import { getHostUsersDb } from "../host-users-db.js";
import { createNotification } from "./notification-service.js";
import { emitEvent } from "./event-bus.js";
import { listSupportStaffUserIds } from "./platform-groups.js";
import {
  reportOrUpdateCoreGithubIssue,
  supportScreenshotMarkdown,
  uploadCoreSupportScreenshot,
} from "./github-app-issues.js";
import { assertAgentToolRateLimit } from "./agent-tool-rate-limit.js";
import {
  ensureUserProject,
  firstVisibleColumnId,
  getUserBoard,
  newId,
  resolveUserBoardId,
} from "./user-productivity.js";
import { getUserOwnerTenantId } from "./user-scope.js";

export class SupportReportError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "SupportReportError";
  }
}

const REPORT_RATE = {
  max: 8,
  windowMs: 60 * 60 * 1000,
} as const;

function adminUserIds(): string[] {
  return (
    getCloudDb()
      .prepare(`SELECT id FROM users WHERE is_admin = 1`)
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}

function staffUserIds(): string[] {
  return [
    ...new Set([...adminUserIds(), ...listSupportStaffUserIds(getHostUsersDb())]),
  ];
}

/** Refuse public GitHub issue/PR text that looks like secrets or personal email. */
export function rejectPiiHints(text: string): void {
  const lower = text.toLowerCase();
  if (
    /password\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=]|bearer\s+[a-z0-9._-]+/i.test(
      text
    )
  ) {
    throw new SupportReportError(
      "Refuse to file: body looks like it contains secrets. Remove credentials and retry.",
      400
    );
  }
  if (
    /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/.test(text) &&
    !lower.includes("godmode.local")
  ) {
    throw new SupportReportError(
      "Refuse to file public GitHub report with email addresses. Use report_admin_ops for private ops, or strip PII.",
      400
    );
  }
}

function createOpsFollowupCard(opts: {
  tenantDb: AppDatabase;
  userId: string;
  agentId?: string | null;
  title: string;
  body: string;
  context: Record<string, unknown>;
}): { cardId: string; projectId: string; columnId: string; title: string } {
  const projectId = ensureUserProject(opts.userId, opts.tenantDb);
  const boardId = resolveUserBoardId(opts.userId, opts.tenantDb);
  const board = getUserBoard(opts.userId, opts.tenantDb, boardId);
  const columnId = board ? firstVisibleColumnId(board) : "backlog";
  const cardId = newId();
  const order = (
    opts.tenantDb
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS value
         FROM ai_project_cards WHERE project_id=? AND column_id=?`
      )
      .get(projectId, columnId) as { value: number }
  ).value;
  const tags = ["auto", "support", "ops-report", "release-followup"];
  opts.tenantDb
    .prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, description, prompt, context_json,
        tags_json, priority, assigned_agent_id, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cardId,
      projectId,
      columnId,
      opts.title.slice(0, 200),
      opts.body.slice(0, 2000) || null,
      [
        `Follow-up from Admin ops report.`,
        `Subject: ${opts.title}`,
        opts.body ? `Body:\n${opts.body.slice(0, 4000)}` : "",
        "Investigate and ship within Authority.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      JSON.stringify({ source: "ops_report", ...opts.context }),
      JSON.stringify(tags),
      2,
      opts.agentId ?? null,
      order + 1,
      "pending"
    );
  return {
    cardId,
    projectId,
    columnId,
    title: opts.title.slice(0, 200),
  };
}

export async function reportPlatformIssue(opts: {
  agentId: string;
  subject: string;
  body: string;
  forceNew?: boolean;
  /** Optional screenshot data URLs / base64 for the GitHub issue body. */
  images?: string[];
  tenantId?: string | null;
  actorKind: "user" | "agent";
  actorId: string;
}): Promise<{
  action: "created" | "commented";
  number: number;
  htmlUrl: string;
  matchedTitle?: string;
  screenshotUrls?: string[];
}> {
  assertAgentToolRateLimit({
    agentId: opts.agentId,
    toolName: "report_platform_issue",
    ...REPORT_RATE,
  });
  const subject = opts.subject.trim();
  const body = opts.body.trim();
  if (!subject) throw new SupportReportError("Subject is required");
  rejectPiiHints(`${subject}\n${body}`);

  const screenshotUrls: string[] = [];
  const imageInputs = Array.isArray(opts.images)
    ? opts.images.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 3)
    : [];
  for (const image of imageInputs) {
    try {
      const uploaded = await uploadCoreSupportScreenshot({ imageBase64: image });
      screenshotUrls.push(uploaded.rawUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SupportReportError(
        `Could not attach screenshot to GitHub issue: ${msg}`,
        (err as { status?: number })?.status === 400 ? 400 : 502
      );
    }
  }

  const result = await reportOrUpdateCoreGithubIssue({
    title: subject,
    body,
    forceNew: opts.forceNew === true,
    mediaMarkdown: supportScreenshotMarkdown(screenshotUrls),
  });

  const workspaceId =
    (typeof opts.tenantId === "string" && opts.tenantId.trim()
      ? opts.tenantId.trim()
      : null) ??
    (opts.actorKind === "user" ? getUserOwnerTenantId(opts.actorId) : null);
  if (workspaceId) {
    emitEvent({
      type: "support.platform_issue.reported",
      actor: { kind: opts.actorKind, id: opts.actorId },
      tenantId: workspaceId,
      payload: {
        action: result.action,
        issueNumber: result.number,
        htmlUrl: result.htmlUrl,
        subject,
        agentId: opts.agentId,
      },
    });
  }

  for (const userId of staffUserIds()) {
    createNotification(
      {
        recipientKind: "user",
        recipientId: userId,
        category: "support",
        title:
          result.action === "created"
            ? `GitHub issue #${result.number}: ${subject}`
            : `GitHub issue #${result.number} updated: ${subject}`,
        body: body.slice(0, 500),
        link: result.htmlUrl,
        resourceKind: "github_issue",
        resourceId: String(result.number),
      },
      getHostUsersDb()
    );
  }

  return {
    ...result,
    screenshotUrls: screenshotUrls.length ? screenshotUrls : undefined,
  };
}

export function reportAdminOps(opts: {
  agentId: string;
  subject: string;
  body: string;
  tenantId?: string | null;
  actorKind: "user" | "agent";
  actorId: string;
  /** When set with tenantDb, create a Kanban follow-up for this admin user. */
  createCardForUserId?: string | null;
  tenantDb?: AppDatabase | null;
}): {
  reportId: string;
  notified: number;
  card?: { cardId: string; projectId: string; columnId: string; title: string };
} {
  assertAgentToolRateLimit({
    agentId: opts.agentId,
    toolName: "report_admin_ops",
    ...REPORT_RATE,
  });
  const subject = opts.subject.trim();
  const body = opts.body.trim();
  if (!subject) throw new SupportReportError("Subject is required");

  const reportId = uuidv4();
  const hub = getHostUsersDb();
  let notified = 0;
  for (const userId of staffUserIds()) {
    createNotification(
      {
        recipientKind: "user",
        recipientId: userId,
        category: "support",
        title: `Admin ops: ${subject}`,
        body: body.slice(0, 2000) || null,
        link: "/admin?tab=support",
        resourceKind: "ops_report",
        resourceId: reportId,
      },
      hub
    );
    notified += 1;
  }

  let card:
    | { cardId: string; projectId: string; columnId: string; title: string }
    | undefined;
  if (opts.createCardForUserId && opts.tenantDb) {
    card = createOpsFollowupCard({
      tenantDb: opts.tenantDb,
      userId: opts.createCardForUserId,
      agentId: opts.agentId,
      title: `Ops: ${subject}`,
      body,
      context: { reportId, agentId: opts.agentId },
    });
  }

  const workspaceId =
    (typeof opts.tenantId === "string" && opts.tenantId.trim()
      ? opts.tenantId.trim()
      : null) ??
    (opts.actorKind === "user" ? getUserOwnerTenantId(opts.actorId) : null);
  if (workspaceId) {
    emitEvent({
      type: "ops.report.created",
      actor: { kind: opts.actorKind, id: opts.actorId },
      tenantId: workspaceId,
      payload: {
        reportId,
        subject,
        agentId: opts.agentId,
        cardId: card?.cardId ?? null,
      },
    });
  }

  return { reportId, notified, card };
}

export function reportSharedResourceIssue(opts: {
  agentId: string;
  subject: string;
  body: string;
  sharedGrantId: string;
  tenantId?: string | null;
  actorKind: "user" | "agent";
  actorId: string;
  hubDb?: CoreDatabase;
}): {
  grantId: string;
  ownerUserId: string;
  notifiedOwner: boolean;
} {
  assertAgentToolRateLimit({
    agentId: opts.agentId,
    toolName: "report_shared_resource_issue",
    ...REPORT_RATE,
  });
  const subject = opts.subject.trim();
  const body = opts.body.trim();
  if (!subject) throw new SupportReportError("Subject is required");
  const grantId = opts.sharedGrantId.trim();
  if (!grantId) throw new SupportReportError("sharedGrantId is required");

  const hub = opts.hubDb ?? getHostUsersDb();
  const grant = hub
    .prepare(
      `SELECT id, owner_user_id, resource_kind, resource_id, status
       FROM share_grants WHERE id = ?`
    )
    .get(grantId) as
    | {
        id: string;
        owner_user_id: string;
        resource_kind: string;
        resource_id: string;
        status: string;
      }
    | undefined;
  if (!grant) throw new SupportReportError("Share grant not found", 404);
  if (grant.status && grant.status !== "active") {
    throw new SupportReportError("Share grant is not active", 400);
  }

  const ownerUserId = String(grant.owner_user_id);
  createNotification(
    {
      recipientKind: "user",
      recipientId: ownerUserId,
      category: "support",
      title: `Shared resource issue: ${subject}`,
      body: body.slice(0, 2000) || null,
      link: `/vault?tab=sharing`,
      resourceKind: String(grant.resource_kind),
      resourceId: String(grant.resource_id),
    },
    hub
  );

  for (const userId of staffUserIds()) {
    if (userId === ownerUserId) continue;
    createNotification(
      {
        recipientKind: "user",
        recipientId: userId,
        category: "support",
        title: `Shared resource (cc staff): ${subject}`,
        body: body.slice(0, 500) || null,
        link: `/vault?tab=sharing`,
        resourceKind: String(grant.resource_kind),
        resourceId: String(grant.resource_id),
      },
      hub
    );
  }

  const workspaceId =
    (typeof opts.tenantId === "string" && opts.tenantId.trim()
      ? opts.tenantId.trim()
      : null) ??
    (opts.actorKind === "user" ? getUserOwnerTenantId(opts.actorId) : null);
  if (workspaceId) {
    emitEvent({
      type: "support.resource_issue.reported",
      actor: { kind: opts.actorKind, id: opts.actorId },
      tenantId: workspaceId,
      payload: {
        grantId,
        ownerUserId,
        subject,
        resourceKind: grant.resource_kind,
        resourceId: grant.resource_id,
        agentId: opts.agentId,
      },
    });
  }

  return { grantId, ownerUserId, notifiedOwner: true };
}
