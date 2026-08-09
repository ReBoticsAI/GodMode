import { v4 as uuidv4 } from "uuid";
import {
  getCoreDb,
  type CoreDatabase,
  type CoreSupportMessage,
  type CoreSupportTicket,
  type SupportAuthorKind,
  type SupportRequesterKind,
  type SupportTicketStatus,
} from "../core-db.js";
import { getHostUsersDb } from "../host-users-db.js";
import { createNotification } from "./notification-service.js";
import { emitEvent } from "./event-bus.js";
import {
  listSupportStaffUserIds,
} from "./platform-groups.js";
import { createCoreGithubIssue } from "./github-app-issues.js";
import { githubAppConfigured } from "./github-app.js";

export class SupportError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "SupportError";
  }
}

function adminUserIds(): string[] {
  return (
    getCoreDb()
      .prepare(`SELECT id FROM users WHERE is_admin = 1`)
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}

/** Platform admins + Support group users (deduped). */
function staffUserIds(): string[] {
  return [
    ...new Set([...adminUserIds(), ...listSupportStaffUserIds(getHostUsersDb())]),
  ];
}

function notifyStaff(
  db: CoreDatabase,
  ticket: CoreSupportTicket,
  title: string,
  body: string
): void {
  for (const userId of staffUserIds()) {
    createNotification(
      {
        recipientKind: "user",
        recipientId: userId,
        category: "support",
        title,
        body,
        link: `/support?ticket=${ticket.id}&inbox=staff`,
        resourceKind: "support_ticket",
        resourceId: ticket.id,
      },
      db
    );
  }
}

export type SupportTargetKind = "platform_github" | "platform_admin" | "resource_owner";

export const GITHUB_ISSUES_NEW_URL =
  "https://github.com/ReBoticsAI/GodMode/issues/new";

export function buildGithubIssueUrl(subject: string, body: string): string {
  const params = new URLSearchParams();
  if (subject.trim()) params.set("title", subject.trim());
  if (body.trim()) params.set("body", body.trim());
  const qs = params.toString();
  return qs ? `${GITHUB_ISSUES_NEW_URL}?${qs}` : GITHUB_ISSUES_NEW_URL;
}

/** App-backed Core issue create for Support (async; use from HTTP handlers). */
export async function createPlatformGithubSupportIssue(opts: {
  subject: string;
  body: string;
}): Promise<{ htmlUrl: string; number: number } | { redirectUrl: string }> {
  if (githubAppConfigured()) {
    try {
      const issue = await createCoreGithubIssue({
        title: opts.subject.trim() || "GodMode support",
        body: [
          opts.body?.trim() || "",
          "",
          "_Filed via GodMode Support (GitHub App). Do not include secrets or PII._",
        ]
          .join("\n")
          .trim(),
        labels: ["support"],
      });
      return { htmlUrl: issue.htmlUrl, number: issue.number };
    } catch (err) {
      console.warn(
        "[support] App issue create failed, falling back to issues/new:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return { redirectUrl: buildGithubIssueUrl(opts.subject, opts.body) };
}

export interface CreateTicketInput {
  requesterKind: SupportRequesterKind;
  requesterId: string;
  requesterTenantId?: string | null;
  subject: string;
  body: string;
  category?: string | null;
  priority?: string | null;
  targetKind?: SupportTargetKind;
  sharedGrantId?: string | null;
  ownerUserId?: string | null;
}

export function createTicket(
  input: CreateTicketInput,
  db: CoreDatabase = getHostUsersDb()
): CoreSupportTicket | { redirectUrl: string; kind: "platform_github" } {
  if (input.targetKind === "platform_github") {
    // Interactive Support UI may call createCoreGithubIssue separately when App is configured.
    return {
      kind: "platform_github",
      redirectUrl: buildGithubIssueUrl(input.subject, input.body),
    };
  }
  const targetKind = input.targetKind ?? "resource_owner";
  const subject = input.subject.trim();
  if (!subject) throw new SupportError("Subject is required");
  const id = uuidv4();
  db.prepare(
    `INSERT INTO support_tickets
       (id, requester_kind, requester_id, requester_tenant_id, subject, body, category, priority,
        target_kind, shared_grant_id, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.requesterKind,
    input.requesterId,
    input.requesterTenantId ?? null,
    subject,
    input.body ?? "",
    input.category ?? null,
    input.priority ?? null,
    targetKind,
    input.sharedGrantId ?? null,
    input.ownerUserId ?? null
  );
  if (input.body && input.body.trim()) {
    db.prepare(
      `INSERT INTO support_messages (id, ticket_id, author_kind, author_id, body)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uuidv4(), id, input.requesterKind, input.requesterId, input.body.trim());
  }
  const ticket = getTicket(id, db)!;

  emitEvent(
    {
      type: "support.ticket.created",
      actor: { kind: input.requesterKind, id: input.requesterId },
      tenantId: input.requesterTenantId ?? null,
      payload: { ticketId: id, subject, category: input.category ?? null },
    },
    db
  );
  if (input.ownerUserId) {
    createNotification(
      {
        recipientKind: "user",
        recipientId: input.ownerUserId,
        category: "support",
        title: `Shared resource support: ${subject}`,
        body: input.body ?? "",
        link: `/support?ticket=${id}&inbox=staff`,
        resourceKind: "support_ticket",
        resourceId: id,
      },
      db
    );
    notifyStaff(db, ticket, `Shared resource support: ${subject}`, input.body ?? "");
  } else {
    const adminTitle =
      targetKind === "platform_admin"
        ? `Hub support request: ${subject}`
        : `New support ticket: ${subject}`;
    notifyStaff(db, ticket, adminTitle, input.body ?? "");
  }
  return ticket;
}

export function getTicket(
  id: string,
  db: CoreDatabase = getHostUsersDb()
): CoreSupportTicket | null {
  return (
    (db
      .prepare(`SELECT * FROM support_tickets WHERE id = ?`)
      .get(id) as CoreSupportTicket | undefined) ?? null
  );
}

export function listTicketsForOwner(
  ownerUserId: string,
  db: CoreDatabase = getHostUsersDb()
): CoreSupportTicket[] {
  return db
    .prepare(
      `SELECT * FROM support_tickets
       WHERE owner_user_id = ? AND target_kind = 'resource_owner'
       ORDER BY updated_at DESC`
    )
    .all(ownerUserId) as CoreSupportTicket[];
}

export function listTicketsForRequester(
  requesterKind: SupportRequesterKind,
  requesterId: string,
  db: CoreDatabase = getHostUsersDb()
): CoreSupportTicket[] {
  return db
    .prepare(
      `SELECT * FROM support_tickets
       WHERE requester_kind = ? AND requester_id = ?
       ORDER BY updated_at DESC`
    )
    .all(requesterKind, requesterId) as CoreSupportTicket[];
}

export function listAllTickets(
  opts: { status?: SupportTicketStatus } = {},
  db: CoreDatabase = getHostUsersDb()
): CoreSupportTicket[] {
  if (opts.status) {
    return db
      .prepare(
        `SELECT * FROM support_tickets WHERE status = ? ORDER BY updated_at DESC`
      )
      .all(opts.status) as CoreSupportTicket[];
  }
  return db
    .prepare(`SELECT * FROM support_tickets ORDER BY updated_at DESC`)
    .all() as CoreSupportTicket[];
}

export function getTicketMessages(
  ticketId: string,
  db: CoreDatabase = getHostUsersDb()
): CoreSupportMessage[] {
  return db
    .prepare(
      `SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC`
    )
    .all(ticketId) as CoreSupportMessage[];
}

export function addMessage(
  ticketId: string,
  author: { kind: SupportAuthorKind; id: string },
  body: string,
  db: CoreDatabase = getHostUsersDb()
): CoreSupportMessage {
  const ticket = getTicket(ticketId, db);
  if (!ticket) throw new SupportError("Ticket not found", 404);
  const text = body.trim();
  if (!text) throw new SupportError("Message body is required");
  const id = uuidv4();
  db.prepare(
    `INSERT INTO support_messages (id, ticket_id, author_kind, author_id, body)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, ticketId, author.kind, author.id, text);
  db.prepare(
    `UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?`
  ).run(ticketId);

  if (author.kind === "admin") {
    createNotification(
      {
        recipientKind: ticket.requester_kind,
        recipientId: ticket.requester_id,
        recipientTenantId: ticket.requester_tenant_id,
        category: "support",
        title: `Support replied: ${ticket.subject}`,
        body: text.slice(0, 200),
        link: "/support",
        resourceKind: "support_ticket",
        resourceId: ticket.id,
      },
      db
    );
  } else {
    notifyStaff(db, ticket, `New reply on: ${ticket.subject}`, text.slice(0, 200));
  }
  return db
    .prepare(`SELECT * FROM support_messages WHERE id = ?`)
    .get(id) as CoreSupportMessage;
}

export function updateTicket(
  ticketId: string,
  patch: { status?: SupportTicketStatus; priority?: string | null },
  db: CoreDatabase = getHostUsersDb()
): CoreSupportTicket {
  const ticket = getTicket(ticketId, db);
  if (!ticket) throw new SupportError("Ticket not found", 404);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.status) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  if (patch.priority !== undefined) {
    sets.push("priority = ?");
    values.push(patch.priority);
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE support_tickets SET ${sets.join(", ")} WHERE id = ?`).run(
      ...values,
      ticketId
    );
  }
  if (patch.status && patch.status !== ticket.status) {
    createNotification(
      {
        recipientKind: ticket.requester_kind,
        recipientId: ticket.requester_id,
        recipientTenantId: ticket.requester_tenant_id,
        category: "support",
        title: `Ticket ${patch.status}: ${ticket.subject}`,
        body: null,
        link: "/support",
        resourceKind: "support_ticket",
        resourceId: ticket.id,
      },
      db
    );
  }
  return getTicket(ticketId, db)!;
}
