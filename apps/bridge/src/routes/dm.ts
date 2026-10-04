import { Router } from "express";
import multer from "multer";
import type { MarketplaceListingKind, ShareGrantRole } from "../core-db.js";
import { getHostUsersDb } from "../host-users-db.js";
import type { LlmManager } from "../services/llm-manager.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  DmError,
  ensureAgentDirectConversation,
  getConversationForUser,
  getPublicChannelRole,
  isConversationMember,
  listConversationMemberUserIds,
  listConversationsForUser,
  listDmContacts,
  listMessages,
  setPublicChannelMemberRole,
  softDeleteMessage,
  totalUnreadForUser,
  userCanAccessBlob,
} from "../services/dm-service.js";
import {
  canSendToPublicConversation,
  cloudLobbyIsLocal,
  fetchRemoteCloudLobbyChannels,
  fetchRemoteCloudLobbyMessages,
  getPublicChatEntitlement,
  isCloudLobbySlug,
  isPublicConversation,
  listCloudLobbyChannels,
  listInstallPublicChannels,
  publicSendDeniedMessage,
  seedPublicChannelCatalog,
  type PublicChannelRole,
  type PublicChannelView,
} from "../services/public-channels.js";

function withViewerRoles(
  hub: ReturnType<typeof getHostUsersDb>,
  userId: string,
  channels: PublicChannelView[]
): PublicChannelView[] {
  return channels.map((c) => ({
    ...c,
    viewerRole: getPublicChannelRole(hub, c.id, userId),
  }));
}
import {
  blobHref,
  BlobStoreError,
  getDmBlob,
  readDmBlobBytes,
} from "../services/blob-store.js";
import { getShareBroker } from "../ws-broker.js";
import { isUserOnline } from "../services/presence.js";
import { createNotification } from "../services/notification-service.js";
import { emitEvent } from "../services/event-bus.js";
import {
  executeCollectionAction,
  KernelError,
} from "../kernel/record-api.js";

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

export function authorizeTypingEvent(
  hub: ReturnType<typeof getHostUsersDb>,
  conversationId: string,
  authenticatedUserId: string,
  body: unknown
): string[] {
  // Public lobby: typing only for users who can actually post.
  // Private DMs: real membership required (not "public-readable" alone).
  if (isPublicConversation(hub, conversationId)) {
    if (
      !canSendToPublicConversation(hub, conversationId, authenticatedUserId)
    ) {
      throw new DmError(
        publicSendDeniedMessage(hub, conversationId),
        403
      );
    }
  } else if (!isConversationMember(hub, conversationId, authenticatedUserId)) {
    throw new DmError("Not a member of this conversation", 403);
  }
  const input =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  for (const field of ["userId", "senderUserId", "sender_user_id"]) {
    const claimed = input[field];
    if (
      claimed !== undefined &&
      (typeof claimed !== "string" || claimed !== authenticatedUserId)
    ) {
      throw new DmError("Typing sender does not match authenticated user", 403);
    }
  }
  return listConversationMemberUserIds(hub, conversationId);
}

export interface DmRouterDeps {
  llm: LlmManager;
  bridgePort: number;
}

export function createDmRouter(deps: DmRouterDeps): Router {
  const router = Router();

  /** Unauthenticated Cloud lobby catalog (Local installs proxy here). SaaS only. */
  router.get("/public-lobby", (_req, res) => {
    if (!cloudLobbyIsLocal()) {
      res.json({ channels: [] });
      return;
    }
    const hub = getHostUsersDb();
    seedPublicChannelCatalog(hub);
    const channels = listCloudLobbyChannels(hub);
    res.json({ channels });
  });

  router.get("/public-lobby/:slug/messages", (req, res) => {
    if (!cloudLobbyIsLocal()) {
      res.status(404).json({ error: "Cloud lobby is not hosted on this install" });
      return;
    }
    const hub = getHostUsersDb();
    seedPublicChannelCatalog(hub);
    const slug = paramId(req.params.slug).replace(/^#/, "");
    if (!isCloudLobbySlug(slug)) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const channel = listCloudLobbyChannels(hub).find((c) => c.slug === slug);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const before =
      typeof req.query.before === "string" ? req.query.before : undefined;
    const limitRaw =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
    // Same public message shape as authenticated reads (sender + attachments).
    // Local installs proxy this unauthenticated catalog for Cloud lobby history.
    try {
      const messages = listMessages(hub, channel.id, "public-lobby-reader", {
        before,
        limit,
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

  router.use(attachAuthContext, requireAuth);

  router.get("/contacts", (req, res) => {
    const email =
      typeof req.query.email === "string" ? req.query.email : undefined;
    const contacts = listDmContacts(getHostUsersDb(), req.user!.id, email);
    res.json({ contacts });
  });

  router.get("/unread", (req, res) => {
    res.json({ unread: totalUnreadForUser(getHostUsersDb(), req.user!.id) });
  });

  router.get("/public-chat-entitlement", (req, res) => {
    res.json({ entitlement: getPublicChatEntitlement(req.user!.id) });
  });

  router.get("/directory", async (req, res) => {
    const hub = getHostUsersDb();
    const userId = req.user!.id;
    const conversations = listConversationsForUser(hub, userId);
    const installPublic = withViewerRoles(
      hub,
      userId,
      listInstallPublicChannels(hub)
    );
    const cloudRaw = cloudLobbyIsLocal()
      ? listCloudLobbyChannels(hub)
      : await fetchRemoteCloudLobbyChannels();
    const cloudPublic = cloudLobbyIsLocal()
      ? withViewerRoles(hub, userId, cloudRaw)
      : cloudRaw.map((c) => ({
          ...c,
          viewerRole: (c.viewerRole ?? "visitor") as PublicChannelRole,
        }));
    const entitlement = getPublicChatEntitlement(userId);
    res.json({
      conversations,
      installChannels: installPublic,
      cloudChannels: cloudPublic,
      cloudLobbyOnline: cloudLobbyIsLocal() || cloudPublic.length > 0,
      /** True when this Bridge hosts Cloud lobby SoR (SaaS). Local proxies reads only. */
      cloudLobbyHostedHere: cloudLobbyIsLocal(),
      entitlement,
    });
  });

  router.post("/agent-dm", resolveTenant, (req, res) => {
    const agentId =
      typeof req.body?.agentId === "string" ? req.body.agentId.trim() : "";
    if (!agentId) {
      res.status(400).json({ error: "agentId required" });
      return;
    }
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    try {
      const conversation = ensureAgentDirectConversation(getHostUsersDb(), {
        userId: req.user!.id,
        agentId,
        // Channel agents live on the operator tenant; ensureAgentDirectConversation
        // remaps channel-* ids. Other agents use the active workspace.
        agentTenantId: tenantId,
      });
      res.json({ conversation });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/conversations", (req, res) => {
    const conversations = listConversationsForUser(getHostUsersDb(), req.user!.id);
    res.json({ conversations });
  });

  router.get("/cloud-lobby/:slug/messages", async (req, res) => {
    const slug = paramId(req.params.slug).replace(/^#/, "");
    const before =
      typeof req.query.before === "string" ? req.query.before : undefined;
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    if (cloudLobbyIsLocal()) {
      if (!isCloudLobbySlug(slug)) {
        res.status(404).json({ error: "Channel not found" });
        return;
      }
      const channel = listCloudLobbyChannels(getHostUsersDb()).find(
        (c) => c.slug === slug
      );
      if (!channel) {
        res.status(404).json({ error: "Channel not found" });
        return;
      }
      try {
        const messages = listMessages(
          getHostUsersDb(),
          channel.id,
          req.user!.id,
          {
            before,
            limit: Number.isFinite(limit) ? limit : undefined,
          }
        );
        res.json({ messages, plane: "cloud", slug });
      } catch (err) {
        if (err instanceof DmError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
      return;
    }
    const messages = await fetchRemoteCloudLobbyMessages(slug, {
      before,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ messages, plane: "cloud", slug });
  });

  router.get("/conversations/:id", (req, res) => {
    try {
      const conversation = getConversationForUser(
        getHostUsersDb(),
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
      const messages = listMessages(getHostUsersDb(), paramId(req.params.id), req.user!.id, {
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

  router.delete("/conversations/:id/messages/:messageId", (req, res) => {
    try {
      const message = softDeleteMessage(getHostUsersDb(), {
        conversationId: paramId(req.params.id),
        messageId: paramId(req.params.messageId),
        actorUserId: req.user!.id,
      });
      res.json({ message });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.patch("/conversations/:id/members/:userId/role", (req, res) => {
    const roleRaw =
      typeof req.body?.role === "string" ? req.body.role.trim() : "";
    const allowed: PublicChannelRole[] = [
      "admin",
      "moderator",
      "member",
      "visitor",
    ];
    if (!allowed.includes(roleRaw as PublicChannelRole)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    try {
      setPublicChannelMemberRole(getHostUsersDb(), {
        conversationId: paramId(req.params.id),
        actorUserId: req.user!.id,
        targetUserId: paramId(req.params.userId),
        role: roleRaw as PublicChannelRole,
      });
      res.json({
        ok: true,
        role: getPublicChannelRole(
          getHostUsersDb(),
          paramId(req.params.id),
          paramId(req.params.userId)
        ),
      });
    } catch (err) {
      if (err instanceof DmError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/conversations/:id/typing", (req, res) => {
    const core = getHostUsersDb();
    const conversationId = paramId(req.params.id);
    const userId = req.user!.id;
    try {
      const memberIds = authorizeTypingEvent(
        core,
        conversationId,
        userId,
        req.body
      );
      broadcastDm(
        conversationId,
        "dm_typing",
        { conversationId, userId, displayName: req.user!.displayName },
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

  router.post("/uploads", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file required" });
      return;
    }
    try {
      const uploaded = await executeCollectionAction(
        getHostUsersDb(),
        "DmBlob",
        "upload",
        {
          filename: file.originalname || "upload",
          mime: file.mimetype || "application/octet-stream",
          buffer: file.buffer,
        },
        {
          tenantId: req.tenantId,
          userId: req.user!.id,
          isAdmin: req.user!.isAdmin,
          role: req.tenantRole ?? "viewer",
          source: "http",
        }
      ) as {
        data: {
          id: string;
          filename: string;
          mime: string;
          size: number;
        };
      };
      const blob = uploaded.data;
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
      if (err instanceof KernelError || err instanceof BlobStoreError) {
        res.status(err instanceof KernelError ? err.status : 400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/blobs/:id", (req, res) => {
    const core = getHostUsersDb();
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
