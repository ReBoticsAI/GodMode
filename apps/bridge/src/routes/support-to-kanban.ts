import type { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import { getTenantDb } from "../tenant-registry.js";
import { getHostUsersDb } from "../host-users-db.js";
import { getTicket } from "../services/support-service.js";
import { canStaffSupportAsUser } from "../services/platform-groups.js";
import { promoteSupportTicketToCard } from "../services/support-to-kanban.js";

/** POST /tickets/:id/to-kanban on the Support router (#445). */
export function registerSupportToKanbanRoute(router: Router): void {
  router.post(
    "/tickets/:id/to-kanban",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (req, res) => {
      try {
        const ticketId = String(req.params.id ?? "").trim();
        const hub = getHostUsersDb();
        const ticket = getTicket(ticketId, hub);
        if (!ticket) {
          res.status(404).json({ error: "Ticket not found" });
          return;
        }
        const user = req.user!;
        const isRequester =
          ticket.requester_kind === "user" && ticket.requester_id === user.id;
        const isOwner = ticket.owner_user_id === user.id;
        if (!isRequester && !isOwner && !canStaffSupportAsUser(user)) {
          res.status(403).json({ error: "Not allowed" });
          return;
        }
        const tenantId = req.tenantId;
        if (!tenantId) {
          res.status(400).json({ error: "Workspace required" });
          return;
        }
        const title =
          typeof req.body?.title === "string" ? req.body.title : undefined;
        const result = promoteSupportTicketToCard({
          tenantDb: getTenantDb(tenantId),
          hubDb: hub,
          ticketId,
          userId: user.id,
          title,
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        res.status(e?.status ?? 500).json({ error: e?.message ?? String(err) });
      }
    }
  );
}
