import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import { getUserOwnerTenantId } from "../services/user-scope.js";
import { getCoreDb } from "../core-db.js";
import {
  addMessage,
  createTicket,
  getTicket,
  getTicketMessages,
  listAllTickets,
  listTicketsForRequester,
  listTicketsForOwner,
  SupportError,
  updateTicket,
} from "../services/support-service.js";
import {
  SUPPORT_GROUP_SLUG,
  addGroupMember,
  canStaffSupportAsUser,
  getGroupBySlug,
  listGroupMembers,
  removeGroupMember,
} from "../services/platform-groups.js";
import type { SupportTicketStatus } from "../core-db.js";

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

const STATUSES: SupportTicketStatus[] = ["open", "in_progress", "resolved", "closed"];

function canAccessTicket(
  ticket: NonNullable<ReturnType<typeof getTicket>>,
  user: { id: string; isAdmin?: boolean }
): boolean {
  const isRequester =
    ticket.requester_kind === "user" && ticket.requester_id === user.id;
  if (isRequester) return true;
  if (ticket.owner_user_id === user.id) return true;
  return canStaffSupportAsUser(user);
}

export function createSupportRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth);

  router.get("/tickets", (req, res) => {
    res.json({ tickets: listTicketsForRequester("user", req.user!.id) });
  });

  router.get("/staff/tickets", (req, res) => {
    if (!canStaffSupportAsUser(req.user!)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const status = req.query.status as SupportTicketStatus | undefined;
    const owned = listTicketsForOwner(req.user!.id);
    const all = listAllTickets({
      status: status && STATUSES.includes(status) ? status : undefined,
    });
    // Staff see all hub/shared tickets; owners also see theirs via owned merge.
    const byId = new Map(all.map((t) => [t.id, t]));
    for (const t of owned) byId.set(t.id, t);
    res.json({ tickets: [...byId.values()] });
  });

  router.get("/owner/tickets", (req, res) => {
    res.json({ tickets: listTicketsForOwner(req.user!.id) });
  });

  router.get("/tickets/:id", (req, res) => {
    const id = paramId(req.params.id);
    const ticket = getTicket(id);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    if (!canAccessTicket(ticket, req.user!)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    res.json({ ticket, messages: getTicketMessages(id) });
  });

  // --- Support group membership ---
  router.get("/group", (req, res) => {
    const group = getGroupBySlug(SUPPORT_GROUP_SLUG);
    if (!group) {
      res.status(404).json({ error: "Support group not found" });
      return;
    }
    const isStaff = canStaffSupportAsUser(req.user!);
    if (!isStaff && !req.user!.isAdmin) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const members = listGroupMembers(group.id).map((m) => ({
      ...m,
      tenant_id: m.tenant_id || null,
    }));
    res.json({
      group,
      members,
      canManage: Boolean(req.user!.isAdmin),
      isMember: canStaffSupportAsUser(req.user!),
    });
  });

  // --- admin triage (kept for Admin page; same ACL as staff) ---
  router.get("/admin/tickets", (req, res) => {
    if (!canStaffSupportAsUser(req.user!)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const status = req.query.status as SupportTicketStatus | undefined;
    res.json({
      tickets: listAllTickets({
        status: status && STATUSES.includes(status) ? status : undefined,
      }),
    });
  });

  return router;
}
