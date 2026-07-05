import { getCoreDb, type MarketplaceListingKind } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { getAgent } from "./agents/agents-db.js";
import { resolveShareAccess } from "./share-service.js";
import { userHasTenantAccess } from "./tenant-bootstrap.js";
import { isConversationMember } from "./dm-service.js";

export function parseWsTenantIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, "http://localhost");
    const q = u.searchParams.get("tenantId")?.trim();
    return q || undefined;
  } catch {
    return undefined;
  }
}

export function parseWsSessionFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, "http://localhost");
    const q = u.searchParams.get("session")?.trim();
    return q || undefined;
  } catch {
    return undefined;
  }
}

export function resolveWsTenantId(
  userId: string | undefined,
  opts: {
    headerTenant?: string;
    queryTenant?: string;
    fallbackTenantId?: string;
  }
): string | undefined {
  const candidate = opts.queryTenant ?? opts.headerTenant;
  if (!userId || !candidate) return opts.fallbackTenantId;
  const role = userHasTenantAccess(getCoreDb(), userId, candidate);
  return role ? candidate : opts.fallbackTenantId;
}

export function canJoinTenantRoom(userId: string | undefined, room: string): boolean {
  if (!userId || !room.startsWith("tenant:")) return false;
  const tenantId = room.slice("tenant:".length);
  return userHasTenantAccess(getCoreDb(), userId, tenantId) != null;
}

export function canJoinUserRoom(userId: string | undefined, room: string): boolean {
  if (!userId || !room.startsWith("user:")) return false;
  return room === `user:${userId}`;
}

export function canJoinResourceRoom(
  userId: string | undefined,
  tenantId: string | undefined,
  kind: string,
  resourceId: string
): boolean {
  if (!userId) return false;
  if (kind === "conversation") {
    return isConversationMember(getCoreDb(), resourceId, userId);
  }
  if (!tenantId) return false;
  if (kind === "agent") {
    const owned = getAgent(getTenantDb(tenantId), resourceId);
    if (owned) return true;
  }
  return (
    resolveShareAccess(getCoreDb(), {
      userId,
      tenantId,
      resourceKind: kind as MarketplaceListingKind,
      resourceId,
      minRole: "viewer",
    }) != null
  );
}

export function canJoinRoom(
  userId: string | undefined,
  tenantId: string | undefined,
  room: string
): boolean {
  if (room.startsWith("tenant:")) return canJoinTenantRoom(userId, room);
  if (room.startsWith("user:")) return canJoinUserRoom(userId, room);
  if (room.startsWith("resource:")) {
    const rest = room.slice("resource:".length);
    const slash = rest.indexOf(":");
    if (slash <= 0) return false;
    const kind = rest.slice(0, slash);
    const resourceId = rest.slice(slash + 1);
    return canJoinResourceRoom(userId, tenantId, kind, resourceId);
  }
  return false;
}
