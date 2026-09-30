import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  tenantDbMiddleware,
} from "../services/auth/middleware.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import {
  adminGrantUnlockables,
  completeUnlockTutorial,
  createUnlockSkipCheckout,
  dockChatOntoGraph,
  getChatGraphDoc,
  getChatUnlockStatus,
  getUnlockable,
  markTutorialStep,
  saveChatGraphDoc,
  startUnlockTutorial,
  unlockStripeConfigured,
} from "../services/chat-unlock.js";
import { config } from "../config.js";

export function createChatUnlockRouter(): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    message: "Too many unlock requests",
  });

  router.get("/status", attachAuthContext, (req, res) => {
    const userId = req.user?.id;
    res.json({
      ...getChatUnlockStatus(userId),
      stripeConfigured: unlockStripeConfigured(),
      canAdminGrant: Boolean(
        req.user?.isAdmin || config.auth.allowAnonymous
      ),
    });
  });

  /** Admin or local-preview: grant unlocks without tutorial / Stripe. */
  router.post(
    "/admin/grant",
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      try {
        const allowed =
          Boolean(req.user?.isAdmin) || config.auth.allowAnonymous;
        if (!allowed) {
          res.status(403).json({ error: "Admin grant required" });
          return;
        }
        const raw = req.body?.unlockableIds;
        const unlockableIds = Array.isArray(raw)
          ? raw.filter((id: unknown): id is string => typeof id === "string")
          : typeof req.body?.unlockableId === "string"
            ? [req.body.unlockableId.trim()]
            : ["chat_window"];
        const cleaned = unlockableIds.map((id) => id.trim()).filter(Boolean);
        if (cleaned.length === 0) {
          res.status(400).json({ error: "unlockableId(s) required" });
          return;
        }
        const entitlements = adminGrantUnlockables({
          userId: req.user!.id,
          unlockableIds: cleaned,
        });
        res.json({
          ok: true,
          entitlements,
          ...getChatUnlockStatus(req.user!.id),
          canAdminGrant: true,
        });
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  router.post(
    "/checkout",
    attachAuthContext,
    requireAuth,
    limiter,
    async (req, res) => {
      try {
        const unlockableId =
          typeof req.body?.unlockableId === "string"
            ? req.body.unlockableId.trim()
            : "";
        const successUrl =
          typeof req.body?.successUrl === "string"
            ? req.body.successUrl.trim()
            : "";
        const cancelUrl =
          typeof req.body?.cancelUrl === "string"
            ? req.body.cancelUrl.trim()
            : "";
        if (!unlockableId || !getUnlockable(unlockableId)) {
          res.status(400).json({ error: "Invalid unlockableId" });
          return;
        }
        if (!successUrl || !cancelUrl) {
          res.status(400).json({ error: "successUrl and cancelUrl required" });
          return;
        }
        const email = req.user!.email;
        const result = await createUnlockSkipCheckout({
          userId: req.user!.id,
          email,
          unlockableId,
          successUrl,
          cancelUrl,
        });
        res.json(result);
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  router.post(
    "/tutorial/start",
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      try {
        const unlockableId =
          typeof req.body?.unlockableId === "string"
            ? req.body.unlockableId.trim()
            : "";
        res.json(startUnlockTutorial(req.user!.id, unlockableId));
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  router.post(
    "/tutorial/step",
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      try {
        const unlockableId =
          typeof req.body?.unlockableId === "string"
            ? req.body.unlockableId.trim()
            : "";
        const step =
          typeof req.body?.step === "string" ? req.body.step.trim() : "";
        res.json(markTutorialStep(req.user!.id, unlockableId, step));
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  router.post(
    "/tutorial/complete",
    attachAuthContext,
    requireAuth,
    limiter,
    (req, res) => {
      try {
        const unlockableId =
          typeof req.body?.unlockableId === "string"
            ? req.body.unlockableId.trim()
            : "";
        res.json(completeUnlockTutorial(req.user!.id, unlockableId));
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: number }).status)
            : 500;
        res.status(Number.isFinite(status) ? status : 500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  router.get("/graph", attachAuthContext, requireAuth, (req, res) => {
    res.json(getChatGraphDoc(req.user!.id));
  });

  router.put(
    "/graph",
    attachAuthContext,
    requireAuth,
    tenantDbMiddleware,
    (req, res) => {
      const doc = req.body ?? {};
      res.json(
        saveChatGraphDoc(
          req.user!.id,
          {
            nodes: Array.isArray(doc.nodes) ? doc.nodes : [],
            edges: Array.isArray(doc.edges) ? doc.edges : [],
          },
          req.tenantId ?? null
        )
      );
    }
  );

  router.post(
    "/graph/dock",
    attachAuthContext,
    requireAuth,
    tenantDbMiddleware,
    (req, res) => {
      const chatId =
        typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";
      const label =
        typeof req.body?.label === "string" ? req.body.label.trim() : "Chat";
      if (!chatId) {
        res.status(400).json({ error: "chatId required" });
        return;
      }
      res.json(
        dockChatOntoGraph({
          userId: req.user!.id,
          chatId,
          label,
          tenantId: req.tenantId ?? null,
        })
      );
    }
  );

  return router;
}
