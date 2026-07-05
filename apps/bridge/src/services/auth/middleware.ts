import type { Request, Response, NextFunction } from "express";
import { config } from "../../config.js";
import { getCoreDb } from "../../core-db.js";
import { getTenantDb } from "../../tenant-registry.js";
import { ensureUserAgent } from "../agents/user-agent.js";
import { isOperatorTenantId } from "../tenant-kind.js";
import type { AppDatabase } from "../../db.js";
import type { MembershipRole } from "../../core-db.js";
import {
  ensurePlatformBootstrap,
  listUserTenants,
  userHasTenantAccess,
  SYSTEM_USER_ID,
} from "../tenant-bootstrap.js";
import { coreUserToAuth, sendForbidden, sendUnauthorized } from "../../types/express-auth.js";
import {
  parseSessionCookie,
  resolveSession,
} from "./session-store.js";

const ROLE_RANK: Record<MembershipRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

let operatorTenantId: string | null = null;

export function getOperatorTenantIdCached(): string {
  if (!operatorTenantId) {
    const boot = ensurePlatformBootstrap();
    operatorTenantId = boot.operatorTenantId;
  }
  return operatorTenantId;
}

export function attachAuthContext(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const core = getCoreDb();
  for (const sessionId of collectRequestSessionIds(req)) {
    const resolved = resolveSession(core, sessionId);
    if (resolved) {
      req.user = coreUserToAuth(resolved.user);
      req.sessionId = resolved.sessionId;
      break;
    }
  }
  next();
}

/** Cookie, Bearer, header, and (dev) query session ids — all candidates, in priority order. */
function collectRequestSessionIds(req: Request): string[] {
  const ids: string[] = [];
  const push = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
  };

  push(parseSessionCookie(req.headers.cookie));

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    push(auth.slice(7));
  }

  push(
    typeof req.headers["x-godmode-session"] === "string"
      ? req.headers["x-godmode-session"]
      : undefined
  );

  if (!config.isProduction) {
    push(typeof req.query.session === "string" ? req.query.session : undefined);
  }

  return ids;
}

/** @deprecated Prefer attachAuthContext, which validates every candidate session id. */
export function resolveRequestSessionId(req: Request): string | undefined {
  return collectRequestSessionIds(req)[0];
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.user) {
    next();
    return;
  }
  if (config.auth.allowAnonymous) {
    req.user = {
      id: SYSTEM_USER_ID,
      email: "local@godmode.platform",
      displayName: "Local User",
      avatarUrl: null,
      isAdmin: false,
    };
    next();
    return;
  }
  sendUnauthorized(res);
}

export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.isAdmin) {
    next();
    return;
  }
  sendForbidden(res, "Platform admin required");
}

/** Require at least viewer/editor/owner on the resolved tenant. */
export function requireTenantRole(minRole: MembershipRole) {
  const minRank = ROLE_RANK[minRole];
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.tenantRole;
    if (!role || ROLE_RANK[role] < minRank) {
      sendForbidden(res, `${minRole} access required`);
      return;
    }
    next();
  };
}

/** Require editor+ for POST/PATCH/PUT/DELETE; pass through GET/HEAD/OPTIONS. */
export function requireEditorForMutation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  requireTenantRole("editor")(req, res, next);
}

export function resolveTenant(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const core = getCoreDb();
  const headerTenant =
    typeof req.headers["x-tenant-id"] === "string"
      ? req.headers["x-tenant-id"]
      : undefined;
  const queryTenant =
    typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;

  const userId = req.user?.id;
  const isAnonymousLocal = userId === SYSTEM_USER_ID;

  let tenantId = headerTenant ?? queryTenant;

  if (isAnonymousLocal) {
    tenantId = getOperatorTenantIdCached();
    req.tenantRole = "viewer";
  } else if (!userId) {
    sendUnauthorized(res);
    return;
  } else if (tenantId) {
    const role = userHasTenantAccess(core, userId, tenantId);
    if (!role) {
      const tenants = listUserTenants(core, userId);
      if (tenants.length > 0) {
        tenantId = tenants[0].id;
        req.tenantRole = tenants[0].role;
      } else {
        sendForbidden(res, "No workspace access");
        return;
      }
    } else {
      req.tenantRole = role;
    }
  } else {
    const tenants = listUserTenants(core, userId);
    if (tenants.length > 0) {
      tenantId = tenants[0].id;
      req.tenantRole = tenants[0].role;
    } else {
      sendForbidden(res, "No workspace access");
      return;
    }
  }

  req.tenantId = tenantId;
  req.tenantDb = getTenantDb(tenantId);
  req.tenantIsOperator = isOperatorTenantId(core, tenantId);
  if (req.user && tenantId) {
    try {
      ensureUserAgent(req.tenantDb, req.user);
    } catch (err) {
      console.warn("[auth] ensureUserAgent failed", err);
    }
  }
  next();
}

export function tenantDbMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  attachAuthContext(req, res, () => {
    requireAuth(req, res, () => {
      resolveTenant(req, res, next);
    });
  });
}

export function getReqTenantDb(req: Request): AppDatabase {
  if (req.tenantDb) return req.tenantDb;
  const tenantId = req.tenantId ?? getOperatorTenantIdCached();
  return getTenantDb(tenantId);
}
