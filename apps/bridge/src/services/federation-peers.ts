import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { getCoreDb, type CoreDatabase } from "../core-db.js";
import {
  getTailscaleStatus,
  inviteTailscaleUser,
  probeFederationHealth,
  suggestFederationPublicUrl,
} from "./tailscale/tailscale.js";
import { createShareGrant } from "./share-service.js";
import type { MarketplaceListingKind, ShareGrantRole } from "../core-db.js";

export interface PeerConnectionRow {
  id: string;
  local_user_id: string;
  remote_bridge_url: string;
  remote_user_id: string | null;
  remote_display_name: string | null;
  remote_email: string | null;
  tailscale_node_id: string | null;
  tailscale_dns_name: string | null;
  federation_token: string;
  status: string;
  last_health_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listPeerConnections(core: CoreDatabase, userId: string): PeerConnectionRow[] {
  return core
    .prepare(`SELECT * FROM peer_connections WHERE local_user_id=? ORDER BY created_at DESC`)
    .all(userId) as PeerConnectionRow[];
}

export function getNetworkStatus(): Record<string, unknown> {
  const ts = getTailscaleStatus();
  const suggestedUrl = suggestFederationPublicUrl();
  return {
    tailscale: ts,
    suggestedFederationUrl: suggestedUrl,
    currentFederationUrl: config.federation.publicUrl,
    bridgePort: config.port,
  };
}

export function enableTailscaleFederation(): { federationUrl: string | null; error?: string } {
  const url = suggestFederationPublicUrl();
  if (!url) {
    return { federationUrl: null, error: "Tailscale not running or MagicDNS unavailable" };
  }
  process.env.FEDERATION_PUBLIC_URL = url;
  return { federationUrl: url };
}

export function invitePeerByEmail(
  core: CoreDatabase,
  localUserId: string,
  email: string,
  remoteBridgeUrl?: string
): { inviteId: string; tailscale?: { ok: boolean; detail?: string } } {
  const tsInvite = inviteTailscaleUser(email);
  const id = uuidv4();
  const token = uuidv4();
  const url =
    remoteBridgeUrl?.trim() ||
    suggestFederationPublicUrl() ||
    config.federation.publicUrl;
  core.prepare(
    `INSERT INTO peer_connections
       (id, local_user_id, remote_bridge_url, remote_email, federation_token, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(id, localUserId, url, email.trim().toLowerCase(), token);
  return { inviteId: id, tailscale: tsInvite };
}

export function acceptPeerConnection(
  core: CoreDatabase,
  localUserId: string,
  opts: {
    remoteBridgeUrl: string;
    remoteUserId?: string;
    remoteDisplayName?: string;
    remoteEmail?: string;
    federationToken: string;
    tailscaleNodeId?: string;
    tailscaleDnsName?: string;
  }
): string {
  const existing = core
    .prepare(
      `SELECT id FROM peer_connections WHERE local_user_id=? AND remote_bridge_url=? AND federation_token=?`
    )
    .get(localUserId, opts.remoteBridgeUrl, opts.federationToken) as { id: string } | undefined;
  if (existing) {
    core.prepare(
      `UPDATE peer_connections SET status='active', remote_user_id=?, remote_display_name=?,
       remote_email=?, tailscale_node_id=?, tailscale_dns_name=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(
      opts.remoteUserId ?? null,
      opts.remoteDisplayName ?? null,
      opts.remoteEmail ?? null,
      opts.tailscaleNodeId ?? null,
      opts.tailscaleDnsName ?? null,
      existing.id
    );
    return existing.id;
  }
  const id = uuidv4();
  core.prepare(
    `INSERT INTO peer_connections
       (id, local_user_id, remote_bridge_url, remote_user_id, remote_display_name,
        remote_email, tailscale_node_id, tailscale_dns_name, federation_token, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id,
    localUserId,
    opts.remoteBridgeUrl,
    opts.remoteUserId ?? null,
    opts.remoteDisplayName ?? null,
    opts.remoteEmail ?? null,
    opts.tailscaleNodeId ?? null,
    opts.tailscaleDnsName ?? null,
    opts.federationToken
  );
  return id;
}

export async function refreshPeerHealth(core: CoreDatabase, userId: string): Promise<void> {
  const peers = listPeerConnections(core, userId);
  for (const p of peers) {
    const ok = await probeFederationHealth(p.remote_bridge_url, p.federation_token);
    core.prepare(
      `UPDATE peer_connections SET status=?, last_health_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    ).run(ok ? "online" : "offline", p.id);
  }
}

export function createFederatedShareInvite(
  core: CoreDatabase,
  opts: {
    ownerTenantId: string;
    ownerUserId: string;
    resourceKind: MarketplaceListingKind;
    resourceId: string;
    role?: ShareGrantRole;
    inviteeEmail: string;
  }
): { inviteId: string; inviteToken: string; inviteUrl: string } {
  const id = uuidv4();
  const token = uuidv4();
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  core.prepare(
    `INSERT INTO federated_share_invites
       (id, owner_tenant_id, owner_user_id, resource_kind, resource_id, role, invitee_email, invite_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.ownerTenantId,
    opts.ownerUserId,
    opts.resourceKind,
    opts.resourceId,
    opts.role ?? "viewer",
    opts.inviteeEmail.trim().toLowerCase(),
    token,
    expires
  );
  const base = (suggestFederationPublicUrl() ?? config.federation.publicUrl).replace(/\/$/, "");
  return {
    inviteId: id,
    inviteToken: token,
    inviteUrl: `${base}/api/federation/invites/accept?token=${token}`,
  };
}

export function acceptFederatedShareInvite(
  core: CoreDatabase,
  opts: {
    inviteToken: string;
    granteeUserId: string;
    granteeTenantId: string;
    granteeBridgeUrl: string;
    granteeDisplayName?: string;
    granteeEmail?: string;
  }
): { grantId: string; peerConnectionId: string } {
  const invite = core
    .prepare(`SELECT * FROM federated_share_invites WHERE invite_token=? AND status='pending'`)
    .get(opts.inviteToken) as Record<string, unknown> | undefined;
  if (!invite) throw new Error("Invite not found or already accepted");

  const peerId = acceptPeerConnection(core, opts.granteeUserId, {
    remoteBridgeUrl: String(invite.owner_tenant_id ? config.federation.publicUrl : config.federation.publicUrl),
    federationToken: uuidv4(),
    remoteEmail: opts.granteeEmail,
    remoteDisplayName: opts.granteeDisplayName,
  });

  const grantId = createShareGrant(core, {
    ownerTenantId: String(invite.owner_tenant_id),
    ownerUserId: String(invite.owner_user_id),
    resourceKind: invite.resource_kind as MarketplaceListingKind,
    resourceId: String(invite.resource_id),
    granteeUserId: opts.granteeUserId,
    granteeTenantId: opts.granteeTenantId,
    role: (invite.role as ShareGrantRole) ?? "viewer",
    bridgeUrl: config.federation.publicUrl,
    federationToken: uuidv4(),
  });

  core.prepare(
    `UPDATE federated_share_invites SET status='accepted', accepted_peer_connection_id=? WHERE invite_token=?`
  ).run(peerId, opts.inviteToken);

  return { grantId, peerConnectionId: peerId };
}

export function getPendingInviteByToken(
  core: CoreDatabase,
  token: string
): Record<string, unknown> | null {
  return (
    (core
      .prepare(`SELECT * FROM federated_share_invites WHERE invite_token=? AND status='pending'`)
      .get(token) as Record<string, unknown> | undefined) ?? null
  );
}
