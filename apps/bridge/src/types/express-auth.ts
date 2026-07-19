import type { Response } from "express";
import type { CoreUser } from "../core-db.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      tenantId?: string;
      tenantRole?: import("../core-db.js").MembershipRole;
      tenantDb?: import("../db.js").AppDatabase;
      /** True when req.tenantId is the platform operator workspace. */
      tenantIsOperator?: boolean;
      sessionId?: string;
      sharedOwnerTenantId?: string;
      sharedResourceKind?: string;
      sharedResourceId?: string;
    }
  }
}

export function sendUnauthorized(res: Response, message = "Unauthorized"): void {
  res.status(401).json({ error: message });
}

export function sendForbidden(res: Response, message = "Forbidden"): void {
  res.status(403).json({ error: message });
}

export function coreUserToAuth(
  row: CoreUser,
  extras?: { mfaEnabled?: boolean }
): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    isAdmin: Boolean(row.is_admin),
    emailVerified: Boolean(row.email_verified_at),
    mfaEnabled: Boolean(extras?.mfaEnabled),
  };
}
