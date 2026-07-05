import { v4 as uuidv4 } from "uuid";
import {
  getCoreDb,
  type CoreDatabase,
  type CoreNotification,
  type NotificationRecipientKind,
} from "../core-db.js";
import { getShareBroker } from "../ws-broker.js";

export interface CreateNotificationInput {
  recipientKind: NotificationRecipientKind;
  recipientId: string;
  recipientTenantId?: string | null;
  category?: string;
  title: string;
  body?: string | null;
  link?: string | null;
  resourceKind?: string | null;
  resourceId?: string | null;
}

export interface NotificationRecipient {
  kind: NotificationRecipientKind;
  id: string;
}

function broadcastNotification(n: CoreNotification): void {
  // Agents have no live WS room; only push to human user rooms.
  if (n.recipient_kind !== "user") return;
  const broker = getShareBroker();
  broker.broadcastToRoom(`user:${n.recipient_id}`, {
    type: "notification",
    data: { notification: n },
    timestamp: Date.now(),
  });
}

export function createNotification(
  input: CreateNotificationInput,
  db: CoreDatabase = getCoreDb()
): CoreNotification {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO notifications
       (id, recipient_kind, recipient_id, recipient_tenant_id, category,
        title, body, link, resource_kind, resource_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.recipientKind,
    input.recipientId,
    input.recipientTenantId ?? null,
    input.category ?? "system",
    input.title,
    input.body ?? null,
    input.link ?? null,
    input.resourceKind ?? null,
    input.resourceId ?? null
  );
  const row = db
    .prepare(`SELECT * FROM notifications WHERE id = ?`)
    .get(id) as CoreNotification;
  broadcastNotification(row);
  return row;
}

export function listNotificationsForUser(
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
  db: CoreDatabase = getCoreDb()
): CoreNotification[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.unreadOnly ? "AND read_at IS NULL" : "";
  return db
    .prepare(
      `SELECT * FROM notifications
       WHERE recipient_kind = 'user' AND recipient_id = ? ${where}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as CoreNotification[];
}

export function listNotificationsForAgent(
  agentId: string,
  tenantId: string | null,
  opts: { unreadOnly?: boolean; limit?: number } = {},
  db: CoreDatabase = getCoreDb()
): CoreNotification[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.unreadOnly ? "AND read_at IS NULL" : "";
  if (tenantId) {
    return db
      .prepare(
        `SELECT * FROM notifications
         WHERE recipient_kind = 'agent' AND recipient_id = ?
           AND (recipient_tenant_id = ? OR recipient_tenant_id IS NULL) ${where}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(agentId, tenantId, limit) as CoreNotification[];
  }
  return db
    .prepare(
      `SELECT * FROM notifications
       WHERE recipient_kind = 'agent' AND recipient_id = ? ${where}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(agentId, limit) as CoreNotification[];
}

export function markRead(
  ids: string[],
  db: CoreDatabase = getCoreDb()
): number {
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL`
  );
  const tx = db.transaction((rows: string[]) => {
    let n = 0;
    for (const id of rows) n += stmt.run(now, id).changes;
    return n;
  });
  return tx(ids);
}

export function markAllRead(
  recipient: NotificationRecipient,
  db: CoreDatabase = getCoreDb()
): number {
  const now = new Date().toISOString();
  return db
    .prepare(
      `UPDATE notifications SET read_at = ?
       WHERE recipient_kind = ? AND recipient_id = ? AND read_at IS NULL`
    )
    .run(now, recipient.kind, recipient.id).changes;
}

/** Delete a single notification, scoped to its recipient so users can only
 * remove their own rows. Returns the number of rows removed (0 if not owned). */
export function deleteNotification(
  id: string,
  recipient: NotificationRecipient,
  db: CoreDatabase = getCoreDb()
): number {
  return db
    .prepare(
      `DELETE FROM notifications
       WHERE id = ? AND recipient_kind = ? AND recipient_id = ?`
    )
    .run(id, recipient.kind, recipient.id).changes;
}

/** Clear a recipient's notifications. With `readOnly`, only already-read rows
 * are removed (keeps unread); otherwise clears everything for the recipient. */
export function clearNotifications(
  recipient: NotificationRecipient,
  opts: { readOnly?: boolean } = {},
  db: CoreDatabase = getCoreDb()
): number {
  const where = opts.readOnly ? "AND read_at IS NOT NULL" : "";
  return db
    .prepare(
      `DELETE FROM notifications
       WHERE recipient_kind = ? AND recipient_id = ? ${where}`
    )
    .run(recipient.kind, recipient.id).changes;
}

export function unreadCount(
  recipient: NotificationRecipient,
  db: CoreDatabase = getCoreDb()
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM notifications
       WHERE recipient_kind = ? AND recipient_id = ? AND read_at IS NULL`
    )
    .get(recipient.kind, recipient.id) as { n: number };
  return row.n;
}
