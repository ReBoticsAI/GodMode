/**
 * REST API for Browser stage sessions (#850 / #852).
 * Mounted at `/browser` under `/api/ai`.
 */
import { Router, type Request, type Response } from "express";
import {
  browserStageAllowed,
  browserStageDeniedMessage,
} from "../services/browser/browser-access.js";
import {
  BrowserSessionError,
  browserClick,
  browserNavigate,
  browserScreenshot,
  browserSelect,
  browserSnapshot,
  browserType,
  closeBrowserSession,
  createBrowserSession,
  getBrowserSession,
  getBrowserSessionFrame,
  listBrowserSessions,
  setBrowserSessionMode,
  type BrowserSessionMode,
} from "../services/browser/browser-session.js";

function denyIfBlocked(res: Response): boolean {
  if (!browserStageAllowed()) {
    res.status(403).json({
      error: browserStageDeniedMessage(),
      browserDisabled: true,
    });
    return true;
  }
  return false;
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof BrowserSessionError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: msg });
}

function agentIdFrom(req: Request): string {
  const body = req.body as { agentId?: string } | undefined;
  return String(req.query.agentId ?? body?.agentId ?? "intelligence");
}

function tenantIdFrom(req: Request): string {
  return String(req.tenantId ?? "").trim();
}

export function createBrowserStageRouter(): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json({
      allowed: browserStageAllowed(),
      message: browserStageAllowed() ? null : browserStageDeniedMessage(),
    });
  });

  router.get("/sessions", (req, res) => {
    if (denyIfBlocked(res)) return;
    const tenantId = tenantIdFrom(req);
    const agentId = String(req.query.agentId ?? "").trim() || undefined;
    res.json({
      sessions: listBrowserSessions({
        tenantId: tenantId || undefined,
        agentId,
      }),
    });
  });

  router.post("/sessions", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const body = (req.body ?? {}) as {
        url?: string;
        allowHosts?: string[];
        maxSteps?: number;
        headless?: boolean;
      };
      const tenantId = tenantIdFrom(req);
      if (!tenantId) {
        res.status(400).json({ error: "tenant required" });
        return;
      }
      const session = await createBrowserSession({
        agentId: agentIdFrom(req),
        tenantId,
        url: body.url,
        allowHosts: body.allowHosts,
        maxSteps: body.maxSteps,
        headless: body.headless,
      });
      res.status(201).json({ session });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/sessions/:id", (req, res) => {
    if (denyIfBlocked(res)) return;
    const session = getBrowserSession(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ session });
  });

  router.get("/sessions/:id/frame", (req, res) => {
    if (denyIfBlocked(res)) return;
    const frame = getBrowserSessionFrame(String(req.params.id));
    if (!frame) {
      res.status(404).json({ error: "No frame yet" });
      return;
    }
    res.json({ frame });
  });

  router.post("/sessions/:id/navigate", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const url = String((req.body as { url?: string })?.url ?? "");
      const session = await browserNavigate(String(req.params.id), url);
      res.json({ session });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/sessions/:id/click", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const selector = String((req.body as { selector?: string })?.selector ?? "");
      const session = await browserClick(String(req.params.id), selector);
      res.json({ session });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/sessions/:id/type", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const body = (req.body ?? {}) as {
        selector?: string;
        text?: string;
        clear?: boolean;
        pressEnter?: boolean;
      };
      const session = await browserType(
        String(req.params.id),
        String(body.selector ?? ""),
        String(body.text ?? ""),
        { clear: body.clear, pressEnter: body.pressEnter }
      );
      res.json({ session });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/sessions/:id/select", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const body = (req.body ?? {}) as { selector?: string; value?: string };
      const session = await browserSelect(
        String(req.params.id),
        String(body.selector ?? ""),
        String(body.value ?? "")
      );
      res.json({ session });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/sessions/:id/screenshot", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const shot = await browserScreenshot(String(req.params.id));
      res.json({ screenshot: shot });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/sessions/:id/snapshot", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const snapshot = await browserSnapshot(String(req.params.id));
      res.json(snapshot);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/sessions/:id/mode", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const mode = String((req.body as { mode?: string })?.mode ?? "") as BrowserSessionMode;
      if (!["agent", "paused", "human"].includes(mode)) {
        res.status(400).json({ error: "mode must be agent | paused | human" });
        return;
      }
      const session = setBrowserSessionMode(String(req.params.id), mode);
      res.json({ session });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/sessions/:id", async (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      await closeBrowserSession(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
