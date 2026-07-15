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
  assertConversationMember,
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
  core: ReturnType<typeof getCoreDb>,
  conversationId: string,
  authenticatedUserId: string,
  body: unknown
): string[] {
  assertConversationMember(core, conversationId, authenticatedUserId);
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
  return listConversationMemberUserIds(core, conversationId);
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

  router.post("/conversations/:id/typing", (req, res) => {
    const core = getCoreDb();
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
        getCoreDb(),
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
