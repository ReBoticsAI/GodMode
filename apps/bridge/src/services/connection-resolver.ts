import type { CoreDatabase, CoreBridgeConnection, MarketplaceListingKind } from "../core-db.js";
import { getBridgeConnection, getLocalConnection } from "./bridge-connections.js";
import { resolveShareAccess } from "./share-service.js";

export type ResolvedConnection =
  | { mode: "local"; connection: CoreBridgeConnection; ownerTenantId: string }
  | {
      mode: "remote";
      connection: CoreBridgeConnection;
      ownerTenantId: string;
      remoteUrl: string;
      remoteToken: string;
    }
  | { mode: "offline"; ownerTenantId: string; reason: string };

/**
 * Resolve which Bridge connection backs a trading resource. Owned resources use
 * the tenant's local connection; shared resources use the grant's remote URL
 * + federation token when present, otherwise fall back to local on the owner Bridge.
 */
export function resolveConnectionForResource(
  core: CoreDatabase,
  opts: {
    userId: string;
    tenantId: string;
    resourceKind: MarketplaceListingKind;
    resourceId: string;
  }
): ResolvedConnection {
  const access = resolveShareAccess(core, {
    userId: opts.userId,
    tenantId: opts.tenantId,
    resourceKind: opts.resourceKind,
    resourceId: opts.resourceId,
    minRole: "viewer",
  });

  if (!access) {
    const local = getLocalConnection(core, opts.tenantId);
    if (!local) {
      return {
        mode: "offline",
        ownerTenantId: opts.tenantId,
        reason: "No local connector registered",
      };
    }
    return { mode: "local", connection: local, ownerTenantId: opts.tenantId };
  }

  const grant = core
    .prepare(
      `SELECT bridge_url, federation_token FROM share_grants
       WHERE owner_tenant_id=? AND resource_kind=? AND resource_id=?
         AND (grantee_user_id=? OR grantee_tenant_id=?)
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(
      access.ownerTenantId,
      opts.resourceKind,
      opts.resourceId,
      opts.userId,
      opts.tenantId
    ) as { bridge_url: string | null; federation_token: string | null } | undefined;

  const remoteUrl = grant?.bridge_url?.trim();
  const remoteToken = grant?.federation_token?.trim();
  if (remoteUrl && remoteToken) {
    const remoteConn: CoreBridgeConnection = {
      id: `remote:${access.ownerTenantId}`,
      owner_tenant_id: access.ownerTenantId,
      owner_user_id: "",
      label: "Shared remote Bridge",
      mode: "remote",
      remote_bridge_url: remoteUrl,
      remote_bridge_token: remoteToken,
      status: "online",
      last_seen_at: null,
      created_at: "",
      updated_at: "",
    };
    return {
      mode: "remote",
      connection: remoteConn,
      ownerTenantId: access.ownerTenantId,
      remoteUrl,
      remoteToken,
    };
  }

  const ownerLocal = getLocalConnection(core, access.ownerTenantId);
  if (!ownerLocal) {
    return {
      mode: "offline",
      ownerTenantId: access.ownerTenantId,
      reason: "Owner has no local connector",
    };
  }

  // Same Bridge process as owner (degenerate LAN case): use local stack.
  if (access.ownerTenantId === opts.tenantId || !remoteUrl) {
    return {
      mode: "local",
      connection: ownerLocal,
      ownerTenantId: access.ownerTenantId,
    };
  }

  return {
    mode: "offline",
    ownerTenantId: access.ownerTenantId,
    reason: "Owner Bridge unreachable (no federation URL on grant)",
  };
}

export function resolveConnectionById(
  core: CoreDatabase,
  connectionId: string
): CoreBridgeConnection | null {
  return getBridgeConnection(core, connectionId);
}
