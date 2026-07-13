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
import type { SupportTicketStatus } from "../core-db.js";

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

const STATUSES: SupportTicketStatus[] = ["open", "in_progress", "resolved", "closed"];

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
    const isOwner =
      ticket.requester_kind === "user" && ticket.requester_id === req.user!.id;
    if (!isOwner && !req.user!.isAdmin) {
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
    const isOwner =
      ticket.requester_kind === "user" && ticket.requester_id === req.user!.id;
    if (!isOwner && !req.user!.isAdmin) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    try {
      const message = addMessage(
        id,
        { kind: req.user!.isAdmin && !isOwner ? "admin" : "user", id: req.user!.id },
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

  // --- admin triage ---
  router.get("/admin/tickets", requirePlatformAdmin, (req, res) => {
    const status = req.query.status as SupportTicketStatus | undefined;
    res.json({
      tickets: listAllTickets({
        status: status && STATUSES.includes(status) ? status : undefined,
      }),
    });
  });

  router.patch("/admin/tickets/:id", requirePlatformAdmin, (req, res) => {
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
