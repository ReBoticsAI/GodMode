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

  router.post("/tickets", (req, res) => {
    const userId = req.user!.id;
    const { subject, body, category, targetKind, sharedGrantId, ownerUserId } = req.body ?? {};
    try {
      let resolvedOwnerId =
        typeof ownerUserId === "string" ? ownerUserId : undefined;
      if (!resolvedOwnerId && sharedGrantId) {
        const grant = getCoreDb()
          .prepare(`SELECT owner_user_id FROM share_grants WHERE id=?`)
          .get(String(sharedGrantId)) as { owner_user_id: string } | undefined;
        resolvedOwnerId = grant?.owner_user_id;
      }
      const result = createTicket({
        requesterKind: "user",
        requesterId: userId,
        requesterTenantId: getUserOwnerTenantId(userId),
        subject: String(subject ?? ""),
        body: String(body ?? ""),
        category: category ?? null,
        targetKind:
          targetKind === "platform_github"
            ? "platform_github"
            : targetKind === "platform_admin"
              ? "platform_admin"
              : "resource_owner",
        sharedGrantId: sharedGrantId ? String(sharedGrantId) : null,
        ownerUserId: resolvedOwnerId ?? null,
      });
      if ("redirectUrl" in result) {
        res.status(201).json(result);
        return;
      }
      res.status(201).json({ ticket: result });
    } catch (err) {
      if (err instanceof SupportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

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

  router.post("/tickets/:id/messages", (req, res) => {
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
    const isRequester =
      ticket.requester_kind === "user" && ticket.requester_id === req.user!.id;
    const isStaff = canStaffSupportAsUser(req.user!);
    try {
      const message = addMessage(
        id,
        {
          kind: isStaff && !isRequester ? "admin" : "user",
          id: req.user!.id,
        },
        String(req.body?.body ?? "")
      );
      res.status(201).json({ message });
    } catch (err) {
      if (err instanceof SupportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.patch("/tickets/:id", (req, res) => {
    const id = paramId(req.params.id);
    if (!canStaffSupportAsUser(req.user!)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const { status, priority } = req.body ?? {};
    try {
      const ticket = updateTicket(id, {
        status: status && STATUSES.includes(status) ? status : undefined,
        priority: priority !== undefined ? priority : undefined,
      });
      res.json({ ticket });
    } catch (err) {
      if (err instanceof SupportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
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

  router.post("/group/members", requirePlatformAdmin, (req, res) => {
    const group = getGroupBySlug(SUPPORT_GROUP_SLUG);
    if (!group) {
      res.status(404).json({ error: "Support group not found" });
      return;
    }
    const memberKind = req.body?.memberKind === "agent" ? "agent" : "user";
    const memberId = String(req.body?.memberId ?? "").trim();
    if (!memberId) {
      res.status(400).json({ error: "memberId required" });
      return;
    }
    try {
      const member = addGroupMember({
        groupId: group.id,
        memberKind,
        memberId,
        tenantId: req.body?.tenantId ? String(req.body.tenantId) : null,
      });
      res.status(201).json({
        member: { ...member, tenant_id: member.tenant_id || null },
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.delete("/group/members", requirePlatformAdmin, (req, res) => {
    const group = getGroupBySlug(SUPPORT_GROUP_SLUG);
    if (!group) {
      res.status(404).json({ error: "Support group not found" });
      return;
    }
    const memberKind = req.body?.memberKind === "agent" ? "agent" : "user";
    const memberId = String(req.body?.memberId ?? "").trim();
    if (!memberId) {
      res.status(400).json({ error: "memberId required" });
      return;
    }
    const ok = removeGroupMember({
      groupId: group.id,
      memberKind,
      memberId,
      tenantId: req.body?.tenantId ? String(req.body.tenantId) : null,
    });
    res.json({ ok });
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

  router.patch("/admin/tickets/:id", (req, res) => {
    if (!canStaffSupportAsUser(req.user!)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const id = paramId(req.params.id);
    const { status, priority } = req.body ?? {};
    try {
      const ticket = updateTicket(id, {
        status: status && STATUSES.includes(status) ? status : undefined,
        priority: priority !== undefined ? priority : undefined,
      });
      res.json({ ticket });
    } catch (err) {
      if (err instanceof SupportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
