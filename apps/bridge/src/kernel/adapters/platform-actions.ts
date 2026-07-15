import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import type { AppDatabase } from "../../db.js";
import {
  createShareGrant,
  listShareGrantsForUser,
  revokeShareGrant,
} from "../../services/share-service.js";
import {
  createConversation,
  createMessage,
  getConversationForUser,
  listConversationsForUser,
  listMessages,
  markConversationRead,
} from "../../services/dm-service.js";
import {
  addMessage,
  createTicket,
  getTicket,
  getTicketMessages,
  listAllTickets,
  listTicketsForOwner,
  listTicketsForRequester,
  updateTicket,
} from "../../services/support-service.js";
import {
  addCatalogSource,
  listCatalogSources,
  removeCatalogSource,
} from "../../services/marketplace-catalog.js";
import {
  acquireLiveListing,
  cancelEntitlement,
  listEntitlementsForBuyer,
} from "../../services/entitlements.js";
import {
  createBridgeConnection,
  deleteBridgeConnection,
  getBridgeConnection,
  listBridgeConnections,
  touchBridgeConnection,
} from "../../services/bridge-connections.js";
import { listPeerConnections } from "../../services/federation-peers.js";
import {
  createInferenceEndpoint,
  getInferenceEndpoint,
  listInferenceEndpoints,
} from "../../services/inference-service.js";
import {
  HoldingsService,
  type HoldingCategory,
} from "../../services/holdings/holdings-service.js";
import type {
  OperationContext,
  RecordAdapter,
  RecordQuery,
} from "../adapter-registry.js";

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function requireUser(ctx: OperationContext): string {
  if (!ctx.userId) throw httpError(401, "Authenticated user required");
  return ctx.userId;
}

function requireTenant(ctx: OperationContext): string {
  if (!ctx.tenantId) throw httpError(401, "Tenant required");
  return ctx.tenantId;
}

function requiredText(data: RecordData, name: string): string {
  const value = data[name];
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${name} required`);
  }
  return value.trim();
}

function unsupported(operation: string): never {
  throw httpError(
    501,
    `${operation} is not available through the kernel; use the policy-enforcing platform workflow`
  );
}

function page<T>(rows: T[], query: RecordQuery): { rows: T[]; total: number } {
  const offset = Math.max(Number(query.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

function normalize(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function record(
  def: ObjectTypeDef,
  row: Record<string, unknown>,
  aliases: Record<string, string> = {}
): RecordRow {
  const data: RecordData = {};
  for (const field of def.fields) {
    if (field.secret) continue;
    const source = aliases[field.name] ?? field.name;
    if (source in row) data[field.name] = normalize(row[source]);
  }
  const id = String(row.id);
  return { id, objectType: def.name, data: { id, ...data } };
}

function result(
  def: ObjectTypeDef,
  rows: Array<Record<string, unknown>>,
  query: RecordQuery,
  aliases?: Record<string, string>
) {
  const paged = page(rows, query);
  return {
    objectType: def.name,
    records: paged.rows.map((row) => record(def, row, aliases)),
    total: paged.total,
  };
}

const DM_CONVERSATION_ALIASES = {
  created_by_user_id: "createdByUserId",
  created_at: "createdAt",
  updated_at: "updatedAt",
  last_message_at: "lastMessageAt",
  last_message_preview: "lastMessagePreview",
};

const DM_MESSAGE_ALIASES = {
  conversation_id: "conversationId",
  sender_user_id: "senderUserId",
  body_text: "bodyText",
  created_at: "createdAt",
  edited_at: "editedAt",
  deleted_at: "deletedAt",
};

export const shareGrantAdapter: RecordAdapter = {
  id: "share_grant_read",
  list(_db, def, query, ctx) {
    return result(def, listShareGrantsForUser(ctx.data!.coreDb, requireUser(ctx)), query);
  },
  get(_db, def, id, ctx) {
    const row = listShareGrantsForUser(ctx.data!.coreDb, requireUser(ctx)).find(
      (candidate) => String(candidate.id) === id
    );
    return row ? record(def, row) : null;
  },
  create(_db, def, data, ctx) {
    const core = ctx.data!.coreDb;
    const id = createShareGrant(core, {
      ownerTenantId: requireTenant(ctx),
      ownerUserId: requireUser(ctx),
      resourceKind: requiredText(data, "resource_kind") as never,
      resourceId: requiredText(data, "resource_id"),
      granteeUserId:
        typeof data.grantee_user_id === "string" ? data.grantee_user_id : undefined,
      granteeTenantId:
        typeof data.grantee_tenant_id === "string" ? data.grantee_tenant_id : undefined,
      role: typeof data.role === "string" ? (data.role as never) : undefined,
    });
    return this.get!(core, def, id, ctx)!;
  },
  delete(_db, _def, id, ctx) {
    revokeShareGrant(ctx.data!.coreDb, id, requireUser(ctx));
  },
  actions: {
    grant(db, def, _id, input, ctx) {
      return shareGrantAdapter.create!(db, def, input, ctx);
    },
    revoke(_db, _def, id, _input, ctx) {
      revokeShareGrant(ctx.data!.coreDb, id, requireUser(ctx));
      return { ok: true };
    },
  },
};

export const directConversationAdapter: RecordAdapter = {
  id: "dm_conversation_read",
  list(_db, def, query, ctx) {
    return result(
      def,
      listConversationsForUser(ctx.data!.coreDb, requireUser(ctx)) as unknown as Array<
        Record<string, unknown>
      >,
      query,
      DM_CONVERSATION_ALIASES
    );
  },
  get(_db, def, id, ctx) {
    try {
      return record(
        def,
        getConversationForUser(
          ctx.data!.coreDb,
          id,
          requireUser(ctx)
        ) as unknown as Record<string, unknown>,
        DM_CONVERSATION_ALIASES
      );
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  },
  create(_db, def, data, ctx) {
    const members = Array.isArray(data.member_user_ids)
      ? data.member_user_ids.filter((id): id is string => typeof id === "string")
      : [];
    const row = createConversation(ctx.data!.coreDb, {
      creatorUserId: requireUser(ctx),
      kind: data.kind === "group" ? "group" : "direct",
      title: typeof data.title === "string" ? data.title : undefined,
      memberUserIds: members,
    });
    return record(
      def,
      row as unknown as Record<string, unknown>,
      DM_CONVERSATION_ALIASES
    );
  },
  actions: {
    start(db, def, _id, input, ctx) {
      return directConversationAdapter.create!(db, def, input, ctx);
    },
    mark_read(_db, _def, id, input, ctx) {
      markConversationRead(
        ctx.data!.coreDb,
        id,
        requireUser(ctx),
        typeof input.message_id === "string" ? input.message_id : undefined
      );
      return { ok: true };
    },
  },
};

export const directMessageAdapter: RecordAdapter = {
  id: "dm_message_read",
  list(_db, def, query, ctx) {
    const conversationId =
      typeof query.filters?.conversation_id === "string"
        ? query.filters.conversation_id
        : undefined;
    if (!conversationId) throw httpError(400, "conversation_id filter required");
    return result(
      def,
      listMessages(ctx.data!.coreDb, conversationId, requireUser(ctx), {
        limit: Math.min(Math.max(Number(query.limit) || 50, 1), 200),
        before:
          typeof query.filters?.before === "string" ? query.filters.before : undefined,
      }) as unknown as Array<Record<string, unknown>>,
      { ...query, limit: 500, offset: 0 },
      DM_MESSAGE_ALIASES
    );
  },
  get(_db, def, id, ctx) {
    const core = ctx.data!.coreDb;
    const pointer = core
      .prepare("SELECT conversation_id FROM dm_messages WHERE id=?")
      .get(id) as { conversation_id: string } | undefined;
    if (!pointer) return null;
    const row = listMessages(core, pointer.conversation_id, requireUser(ctx), {
      limit: 200,
    }).find((message) => message.id === id);
    return row
      ? record(
          def,
          row as unknown as Record<string, unknown>,
          DM_MESSAGE_ALIASES
        )
      : null;
  },
  create(_db, def, data, ctx) {
    const row = createMessage(ctx.data!.coreDb, {
      conversationId: requiredText(data, "conversation_id"),
      senderUserId: requireUser(ctx),
      bodyText: typeof data.body_text === "string" ? data.body_text : undefined,
      attachments: Array.isArray(data.attachments) ? (data.attachments as never) : undefined,
    });
    return record(
      def,
      row as unknown as Record<string, unknown>,
      DM_MESSAGE_ALIASES
    );
  },
  actions: {
    send(db, def, _id, input, ctx) {
      return directMessageAdapter.create!(db, def, input, ctx);
    },
  },
};

function canAccessTicket(
  row: NonNullable<ReturnType<typeof getTicket>>,
  ctx: OperationContext
): boolean {
  if (ctx.isAdmin) return true;
  const userId = requireUser(ctx);
  return (
    (row.requester_kind === "user" && row.requester_id === userId) ||
    row.owner_user_id === userId
  );
}

function accessibleTickets(ctx: OperationContext) {
  const core = ctx.data!.coreDb;
  const userId = requireUser(ctx);
  if (ctx.isAdmin) return listAllTickets({}, core);
  const byId = new Map(
    [
      ...listTicketsForRequester("user", userId, core),
      ...listTicketsForOwner(userId, core),
    ].map((ticket) => [ticket.id, ticket])
  );
  return [...byId.values()];
}

export const supportTicketAdapter: RecordAdapter = {
  id: "support_ticket_read",
  list(_db, def, query, ctx) {
    return result(
      def,
      accessibleTickets(ctx) as unknown as Array<Record<string, unknown>>,
      query
    );
  },
  get(_db, def, id, ctx) {
    const row = getTicket(id, ctx.data!.coreDb);
    return row && canAccessTicket(row, ctx)
      ? record(def, row as unknown as Record<string, unknown>)
      : null;
  },
  create(_db, def, data, ctx) {
    const row = createTicket(
      {
        requesterKind: "user",
        requesterId: requireUser(ctx),
        requesterTenantId: requireTenant(ctx),
        subject: requiredText(data, "subject"),
        body: typeof data.body === "string" ? data.body : "",
        category: typeof data.category === "string" ? data.category : undefined,
        priority: typeof data.priority === "string" ? data.priority : undefined,
        targetKind:
          typeof data.target_kind === "string" ? (data.target_kind as never) : undefined,
        sharedGrantId:
          typeof data.shared_grant_id === "string" ? data.shared_grant_id : undefined,
        ownerUserId:
          typeof data.owner_user_id === "string" ? data.owner_user_id : undefined,
      },
      ctx.data!.coreDb
    );
    if ("redirectUrl" in row) {
      throw httpError(409, "GitHub support requires the interactive support workflow");
    }
    return record(def, row as unknown as Record<string, unknown>);
  },
  actions: {
    open(db, def, _id, input, ctx) {
      return supportTicketAdapter.create!(db, def, input, ctx);
    },
    reply(_db, def, id, input, ctx) {
      const ticket = getTicket(id, ctx.data!.coreDb);
      if (!ticket || !canAccessTicket(ticket, ctx)) throw httpError(404, "Ticket not found");
      const row = addMessage(
        id,
        { kind: ctx.isAdmin ? "admin" : "user", id: requireUser(ctx) },
        requiredText(input, "body"),
        ctx.data!.coreDb
      );
      return record(def, row as unknown as Record<string, unknown>);
    },
    set_status(_db, def, id, input, ctx) {
      if (!ctx.isAdmin) throw httpError(403, "Support staff required");
      const row = updateTicket(
        id,
        {
          status:
            typeof input.status === "string" ? (input.status as never) : undefined,
          priority:
            input.priority === null || typeof input.priority === "string"
              ? input.priority
              : undefined,
        },
        ctx.data!.coreDb
      );
      return record(def, row as unknown as Record<string, unknown>);
    },
  },
};

export const supportMessageAdapter: RecordAdapter = {
  id: "support_message_read",
  list(_db, def, query, ctx) {
    const ticketId =
      typeof query.filters?.ticket_id === "string" ? query.filters.ticket_id : "";
    const ticket = getTicket(ticketId, ctx.data!.coreDb);
    if (!ticket || !canAccessTicket(ticket, ctx)) throw httpError(404, "Ticket not found");
    return result(
      def,
      getTicketMessages(ticketId, ctx.data!.coreDb) as unknown as Array<
        Record<string, unknown>
      >,
      query
    );
  },
  get(_db, def, id, ctx) {
    const row = ctx.data!.coreDb
      .prepare("SELECT ticket_id FROM support_messages WHERE id=?")
      .get(id) as { ticket_id: string } | undefined;
    if (!row) return null;
    const ticket = getTicket(row.ticket_id, ctx.data!.coreDb);
    if (!ticket || !canAccessTicket(ticket, ctx)) return null;
    const message = getTicketMessages(row.ticket_id, ctx.data!.coreDb).find(
      (candidate) => candidate.id === id
    );
    return message
      ? record(def, message as unknown as Record<string, unknown>)
      : null;
  },
  actions: {
    reply(_db, def, _id, input, ctx) {
      return supportTicketAdapter.actions!.reply(
        ctx.data!.coreDb,
        def,
        requiredText(input, "ticket_id"),
        input,
        ctx
      );
    },
  },
};

export const catalogSourceAdapter: RecordAdapter = {
  id: "catalog_source_read",
  list(_db, def, query, ctx) {
    return result(
      def,
      listCatalogSources(ctx.data!.coreDb, requireUser(ctx)),
      query
    );
  },
  get(_db, def, id, ctx) {
    const row = listCatalogSources(ctx.data!.coreDb, requireUser(ctx)).find(
      (source) => source.id === id
    );
    return row ? record(def, row) : null;
  },
  create(_db, def, data, ctx) {
    const core = ctx.data!.coreDb;
    const userId = requireUser(ctx);
    const id = addCatalogSource(
      core,
      userId,
      requiredText(data, "name"),
      requiredText(data, "url")
    );
    return record(def, listCatalogSources(core, userId).find((row) => row.id === id)!);
  },
  delete(_db, _def, id, ctx) {
    if (!removeCatalogSource(ctx.data!.coreDb, requireUser(ctx), id)) {
      throw httpError(404, "Catalog source not found");
    }
  },
  actions: {
    add(db, def, _id, input, ctx) {
      return catalogSourceAdapter.create!(db, def, input, ctx);
    },
    remove(_db, _def, id, _input, ctx) {
      if (!removeCatalogSource(ctx.data!.coreDb, requireUser(ctx), id)) {
        throw httpError(404, "Catalog source not found");
      }
      return { ok: true };
    },
    fetch_external() {
      return unsupported("External catalog fetch");
    },
  },
};

function visibleListings(core: AppDatabase, ctx: OperationContext) {
  const userId = requireUser(ctx);
  return core
    .prepare(
      `SELECT * FROM marketplace_listings
       WHERE (status='active' AND visibility='public') OR seller_user_id=?
       ORDER BY created_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;
}

export const marketplaceListingAdapter: RecordAdapter = {
  id: "marketplace_listing_read",
  list(_db, def, query, ctx) {
    return result(def, visibleListings(ctx.data!.coreDb, ctx), query);
  },
  get(_db, def, id, ctx) {
    const row = visibleListings(ctx.data!.coreDb, ctx).find(
      (listing) => String(listing.id) === id
    );
    return row ? record(def, row) : null;
  },
  actions: {
    acquire_live(_db, _def, id, _input, ctx) {
      const listing = ctx.data!.coreDb
        .prepare(
          `SELECT * FROM marketplace_listings
           WHERE id=? AND status='active' AND visibility='public'`
        )
        .get(id) as Record<string, unknown> | undefined;
      if (!listing) throw httpError(404, "Listing not found");
      if (listing.delivery_mode !== "live") {
        return unsupported("Clone marketplace acquisition");
      }
      return acquireLiveListing(ctx.data!.coreDb, {
        listing,
        buyerUserId: requireUser(ctx),
        buyerTenantId: requireTenant(ctx),
      });
    },
    publish() {
      return unsupported("Marketplace publishing");
    },
    archive() {
      return unsupported("Marketplace archival");
    },
  },
};

export const marketplaceEntitlementAdapter: RecordAdapter = {
  id: "marketplace_entitlement_read",
  list(_db, def, query, ctx) {
    return result(
      def,
      listEntitlementsForBuyer(
        ctx.data!.coreDb,
        requireUser(ctx),
        requireTenant(ctx)
      ),
      query
    );
  },
  get(_db, def, id, ctx) {
    const row = listEntitlementsForBuyer(
      ctx.data!.coreDb,
      requireUser(ctx),
      requireTenant(ctx)
    ).find((entitlement) => String(entitlement.id) === id);
    return row ? record(def, row) : null;
  },
  actions: {
    cancel(_db, _def, id, _input, ctx) {
      cancelEntitlement(ctx.data!.coreDb, id, requireUser(ctx));
      return { ok: true };
    },
  },
};

export const bridgeConnectionAdapter: RecordAdapter = {
  id: "bridge_connection_read",
  list(_db, def, query, ctx) {
    return result(
      def,
      listBridgeConnections(ctx.data!.coreDb, requireTenant(ctx)) as unknown as Array<
        Record<string, unknown>
      >,
      query
    );
  },
  get(_db, def, id, ctx) {
    const row = getBridgeConnection(ctx.data!.coreDb, id);
    return row && row.owner_tenant_id === requireTenant(ctx)
      ? record(def, row as unknown as Record<string, unknown>)
      : null;
  },
  create(_db, def, data, ctx) {
    const row = createBridgeConnection(ctx.data!.coreDb, {
      ownerTenantId: requireTenant(ctx),
      ownerUserId: requireUser(ctx),
      label: requiredText(data, "label"),
      mode: requiredText(data, "mode") as never,
      remoteBridgeUrl:
        typeof data.remote_bridge_url === "string" ? data.remote_bridge_url : undefined,
      remoteBridgeToken:
        typeof data.remote_bridge_token === "string"
          ? data.remote_bridge_token
          : undefined,
    });
    return record(def, row as unknown as Record<string, unknown>);
  },
  delete(_db, _def, id, ctx) {
    const row = getBridgeConnection(ctx.data!.coreDb, id);
    if (!row || row.owner_tenant_id !== requireTenant(ctx)) {
      throw httpError(404, "Bridge connection not found");
    }
    if (!deleteBridgeConnection(ctx.data!.coreDb, id)) {
      throw httpError(404, "Bridge connection not found");
    }
  },
  actions: {
    register(db, def, _id, input, ctx) {
      return bridgeConnectionAdapter.create!(db, def, input, ctx);
    },
    touch(_db, _def, id, _input, ctx) {
      const row = getBridgeConnection(ctx.data!.coreDb, id);
      if (!row || row.owner_tenant_id !== requireTenant(ctx)) {
        throw httpError(404, "Bridge connection not found");
      }
      touchBridgeConnection(ctx.data!.coreDb, id);
      return { ok: true };
    },
    probe_remote() {
      return unsupported("Remote bridge probing");
    },
  },
};

export const peerConnectionAdapter: RecordAdapter = {
  id: "peer_connection_read",
  list(_db, def, query, ctx) {
    return result(
      def,
      listPeerConnections(ctx.data!.coreDb, requireUser(ctx)) as unknown as Array<
        Record<string, unknown>
      >,
      query
    );
  },
  get(_db, def, id, ctx) {
    const row = listPeerConnections(ctx.data!.coreDb, requireUser(ctx)).find(
      (peer) => peer.id === id
    );
    return row
      ? record(def, row as unknown as Record<string, unknown>)
      : null;
  },
  actions: {
    invite() {
      return unsupported("Peer invitation");
    },
    accept() {
      return unsupported("Peer acceptance");
    },
    refresh_health() {
      return unsupported("Peer health refresh");
    },
  },
};

export const inferenceEndpointAdapter: RecordAdapter = {
  id: "inference_endpoint_read",
  list(_db, def, query, ctx) {
    return result(
      def,
      listInferenceEndpoints(ctx.data!.coreDb, requireUser(ctx)),
      query
    );
  },
  get(_db, def, id, ctx) {
    const row = getInferenceEndpoint(ctx.data!.coreDb, id);
    return row &&
      row.owner_user_id === requireUser(ctx) &&
      row.owner_tenant_id === requireTenant(ctx)
      ? record(def, row)
      : null;
  },
  create(_db, def, data, ctx) {
    const core = ctx.data!.coreDb;
    const id = createInferenceEndpoint(core, {
      ownerTenantId: requireTenant(ctx),
      ownerUserId: requireUser(ctx),
      name: requiredText(data, "name"),
      baseModelPath: requiredText(data, "base_model_path"),
      adapterIds: Array.isArray(data.adapter_ids_json)
        ? data.adapter_ids_json.filter((value): value is string => typeof value === "string")
        : undefined,
      meterUnit:
        typeof data.meter_unit === "string" ? data.meter_unit : undefined,
      meterRate:
        typeof data.meter_rate === "number" ? data.meter_rate : undefined,
      capacityHint:
        typeof data.capacity_hint === "number" ? data.capacity_hint : undefined,
    });
    return record(def, getInferenceEndpoint(core, id)!);
  },
  actions: {
    publish(db, def, _id, input, ctx) {
      return inferenceEndpointAdapter.create!(db, def, input, ctx);
    },
    run_remote() {
      return unsupported("Remote inference");
    },
  },
};

const FINANCE_ALIASES = {
  external_id: "externalId",
  balance_cad: "balanceCad",
  breakdown_json: "breakdown",
  last_synced_at: "lastSyncedAt",
  created_at: "createdAt",
};

export const financeConnectionAdapter: RecordAdapter = {
  id: "finance_connection_service",
  list(db, def, query) {
    return result(
      def,
      new HoldingsService(db).list() as unknown as Array<Record<string, unknown>>,
      query,
      FINANCE_ALIASES
    );
  },
  get(db, def, id) {
    const row = new HoldingsService(db).get(id);
    return row
      ? record(def, row as unknown as Record<string, unknown>, FINANCE_ALIASES)
      : null;
  },
  create(db, def, data) {
    const row = new HoldingsService(db).create({
      category: requiredText(data, "category") as HoldingCategory,
      provider: requiredText(data, "provider"),
      label: requiredText(data, "label"),
      currency: requiredText(data, "currency"),
      reference:
        typeof data.reference === "string" ? data.reference : undefined,
      externalId:
        typeof data.external_id === "string" ? data.external_id : undefined,
      balance: Number(data.balance ?? 0),
      balanceCad: Number(data.balance_cad ?? data.balance ?? 0),
      breakdown: data.breakdown_json,
      status: typeof data.status === "string" ? (data.status as never) : undefined,
    });
    return record(
      def,
      row as unknown as Record<string, unknown>,
      FINANCE_ALIASES
    );
  },
  delete(db, _def, id) {
    if (!new HoldingsService(db).delete(id)) {
      throw httpError(404, "Finance connection not found");
    }
  },
  actions: {
    add_manual(db, def, _id, input, ctx) {
      return financeConnectionAdapter.create!(db, def, input, ctx);
    },
    disconnect(db, _def, id) {
      if (!new HoldingsService(db).delete(id)) {
        throw httpError(404, "Finance connection not found");
      }
      return { ok: true };
    },
    connect_external() {
      return unsupported("External finance connection");
    },
    refresh_external() {
      return unsupported("External finance refresh");
    },
  },
};

export const platformActionAdapters = [
  shareGrantAdapter,
  directConversationAdapter,
  directMessageAdapter,
  supportTicketAdapter,
  supportMessageAdapter,
  catalogSourceAdapter,
  marketplaceListingAdapter,
  marketplaceEntitlementAdapter,
  bridgeConnectionAdapter,
  peerConnectionAdapter,
  inferenceEndpointAdapter,
  financeConnectionAdapter,
] as const;

const OBJECT_TYPE_BY_ADAPTER_ID: Record<string, string> = {
  share_grant_read: "ShareGrant",
  dm_conversation_read: "DirectConversation",
  dm_message_read: "DirectMessage",
  support_ticket_read: "SupportTicket",
  support_message_read: "SupportMessage",
  catalog_source_read: "CatalogSource",
  marketplace_listing_read: "MarketplaceListing",
  marketplace_entitlement_read: "MarketplaceEntitlement",
  bridge_connection_read: "BridgeConnection",
  peer_connection_read: "PeerConnection",
  inference_endpoint_read: "InferenceEndpoint",
  finance_connection_service: "FinanceConnection",
};

/** Registration metadata for the ObjectType bootstrap layer to consume. */
export const platformActionAdapterRegistrations = platformActionAdapters.map(
  (adapter) => ({
    objectType: OBJECT_TYPE_BY_ADAPTER_ID[adapter.id]!,
    adapterId: adapter.id,
    actions: Object.keys(adapter.actions ?? {}),
  })
);

const writeRoles: ActionDef["roles"] = [
  "editor",
  "owner",
  "intelligence",
];
const emptySchema = { type: "object", additionalProperties: false };
const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = []
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: required.length ? required : undefined,
});
const action = (
  name: string,
  options: Partial<ActionDef> = {}
): ActionDef => ({
  name,
  label: name
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" "),
  target: "record",
  effect: "write",
  execution: "sync",
  roles: writeRoles,
  inputSchema: emptySchema,
  ...options,
});

export const PLATFORM_ACTION_METADATA: Record<string, ActionDef[]> = {
  ShareGrant: [
    action("grant", {
      target: "collection",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          resource_kind: { type: "string" },
          resource_id: { type: "string" },
          grantee_user_id: { type: "string" },
          grantee_tenant_id: { type: "string" },
          role: { enum: ["viewer", "editor", "owner"] },
        },
        ["resource_kind", "resource_id"]
      ),
    }),
    action("revoke", {
      effect: "destructive",
      confirmation: { required: true },
    }),
  ],
  DirectConversation: [
    action("start", {
      target: "collection",
      idempotency: { required: true },
      inputSchema: objectSchema({
        kind: { enum: ["direct", "group"] },
        title: { type: "string" },
        member_user_ids: { type: "array", items: { type: "string" } },
      }),
    }),
    action("mark_read", {
      roles: ["viewer", ...writeRoles],
      inputSchema: objectSchema({ message_id: { type: "string" } }),
    }),
  ],
  DirectMessage: [
    action("send", {
      target: "collection",
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          conversation_id: { type: "string" },
          body_text: { type: "string" },
          attachments: { type: "array" },
        },
        ["conversation_id"]
      ),
    }),
  ],
  SupportTicket: [
    action("open", {
      target: "collection",
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          subject: { type: "string" },
          body: { type: "string" },
          category: { type: "string" },
          priority: { type: "string" },
        },
        ["subject"]
      ),
    }),
    action("reply", {
      idempotency: { required: true },
      inputSchema: objectSchema({ body: { type: "string" } }, ["body"]),
    }),
    action("set_status", {
      roles: ["owner", "intelligence"],
      inputSchema: objectSchema({
        status: { type: "string" },
        priority: { type: ["string", "null"] },
      }),
    }),
  ],
  SupportMessage: [
    action("reply", {
      target: "collection",
      idempotency: { required: true },
      inputSchema: objectSchema(
        { ticket_id: { type: "string" }, body: { type: "string" } },
        ["ticket_id", "body"]
      ),
    }),
  ],
  CatalogSource: [
    action("add", {
      target: "collection",
      inputSchema: objectSchema(
        { name: { type: "string" }, url: { type: "string" } },
        ["name", "url"]
      ),
    }),
    action("remove", {
      effect: "destructive",
      confirmation: { required: true },
    }),
    action("fetch_external", {
      target: "collection",
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
      idempotency: { required: true },
    }),
  ],
  MarketplaceListing: [
    action("acquire_live", {
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
    }),
    action("publish", {
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
    }),
    action("archive", {
      effect: "destructive",
      confirmation: { required: true },
    }),
  ],
  MarketplaceEntitlement: [
    action("cancel", {
      effect: "destructive",
      confirmation: { required: true },
    }),
  ],
  BridgeConnection: [
    action("register", {
      target: "collection",
      confirmation: { required: true },
      sensitiveInputPaths: ["remote_bridge_token"],
      inputSchema: objectSchema(
        {
          label: { type: "string" },
          mode: { type: "string" },
          remote_bridge_url: { type: "string" },
          remote_bridge_token: { type: "string" },
        },
        ["label", "mode"]
      ),
    }),
    action("touch"),
    action("probe_remote", {
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
    }),
  ],
  PeerConnection: [
    action("invite", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
    }),
    action("accept", {
      effect: "external",
      confirmation: { required: true },
    }),
    action("refresh_health", {
      effect: "external",
      execution: "async",
      cancellable: false,
    }),
  ],
  InferenceEndpoint: [
    action("publish", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          name: { type: "string" },
          base_model_path: { type: "string" },
          adapter_ids_json: { type: "array", items: { type: "string" } },
          meter_unit: { type: "string" },
          meter_rate: { type: "number" },
          capacity_hint: { type: "number" },
        },
        ["name", "base_model_path"]
      ),
    }),
    action("run_remote", {
      effect: "external",
      execution: "async",
      cancellable: true,
      confirmation: { required: true },
      idempotency: { required: true },
    }),
  ],
  FinanceConnection: [
    action("add_manual", {
      target: "collection",
      inputSchema: objectSchema(
        {
          name: { type: "string" },
          category: { type: "string" },
          provider: { type: "string" },
          label: { type: "string" },
          balance: { type: "number" },
          currency: { type: "string" },
        },
        ["category", "provider", "label", "currency"]
      ),
    }),
    action("disconnect", {
      effect: "destructive",
      confirmation: { required: true },
    }),
    action("connect_external", {
      target: "collection",
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
    }),
    action("refresh_external", {
      effect: "external",
      execution: "async",
      cancellable: true,
    }),
  ],
};
