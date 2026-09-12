import { Router } from "express";
import type { Request, Response } from "express";
import {
  attachAuthContext,
  resolveTenant,
} from "../services/auth/middleware.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import {
  ensureTrialInference,
  getTrialInferenceStatus,
  newVisitorKey,
} from "../services/trial-inference.js";
import type { LlmManager } from "../services/llm-manager.js";
import type { AppDatabase } from "../db.js";

const VISITOR_COOKIE = "gm_trial_visitor";

function clientIp(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function readVisitorKey(req: Request): string | undefined {
  const header = req.headers["x-godmode-visitor"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const raw = req.headers.cookie ?? "";
  const match = raw.match(/(?:^|;\s*)gm_trial_visitor=([^;]+)/);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return undefined;
}

function setVisitorCookie(res: Response, visitorKey: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${VISITOR_COOKIE}=${encodeURIComponent(visitorKey)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secure}`;
  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev.map(String), cookie]);
  } else {
    res.setHeader("Set-Cookie", [String(prev), cookie]);
  }
}

/**
 * First-land trial inference (#758 scaffolding).
 * GET status is public (soft visitor cookie). POST ensure provisions when possible.
 */
export function createTrialInferenceRouter(llm?: LlmManager): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    message: "Too many trial inference requests",
  });

  router.get("/status", attachAuthContext, limiter, (req, res) => {
    let visitorKey = readVisitorKey(req);
    if (!visitorKey && !req.user) {
      visitorKey = newVisitorKey();
      setVisitorCookie(res, visitorKey);
    }
    const status = getTrialInferenceStatus({
      userId: req.user?.id,
      visitorKey,
      clientIp: clientIp(req),
    });
    res.json(status);
  });

  router.post("/ensure", attachAuthContext, limiter, (req, res, next) => {
    // Authenticated callers get tenant DB for Vault attach; visitors stay public.
    if (!req.user) {
      next();
      return;
    }
    resolveTenant(req, res, next);
  }, async (req, res) => {
    try {
      let visitorKey = readVisitorKey(req);
      if (!visitorKey && !req.user) {
        visitorKey = newVisitorKey();
        setVisitorCookie(res, visitorKey);
      }
      const tenantDb: AppDatabase | null = req.user
        ? (req.tenantDb ?? null)
        : null;
      const status = await ensureTrialInference({
        userId: req.user?.id,
        visitorKey,
        clientIp: clientIp(req),
        tenantDb,
        llm: req.user ? llm ?? null : null,
        provision: true,
      });
      res.json(status);
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status)
          : 500;
      res.status(Number.isFinite(status) ? status : 500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
