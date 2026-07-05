import { v4 as uuidv4 } from "uuid";
import type {
  BridgeConnectionMode,
  CoreBridgeConnection,
  CoreDatabase,
} from "../core-db.js";

export function listBridgeConnections(
  core: CoreDatabase,
  ownerTenantId: string
): CoreBridgeConnection[] {
  return core
    .prepare(
      `SELECT * FROM bridge_connections
       WHERE owner_tenant_id = ?
       ORDER BY mode = 'local' DESC, created_at ASC`
    )
    .all(ownerTenantId) as CoreBridgeConnection[];
}

export function getBridgeConnection(
  core: CoreDatabase,
  id: string
): CoreBridgeConnection | null {
  return (
    (core
      .prepare(`SELECT * FROM bridge_connections WHERE id = ?`)
      .get(id) as CoreBridgeConnection | undefined) ?? null
  );
}

/** The owning tenant's local SC stack connection (this Bridge), if registered. */
export function getLocalConnection(
  core: CoreDatabase,
  ownerTenantId: string
): CoreBridgeConnection | null {
  return (
    (core
      .prepare(
        `SELECT * FROM bridge_connections
         WHERE owner_tenant_id = ? AND mode = 'local' AND status = 'active'
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(ownerTenantId) as CoreBridgeConnection | undefined) ?? null
  );
}

export function createBridgeConnection(
  core: CoreDatabase,
  opts: {
    ownerTenantId: string;
    ownerUserId: string;
    label: string;
    mode: BridgeConnectionMode;
    remoteBridgeUrl?: string | null;
    remoteBridgeToken?: string | null;
  }
): CoreBridgeConnection {
  const id = uuidv4();
  core.prepare(
    `INSERT INTO bridge_connections
       (id, owner_tenant_id, owner_user_id, label, mode,
        remote_bridge_url, remote_bridge_token, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id,
    opts.ownerTenantId,
    opts.ownerUserId,
    opts.label,
    opts.mode,
    opts.remoteBridgeUrl ?? null,
    opts.remoteBridgeToken ?? null
  );
  return getBridgeConnection(core, id)!;
}

export function touchBridgeConnection(core: CoreDatabase, id: string): void {
  core.prepare(
    `UPDATE bridge_connections
       SET last_seen_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(id);
}

export function deleteBridgeConnection(core: CoreDatabase, id: string): boolean {
  return (
    core.prepare(`DELETE FROM bridge_connections WHERE id = ?`).run(id).changes > 0
  );
}

/**
 * Idempotently register the operator tenant's local SC connection at startup so
 * the default workspace always has a resolvable local stack. Safe to call every
 * boot — it no-ops once a local connection exists.
 */
export function ensureLocalConnection(
  core: CoreDatabase,
  opts: { ownerTenantId: string; ownerUserId: string; label?: string }
): CoreBridgeConnection {
  const existing = getLocalConnection(core, opts.ownerTenantId);
  if (existing) {
    touchBridgeConnection(core, existing.id);
    return existing;
  }
  return createBridgeConnection(core, {
    ownerTenantId: opts.ownerTenantId,
    ownerUserId: opts.ownerUserId,
    label: opts.label ?? "Local connector",
    mode: "local",
  });
}
