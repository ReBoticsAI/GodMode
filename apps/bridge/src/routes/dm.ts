import { Router } from "express";
import multer from "multer";
import { getCoreDb, type MarketplaceListingKind, type ShareGrantRole } from "../core-db.js";
import type { LlmManager } from "../services/llm-manager.js";
import { scheduleAgentResponses } from "../services/agent-response-service.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  addConversationMember,
  createConversation,
  createMessage,
  DmError,
  getConversationForUser,
  listConversationMemberUserIds,
  listConversationsForUser,
  listDmContacts,
  listMessages,
  lookupUserByEmail,
  markConversationRead,
  removeConversationMember,
  shareResourceToConversation,
  totalUnreadForUser,
  userCanAccessBlob,
} from "../services/dm-service.js";
import {
  blobHref,
  BlobStoreError,
  getDmBlob,
  readDmBlobBytes,
  storeDmBlob,
} from "../services/blob-store.js";
import { getShareBroker } from "../ws-broker.js";
import { isUserOnline } from "../services/presence.js";
import { createNotification } from "../services/notification-service.js";
import { emitEvent } from "../services/event-bus.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function broadcastDm(
  conversationId: string,
  type: string,
  data: unknown,
  memberUserIds: string[]
): void {
  const broker = getShareBroker();
  const payload = { type, data, timestamp: Date.now() };
  broker.broadcastResource("conversation", conversationId, payload);
  for (const userId of memberUserIds) {
    broker.broadcastToRoom(`user:${userId}`, payload);
  }
}

export interface DmRouterDeps {
  llm: LlmManager;
  bridgePort: number;
}

export function createDmRouter(deps: DmRouterDeps): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth);

  router.get("/contacts", (req, res) => {
    const email =
      typeof req.query.email === "string" ? req.query.email : undefined;
    const contacts = listDmContacts(getCoreDb(), req.user!.id, email);
    res.json({ contacts });
  });

  router.get("/unread", (req, res) => {
    res.json({ unread: totalUnreadForUser(getCoreDb(), req.user!.id) });
  });

  router.get("/conversations", (req, res) => {
    const conversations = listConversationsForUser(getCoreDb(), req.user!.id);
    res.json({ conversations });
  });

  router.post("/conversations", resolveTenant, (req, res) => {
    const { kind, title, memberUserIds, memberEmails, memberAgents } = req.body ?? {};
    const core = getCoreDb();
    const userId = req.user!.id;
    const tenantId = req.tenantId!;
    const ids = new Set<string>(
      Array.isArray(memberUserIds)
        ? memberUserIds.filter((id: unknown) => typeof id === "string")
        : []
    );

    if (Array.isArray(memberEmails)) {
      for (const email of memberEmails) {
        if (typeof email !== "string") continue;
        const found = lookupUserByEmail(core, email, userId);
        if (found) ids.add(found.id);
      }
    }

    const agents = Array.isArray(memberAgents)
      ? memberAgents
          .filter(
            (a: unknown) =>
              a &&
              typeof a === "object" &&
              typeof (a as { agentId?: string }).agentId === "string"
          )
          .map((a: { agentId: string; agentTenantId?: string }) => ({
            agentId: a.agentId,
            agentTenantId: a.agentTenantId ?? tenantId,
          }))
      : [];

    try {
      const conversation = createConversation(core, {
        creatorUserId: userId,
        kind: kind === "group" ? "group" : "direct",
        title: typeof title === "string" ? title : null,
        memberUserIds: Array.from(ids),
        memberAgents: agents,
      });
      const memberIds = listConversationMemberUserIds(core, conversation.id);
      broadcastDm(conversation.id, "dm_conversation_created", { conversation }, memberIds);
      res.status(201).json({ conversation });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/conversations/:id", (req, res) => {
    try {
      const conversation = getConversationForUser(
        getCoreDb(),
        paramId(req.params.id),
        req.user!.id
      );
      res.json({ conversation });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/conversations/:id/messages", (req, res) => {
    const before =
      typeof req.query.before === "string" ? req.query.before : undefined;
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    try {
      const messages = listMessages(getCoreDb(), paramId(req.params.id), req.user!.id, {
        before,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({ messages });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/conversations/:id/messages", resolveTenant, (req, res) => {
    const { bodyText, attachments } = req.body ?? {};
    const core = getCoreDb();
    const userId = req.user!.id;
    const tenantId = req.tenantId!;
    const conversationId = paramId(req.params.id);
    try {
      const message = createMessage(core, {
        conversationId,
        senderUserId: userId,
        bodyText: typeof bodyText === "string" ? bodyText : "",
        attachments: Array.isArray(attachments) ? attachments : [],
      });
      const memberIds = listConversationMemberUserIds(core, conversationId);
      broadcastDm(conversationId, "dm_message", { message, conversationId }, memberIds);

      const senderName = message.sender?.displayName ?? "Someone";
      const preview =
        typeof bodyText === "string" && bodyText.trim()
          ? bodyText.trim().slice(0, 140)
          : "Sent an attachment";
      for (const memberId of memberIds) {
        if (memberId === userId || isUserOnline(memberId)) continue;
        createNotification({
          recipientKind: "user",
          recipientId: memberId,
          category: "dm",
          title: `New message from ${senderName}`,
          body: preview,
          link: "/?conversation=" + conversationId,
          resourceKind: "conversation",
          resourceId: conversationId,
        });
      }

      emitEvent({
        type: "dm.message.created",
        actor: { kind: "user", id: userId },
        tenantId,
        payload: {
          conversationId,
          messageId: message.id,
          senderUserId: userId,
          senderDisplayName: senderName,
          text: typeof bodyText === "string" ? bodyText : "",
        },
      });

      const text = typeof bodyText === "string" ? bodyText.trim() : "";
      if (text) {
        scheduleAgentResponses(
          { llm: deps.llm, bridgePort: deps.bridgePort },
          {
            core,
            conversationId,
            messageText: text,
            senderUserId: userId,
            senderDisplayName: message.sender?.displayName ?? "User",
            tenantId,
          }
        );
      }

      res.status(201).json({ message });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/conversations/:id/read", (req, res) => {
    const { messageId } = req.body ?? {};
    const core = getCoreDb();
    const userId = req.user!.id;
    const conversationId = paramId(req.params.id);
    try {
      markConversationRead(
        core,
        conversationId,
        userId,
        typeof messageId === "string" ? messageId : undefined
      );
      const memberIds = listConversationMemberUserIds(core, conversationId);
      broadcastDm(
        conversationId,
        "dm_read",
        { conversationId, userId, messageId: messageId ?? null },
        memberIds
      );
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/conversations/:id/members", (req, res) => {
    const { userId: newUserId, email } = req.body ?? {};
    const core = getCoreDb();
    const actorId = req.user!.id;
    const conversationId = paramId(req.params.id);
    try {
      let targetId = typeof newUserId === "string" ? newUserId : undefined;
      if (!targetId && typeof email === "string") {
        const found = lookupUserByEmail(core, email, actorId);
        if (!found) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        targetId = found.id;
      }
      if (!targetId) {
        res.status(400).json({ error: "userId or email required" });
        return;
      }
      const member = addConversationMember(core, conversationId, actorId, targetId);
      const memberIds = listConversationMemberUserIds(core, conversationId);
      broadcastDm(
        conversationId,
        "dm_member_added",
        { conversationId, member },
        memberIds
      );
      res.status(201).json({ member });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.delete("/conversations/:id/members/:userId", (req, res) => {
    const core = getCoreDb();
    const conversationId = paramId(req.params.id);
    try {
      removeConversationMember(
        core,
        conversationId,
        req.user!.id,
        paramId(req.params.userId)
      );
      const memberIds = listConversationMemberUserIds(core, conversationId);
      broadcastDm(
        conversationId,
        "dm_member_removed",
        { conversationId, userId: paramId(req.params.userId) },
        memberIds
      );
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/conversations/:id/share", resolveTenant, (req, res) => {
    const { resourceKind, resourceId, role } = req.body ?? {};
    if (typeof resourceKind !== "string" || typeof resourceId !== "string") {
      res.status(400).json({ error: "resourceKind and resourceId required" });
      return;
    }
    const core = getCoreDb();
    const conversationId = paramId(req.params.id);
    try {
      const grants = shareResourceToConversation(core, {
        conversationId,
        actorUserId: req.user!.id,
        actorTenantId: req.tenantId!,
        resourceKind: resourceKind as MarketplaceListingKind,
        resourceId,
        role: (role as ShareGrantRole) ?? "viewer",
      });
      const memberIds = listConversationMemberUserIds(core, conversationId);
      broadcastDm(
        conversationId,
        "dm_share",
        { conversationId, resourceKind, resourceId, grants },
        memberIds
      );
      res.json({ grants });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/conversations/:id/typing", (req, res) => {
    const core = getCoreDb();
    const conversationId = paramId(req.params.id);
    const userId = req.user!.id;
    try {
      const memberIds = listConversationMemberUserIds(core, conversationId);
      broadcastDm(
        conversationId,
        "dm_typing",
        { conversationId, userId, displayName: req.user!.displayName },
        memberIds
      );
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  router.post("/uploads", upload.single("file"), (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file required" });
      return;
    }
    try {
      const blob = storeDmBlob(getCoreDb(), {
        ownerUserId: req.user!.id,
        filename: file.originalname || "upload",
        mime: file.mimetype || "application/octet-stream",
        buffer: file.buffer,
      });
      res.status(201).json({
        blob: {
          id: blob.id,
          filename: blob.filename,
          mime: blob.mime,
          size: blob.size,
          href: blobHref(blob.id),
        },
      });
    } catch (err) {
      if (err instanceof BlobStoreError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/blobs/:id", (req, res) => {
    const core = getCoreDb();
    const blob = getDmBlob(core, paramId(req.params.id));
    if (!blob) {
      res.status(404).json({ error: "Blob not found" });
      return;
    }
    if (!userCanAccessBlob(core, blob.id, req.user!.id)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const bytes = readDmBlobBytes(blob);
      res.setHeader("Content-Type", blob.mime);
      res.setHeader("Content-Length", String(blob.size));
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${blob.filename.replace(/"/g, "")}"`
      );
      res.send(bytes);
    } catch (err) {
      if (err instanceof BlobStoreError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
