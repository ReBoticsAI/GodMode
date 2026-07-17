import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import { randomUUID } from "node:crypto";
import { config } from "../../config.js";
import type { AppDatabase } from "../../db.js";
import {
  createShareGrant,
  listShareGrantsForUser,
  resolveShareAccess,
  revokeShareGrant,
} from "../../services/share-service.js";
import {
  addConversationMember,
  createConversation,
  createMessage,
  getConversationForUser,
  listConversationsForUser,
  listMessages,
  markConversationRead,
  removeConversationMember,
  shareResourceToConversation,
  userCanAccessBlob,
} from "../../services/dm-service.js";
import {
  BlobStoreError,
  getDmBlob,
  storeDmBlob,
} from "../../services/blob-store.js";
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
  fetchOfficialCatalog,
  fetchUnofficialCatalog,
  installCatalogEntry,
  installDiscoveredPlugin,
  listCatalogInstalls,
  listCatalogSources,
  registerLocalPluginFolder,
  removeLocalPluginFolder,
  removeCatalogSource,
} from "../../services/marketplace-catalog.js";
import {
  activatePluginForTenant,
  loadPluginsForBoot,
  reconcilePluginLifecycle,
  uninstallPluginForTenant,
} from "../../services/plugin-lifecycle.js";
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
  probeBridgeConnection,
  touchBridgeConnection,
} from "../../services/bridge-connections.js";
import {
  acceptPeerConnection,
  enableTailscaleFederation,
  invitePeerByEmail,
  listPeerConnections,
  refreshPeerHealth,
} from "../../services/federation-peers.js";
import {
  createInferenceEndpoint,
  findActiveEndpointByModelPath,
  getInferenceEndpoint,
  listInferenceEndpoints,
} from "../../services/inference-service.js";
import {
  acquireCloneListing,
  archiveMarketplaceListing,
  publishMarketplaceListing,
} from "../../services/marketplace-listings.js";
import {
  acceptMarketplaceTos,
  ensureSellerAccount,
  getMarketplaceOrder,
  getPublicCommerceConfig,
  listOrdersForBuyer,
  MarketplaceCommerceError,
  updateSellerPayout,
} from "../../services/marketplace-commerce.js";
import {
  capturePayPalOrder,
  confirmCryptoPayment,
  createOrderForListing,
  createOrderForOfficialCatalogEntry,
  startMarketplaceCheckout,
} from "../../services/marketplace-payments.js";
import { getOfficialCatalogEntryPrice } from "../../services/marketplace-official-catalog.js";
import { exportEntity, importEntity, type PortableBundle } from "../../services/portability.js";
import {
  addGroupMember,
  ensurePlatformGroups,
  listGroupMembers,
  removeGroupMember,
} from "../../services/platform-groups.js";
import {
  HoldingsService,
  type HoldingCategory,
} from "../../services/holdings/holdings-service.js";
import { CredentialStore } from "../../services/holdings/credential-store.js";
import { CryptoProvider } from "../../services/holdings/crypto-provider.js";
import { PayPalService } from "../../services/holdings/paypal-service.js";
import { runConfiguredRemoteInference } from "./runtime.js";
import { getShareBroker } from "../../ws-broker.js";
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
      expiresAt:
        typeof data.expires_at === "string" ? data.expires_at : undefined,
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
    share_model(_db, _def, _id, input, ctx) {
      const core = ctx.data!.coreDb;
      const userId = requireUser(ctx);
      const tenantId = requireTenant(ctx);
      const modelPath = requiredText(input, "model_path");
      let granteeUserId =
        typeof input.grantee_user_id === "string" && input.grantee_user_id.trim()
          ? input.grantee_user_id.trim()
          : undefined;
      if (!granteeUserId && typeof input.grantee_email === "string") {
        const user = core
          .prepare("SELECT id FROM users WHERE email=?")
          .get(input.grantee_email.trim().toLowerCase()) as { id: string } | undefined;
        granteeUserId = user?.id;
      }
      if (!granteeUserId) throw httpError(404, "Share recipient not found");
      if (granteeUserId === userId) throw httpError(400, "Cannot share a model with yourself");
      const existing = findActiveEndpointByModelPath(core, userId, modelPath);
      const endpointId: string =
        (typeof existing?.id === "string" ? existing.id : undefined) ??
        createInferenceEndpoint(core, {
          ownerTenantId: tenantId,
          ownerUserId: userId,
          name:
            (typeof input.name === "string" && input.name.trim()) ||
            modelPath.split(/[\\/]/).pop()!.replace(/\.gguf$/i, ""),
          baseModelPath: modelPath,
        });
      const id = createShareGrant(core, {
        ownerTenantId: tenantId,
        ownerUserId: userId,
        resourceKind: "model",
        resourceId: endpointId,
        granteeUserId,
        role: "viewer",
        bridgeUrl: null,
        federationToken: null,
      });
      getShareBroker().broadcastResource("model", endpointId, {
        type: "share_granted",
        grantId: id,
      });
      return { id, endpointId };
    },
    clone_shared(db, _def, _id, input, ctx) {
      const kind = requiredText(input, "kind");
      const resourceId = requiredText(input, "resource_id");
      const access = resolveShareAccess(ctx.data!.coreDb, {
        userId: requireUser(ctx),
        tenantId: requireTenant(ctx),
        resourceKind: kind as never,
        resourceId,
        minRole: "viewer",
      });
      if (!access) {
        throw httpError(403, "No access to shared resource");
      }
      const bundle = exportEntity(access.db, kind as never, resourceId);
      return { ok: true, ...importEntity(db, bundle) };
    },
  },
};

export const federatedShareInviteAdapter: RecordAdapter = {
  id: "federated_share_invite_service",
  actions: {
    accept(_db, _def, _id, input, ctx) {
      const core = ctx.data!.coreDb;
      const actorId = requireUser(ctx);
      const token = requiredText(input, "invite_token");
      return core.transaction(() => {
        const invite = core
          .prepare(
            `SELECT * FROM federated_share_invites
             WHERE invite_token=? AND status='pending'`
          )
          .get(token) as Record<string, unknown> | undefined;
        if (!invite) throw httpError(404, "Invite not found or already accepted");
        const expiresAt = invite.expires_at
          ? Date.parse(String(invite.expires_at))
          : NaN;
        if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
          throw httpError(410, "Invite expired");
        }
        const actor = core
          .prepare("SELECT email FROM users WHERE id=?")
          .get(actorId) as { email: string } | undefined;
        if (
          !actor ||
          actor.email.trim().toLowerCase() !==
            String(invite.invitee_email).trim().toLowerCase()
        ) {
          throw httpError(403, "Invite is bound to a different account email");
        }
        const granteeTenantId =
          typeof input.grantee_tenant_id === "string" && input.grantee_tenant_id.trim()
            ? input.grantee_tenant_id.trim()
            : requireTenant(ctx);
        const membership = core
          .prepare(
            "SELECT 1 FROM tenant_memberships WHERE user_id=? AND tenant_id=?"
          )
          .get(actorId, granteeTenantId);
        if (!membership) throw httpError(403, "No access to grantee workspace");

        const federationToken = randomUUID();
        const grantId = createShareGrant(core, {
          ownerTenantId: String(invite.owner_tenant_id),
          ownerUserId: String(invite.owner_user_id),
          resourceKind: invite.resource_kind as never,
          resourceId: String(invite.resource_id),
          granteeUserId: actorId,
          granteeTenantId,
          role: (invite.role as never) ?? "viewer",
          bridgeUrl: config.federation.publicUrl,
          federationToken,
        });
        core.prepare(
          `UPDATE federated_share_invites
           SET status='accepted' WHERE id=? AND status='pending'`
        ).run(String(invite.id));
        return {
          grantId,
          federationToken,
          ownerBridgeUrl: config.federation.publicUrl,
        };
      })();
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
    add_member(_db, _def, id, input, ctx) {
      return addConversationMember(
        ctx.data!.coreDb,
        id,
        requireUser(ctx),
        requiredText(input, "user_id")
      );
    },
    remove_member(_db, _def, id, input, ctx) {
      removeConversationMember(
        ctx.data!.coreDb,
        id,
        requireUser(ctx),
        requiredText(input, "user_id")
      );
      return { ok: true };
    },
    share(_db, _def, id, input, ctx) {
      return {
        grants: shareResourceToConversation(ctx.data!.coreDb, {
          conversationId: id,
          actorUserId: requireUser(ctx),
          actorTenantId: requireTenant(ctx),
          resourceKind: requiredText(input, "resource_kind") as never,
          resourceId: requiredText(input, "resource_id"),
          role: typeof input.role === "string" ? (input.role as never) : undefined,
        }),
      };
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

export const dmBlobAdapter: RecordAdapter = {
  id: "dm_blob_service",
  list(_db, def, query, ctx) {
    const rows = ctx.data!.coreDb
      .prepare(
        `SELECT id, owner_user_id, filename, mime, size, created_at
         FROM dm_blobs WHERE owner_user_id=? ORDER BY created_at DESC`
      )
      .all(requireUser(ctx)) as Array<Record<string, unknown>>;
    return result(def, rows, query);
  },
  get(_db, def, id, ctx) {
    const core = ctx.data!.coreDb;
    const row = getDmBlob(core, id);
    if (!row || !userCanAccessBlob(core, id, requireUser(ctx))) return null;
    const { path: _path, ...metadata } = row;
    return record(def, metadata as unknown as Record<string, unknown>);
  },
  actions: {
    upload(_db, def, _id, input, ctx) {
      if (!Buffer.isBuffer(input.buffer)) {
        throw httpError(400, "Binary upload buffer required");
      }
      try {
        const row = storeDmBlob(ctx.data!.coreDb, {
          ownerUserId: requireUser(ctx),
          filename: requiredText(input, "filename"),
          mime: requiredText(input, "mime"),
          buffer: input.buffer,
        });
        const { path: _path, ...metadata } = row;
        return record(def, metadata as unknown as Record<string, unknown>);
      } catch (error) {
        if (error instanceof BlobStoreError) throw httpError(400, error.message);
        throw error;
      }
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
    async fetch_external(_db, _def, _id, _input, ctx) {
      const [official, unofficial] = await Promise.all([
        fetchOfficialCatalog(),
        fetchUnofficialCatalog(ctx.data!.coreDb, requireUser(ctx)),
      ]);
      return { official, unofficial };
    },
  },
};

export const catalogInstallAdapter: RecordAdapter = {
  id: "catalog_install_read",
  list(_db, def, query, ctx) {
    return result(def, listCatalogInstalls(ctx.data!.coreDb, requireTenant(ctx)), query);
  },
  get(_db, def, id, ctx) {
    const row = listCatalogInstalls(ctx.data!.coreDb, requireTenant(ctx)).find(
      (candidate) => String(candidate.id) === id
    );
    return row ? record(def, row) : null;
  },
  actions: {
    async activate_plugin_path(_db, _def, _id, input, ctx) {
      return activatePluginForTenant(
        ctx.data!.coreDb,
        requireTenant(ctx),
        requiredText(input, "path"),
        {
          buildIfNeeded: input.build_if_needed !== false,
          installForTenant: input.install_for_tenant !== false,
          reload: input.reload !== false,
        }
      );
    },
    install_entry(_db, _def, _id, input, ctx) {
      try {
        return installCatalogEntry(ctx.data!.coreDb, ctx.data!.tenantDb, {
          userId: requireUser(ctx),
          tenantId: requireTenant(ctx),
          entryId: requiredText(input, "entry_id"),
          sourceCatalog:
            typeof input.source_catalog === "string" ? input.source_catalog : undefined,
        });
      } catch (err) {
        if (err instanceof MarketplaceCommerceError) {
          throw httpError(err.status, err.message);
        }
        throw err;
      }
    },
    async install_plugin(_db, _def, _id, input, ctx) {
      await installDiscoveredPlugin(
        ctx.data!.coreDb,
        requireTenant(ctx),
        requiredText(input, "plugin_id")
      );
      return { ok: true, pluginId: input.plugin_id };
    },
    register_local_plugin(_db, _def, _id, input, ctx) {
      return registerLocalPluginFolder(
        ctx.data!.coreDb,
        requireTenant(ctx),
        requiredText(input, "path"),
        { userId: requireUser(ctx), installForTenant: true }
      );
    },
    unregister_local_plugin(_db, _def, _id, input, ctx) {
      if (!removeLocalPluginFolder(ctx.data!.coreDb, requiredText(input, "path"))) {
        throw httpError(404, "Local plugin registration not found");
      }
      return { ok: true };
    },
    async uninstall_plugin(_db, _def, _id, input, ctx) {
      await uninstallPluginForTenant(
        ctx.data!.coreDb,
        requireTenant(ctx),
        requiredText(input, "plugin_id")
      );
      return { ok: true, pluginId: input.plugin_id };
    },
    async load_runtime(_db, _def, _id, _input, ctx) {
      if (ctx.source !== "system") throw httpError(403, "System lifecycle action required");
      return loadPluginsForBoot();
    },
    async reconcile_runtime(_db, _def, _id, input, ctx) {
      if (ctx.source !== "system") throw httpError(403, "System lifecycle action required");
      await reconcilePluginLifecycle(
        ctx.data!.coreDb,
        requiredText(input, "operator_tenant_id"),
        ctx.data!.tenantDb
      );
      return { ok: true };
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
    acquire(coreDb, _def, id, _input, ctx) {
      try {
        const listing = coreDb
          .prepare(
            `SELECT * FROM marketplace_listings
             WHERE id=? AND status='active' AND visibility='public'`
          )
          .get(id) as Record<string, unknown> | undefined;
        if (!listing) throw httpError(404, "Listing not found");
        if (listing.delivery_mode !== "live") {
          return acquireCloneListing(
            { core: coreDb, buyerTenant: ctx.data!.tenantDb },
            {
              listingId: id,
              buyerUserId: requireUser(ctx),
              buyerTenantId: requireTenant(ctx),
              idempotencyKey: ctx.idempotencyKey!,
            }
          );
        }
        return acquireLiveListing(coreDb, {
          listing,
          buyerUserId: requireUser(ctx),
          buyerTenantId: requireTenant(ctx),
        });
      } catch (err) {
        if (err instanceof MarketplaceCommerceError) {
          throw httpError(err.status, err.message);
        }
        throw err;
      }
    },
    acquire_live(db, def, id, input, ctx) {
      return marketplaceListingAdapter.actions!.acquire(db, def, id, input, ctx);
    },
    publish(_db, def, _id, input, ctx) {
      try {
        const row = publishMarketplaceListing(ctx.data!.coreDb, ctx.data!.tenantDb, {
          sellerUserId: requireUser(ctx),
          sellerTenantId: requireTenant(ctx),
          kind: requiredText(input, "kind") as never,
          resourceId:
            typeof input.resource_id === "string" ? input.resource_id : undefined,
          title: typeof input.title === "string" ? input.title : undefined,
          description:
            typeof input.description === "string" ? input.description : undefined,
          priceCredits:
            typeof input.price_credits === "number" ? input.price_credits : undefined,
          priceCents:
            typeof input.price_cents === "number"
              ? input.price_cents
              : typeof input.price_credits === "number"
                ? input.price_credits
                : undefined,
          currency: typeof input.currency === "string" ? input.currency : undefined,
          sellerKind:
            input.seller_kind === "official" || input.seller_kind === "user"
              ? input.seller_kind
              : undefined,
          catalogEntryId:
            typeof input.catalog_entry_id === "string" ? input.catalog_entry_id : undefined,
          deliveryMode:
            typeof input.delivery_mode === "string" ? (input.delivery_mode as never) : undefined,
          pricingModel:
            typeof input.pricing_model === "string" ? (input.pricing_model as never) : undefined,
          pricePeriod:
            typeof input.price_period === "string" ? input.price_period : undefined,
          meterUnit: typeof input.meter_unit === "string" ? input.meter_unit : undefined,
          meterRate: typeof input.meter_rate === "number" ? input.meter_rate : undefined,
          license: typeof input.license === "string" ? input.license : undefined,
          inferenceEndpointId:
            typeof input.inference_endpoint_id === "string"
              ? input.inference_endpoint_id
              : undefined,
          bundleChildren: Array.isArray(input.bundle_children)
            ? (input.bundle_children as PortableBundle[])
            : undefined,
        });
        return record(def, row);
      } catch (err) {
        if (err instanceof MarketplaceCommerceError) {
          throw httpError(err.status, err.message);
        }
        throw err;
      }
    },
    archive(_db, def, id, _input, ctx) {
      return record(
        def,
        archiveMarketplaceListing(ctx.data!.coreDb, {
          listingId: id,
          sellerUserId: requireUser(ctx),
          sellerTenantId: requireTenant(ctx),
        })
      );
    },
    export_portable(_db, _def, _id, input, ctx) {
      return {
        bundle: exportEntity(
          ctx.data!.tenantDb,
          requiredText(input, "kind") as never,
          requiredText(input, "resource_id")
        ),
      };
    },
    import_portable(_db, _def, _id, input, ctx) {
      const bundle = input.bundle as PortableBundle | undefined;
      if (!bundle || bundle.version !== 1) throw httpError(400, "Valid bundle required");
      return importEntity(ctx.data!.tenantDb, bundle);
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

function commerceHttpError(err: unknown): never {
  if (err instanceof MarketplaceCommerceError) {
    throw httpError(err.status, err.message);
  }
  throw err;
}

export const marketplaceOrderAdapter: RecordAdapter = {
  id: "marketplace_order_read",
  list(_db, def, query, ctx) {
    return result(def, listOrdersForBuyer(ctx.data!.coreDb, requireUser(ctx)), query);
  },
  get(_db, def, id, ctx) {
    const row = getMarketplaceOrder(ctx.data!.coreDb, id);
    if (!row || String(row.buyer_user_id) !== requireUser(ctx)) return null;
    return record(def, row);
  },
  actions: {
    async start_checkout(_db, def, _id, input, ctx) {
      try {
        const provider = requiredText(input, "provider") as "stripe" | "paypal" | "crypto";
        if (!["stripe", "paypal", "crypto"].includes(provider)) {
          throw httpError(400, "provider must be stripe, paypal, or crypto");
        }
        const successUrl = requiredText(input, "success_url");
        const cancelUrl = requiredText(input, "cancel_url");
        const core = ctx.data!.coreDb;
        const userId = requireUser(ctx);
        const tenantId = requireTenant(ctx);

        let order: Record<string, unknown>;
        if (typeof input.listing_id === "string" && input.listing_id) {
          const listing = core
            .prepare(
              `SELECT * FROM marketplace_listings WHERE id=? AND status='active'`
            )
            .get(input.listing_id) as Record<string, unknown> | undefined;
          if (!listing) throw httpError(404, "Listing not found");
          order = createOrderForListing(core, {
            listing,
            buyerUserId: userId,
            buyerTenantId: tenantId,
            provider,
          });
          const sellerAcct =
            String(listing.seller_kind) === "user"
              ? ensureSellerAccount(core, String(listing.seller_user_id))
              : null;
          const checkout = await startMarketplaceCheckout(core, {
            orderId: String(order.id),
            successUrl,
            cancelUrl,
            stripeConnectAccountId:
              typeof sellerAcct?.stripe_connect_account_id === "string"
                ? sellerAcct.stripe_connect_account_id
                : null,
            paypalMerchantId:
              typeof sellerAcct?.paypal_merchant_id === "string"
                ? sellerAcct.paypal_merchant_id
                : null,
          });
          return { order: record(def, getMarketplaceOrder(core, String(order.id))!), checkout };
        }

        const entryId = requiredText(input, "catalog_entry_id");
        const priced = getOfficialCatalogEntryPrice(core, entryId);
        if (!priced) throw httpError(404, "Official catalog entry not found");
        order = createOrderForOfficialCatalogEntry(core, {
          entryId,
          priceCents: priced.priceCents,
          currency: priced.currency,
          buyerUserId: userId,
          buyerTenantId: tenantId,
          provider,
          listingId: priced.listingId,
        });
        const checkout = await startMarketplaceCheckout(core, {
          orderId: String(order.id),
          successUrl,
          cancelUrl,
        });
        return { order: record(def, getMarketplaceOrder(core, String(order.id))!), checkout };
      } catch (err) {
        commerceHttpError(err);
      }
    },
    async capture_paypal(_db, def, id, _input, ctx) {
      try {
        const order = getMarketplaceOrder(ctx.data!.coreDb, id);
        if (!order || String(order.buyer_user_id) !== requireUser(ctx)) {
          throw httpError(404, "Order not found");
        }
        const paypalId = String(order.provider_ref ?? "");
        if (!paypalId) throw httpError(400, "Missing PayPal order id");
        const updated = await capturePayPalOrder(ctx.data!.coreDb, paypalId);
        return record(def, updated);
      } catch (err) {
        commerceHttpError(err);
      }
    },
    confirm_crypto(_db, def, id, input, ctx) {
      try {
        const updated = confirmCryptoPayment(ctx.data!.coreDb, {
          orderId: id,
          txHash: requiredText(input, "tx_hash"),
          buyerUserId: requireUser(ctx),
        });
        return record(def, updated);
      } catch (err) {
        commerceHttpError(err);
      }
    },
  },
};

export const marketplaceSellerAccountAdapter: RecordAdapter = {
  id: "marketplace_seller_account_read",
  list(_db, def, query, ctx) {
    const row = ensureSellerAccount(ctx.data!.coreDb, requireUser(ctx));
    return result(def, [row], query);
  },
  get(_db, def, id, ctx) {
    const row = ensureSellerAccount(ctx.data!.coreDb, requireUser(ctx));
    if (String(row.id) !== id && String(row.user_id) !== id) return null;
    return record(def, row);
  },
  actions: {
    accept_tos(_db, _def, _id, _input, ctx) {
      try {
        return acceptMarketplaceTos(ctx.data!.coreDb, requireUser(ctx));
      } catch (err) {
        commerceHttpError(err);
      }
    },
    connect_payout(_db, def, _id, input, ctx) {
      try {
        const pref = input.payout_preference;
        const updated = updateSellerPayout(ctx.data!.coreDb, {
          userId: requireUser(ctx),
          stripeConnectAccountId:
            typeof input.stripe_connect_account_id === "string"
              ? input.stripe_connect_account_id
              : input.stripe_connect_account_id === null
                ? null
                : undefined,
          paypalMerchantId:
            typeof input.paypal_merchant_id === "string"
              ? input.paypal_merchant_id
              : input.paypal_merchant_id === null
                ? null
                : undefined,
          metamaskAddress:
            typeof input.metamask_address === "string"
              ? input.metamask_address
              : input.metamask_address === null
                ? null
                : undefined,
          payoutPreference:
            pref === "stripe" || pref === "paypal" || pref === "crypto" ? pref : undefined,
        });
        return record(def, updated);
      } catch (err) {
        commerceHttpError(err);
      }
    },
    commerce_config(_db, _def, _id, _input, _ctx) {
      return getPublicCommerceConfig();
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
    probe_remote(_db, _def, id, _input, ctx) {
      const row = getBridgeConnection(ctx.data!.coreDb, id);
      if (!row || row.owner_tenant_id !== requireTenant(ctx)) {
        throw httpError(404, "Bridge connection not found");
      }
      return probeBridgeConnection(ctx.data!.coreDb, row, ctx.signal);
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
    enable_tailscale() {
      return enableTailscaleFederation();
    },
    invite(_db, _def, _id, input, ctx) {
      return invitePeerByEmail(
        ctx.data!.coreDb,
        requireUser(ctx),
        requiredText(input, "email"),
        typeof input.remote_bridge_url === "string"
          ? input.remote_bridge_url
          : undefined
      );
    },
    accept(_db, _def, _id, input, ctx) {
      return {
        id: acceptPeerConnection(ctx.data!.coreDb, requireUser(ctx), {
          remoteBridgeUrl: requiredText(input, "remote_bridge_url"),
          federationToken: requiredText(input, "federation_token"),
          remoteUserId:
            typeof input.remote_user_id === "string" ? input.remote_user_id : undefined,
          remoteDisplayName:
            typeof input.remote_display_name === "string"
              ? input.remote_display_name
              : undefined,
          remoteEmail:
            typeof input.remote_email === "string" ? input.remote_email : undefined,
          tailscaleNodeId:
            typeof input.tailscale_node_id === "string"
              ? input.tailscale_node_id
              : undefined,
          tailscaleDnsName:
            typeof input.tailscale_dns_name === "string"
              ? input.tailscale_dns_name
              : undefined,
        }),
      };
    },
    async refresh_health(_db, _def, id, _input, ctx) {
      const userId = requireUser(ctx);
      if (
        id &&
        !listPeerConnections(ctx.data!.coreDb, userId).some((peer) => peer.id === id)
      ) {
        throw httpError(404, "Peer connection not found");
      }
      await refreshPeerHealth(ctx.data!.coreDb, userId);
      return { ok: true };
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
    async run_remote(_db, _def, id, input, ctx) {
      const rawMessages = Array.isArray(input.messages) ? input.messages : [];
      const content = await runConfiguredRemoteInference({
        core: ctx.data!.coreDb,
        endpointId: id || requiredText(input, "endpoint_id"),
        buyerUserId: requireUser(ctx),
        buyerTenantId: requireTenant(ctx),
        messages: rawMessages.map((message) => {
          const value = message as Record<string, unknown>;
          return {
            role: value.role as never,
            content: String(value.content ?? ""),
          };
        }),
        sampling:
          input.sampling && typeof input.sampling === "object"
            ? (input.sampling as never)
            : undefined,
        priority: typeof input.priority === "number" ? input.priority : undefined,
        signal: ctx.signal,
      });
      return { ok: true, content };
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
    async configure_moralis(db, _def, _id, input) {
      const credentials = new CredentialStore(db);
      credentials.setMoralisApiKey(requiredText(input, "api_key"));
      const test = await new CryptoProvider(credentials).testConnection();
      if (!test.ok) {
        throw httpError(400, test.error ?? "Moralis key rejected");
      }
      return { ok: true, configured: true };
    },
    async configure_paypal(db, _def, _id, input) {
      const credentials = new CredentialStore(db);
      const env = input.env === "live" ? "live" : "sandbox";
      credentials.setPayPalCredentials({
        clientId: requiredText(input, "client_id"),
        clientSecret: requiredText(input, "client_secret"),
        env,
      });
      const test = await new PayPalService(credentials).testConnection();
      if (!test.ok) {
        throw httpError(400, test.error ?? "PayPal credentials rejected");
      }
      return { ok: true, configured: true, env };
    },
    async preview_crypto(db, _def, _id, input) {
      return new CryptoProvider(new CredentialStore(db)).fetchPortfolio(
        requiredText(input, "address"),
        Array.isArray(input.chains)
          ? input.chains.filter((chain): chain is string => typeof chain === "string")
          : undefined
      );
    },
    add_manual(db, def, _id, input, ctx) {
      return financeConnectionAdapter.create!(db, def, input, ctx);
    },
    disconnect(db, _def, id) {
      if (!new HoldingsService(db).delete(id)) {
        throw httpError(404, "Finance connection not found");
      }
      return { ok: true };
    },
    async connect_external(db, def, _id, input) {
      const credentials = new CredentialStore(db);
      const holdings = new HoldingsService(db);
      const provider = requiredText(input, "provider");
      if (provider === "paypal") {
        if (
          typeof input.client_id === "string" &&
          typeof input.client_secret === "string"
        ) {
          credentials.setPayPalCredentials({
            clientId: input.client_id,
            clientSecret: input.client_secret,
            env: input.env === "live" ? "live" : "sandbox",
          });
        }
        const balance = await new PayPalService(credentials).fetchBalance();
        return record(
          def,
          holdings.upsertPayPal(
            typeof input.label === "string" ? input.label : "PayPal Business",
            balance
          ) as unknown as Record<string, unknown>,
          FINANCE_ALIASES
        );
      }
      if (provider === "moralis" || provider === "crypto") {
        if (typeof input.api_key === "string") {
          credentials.setMoralisApiKey(input.api_key);
        }
        const address = requiredText(input, "address");
        const portfolio = await new CryptoProvider(credentials).fetchPortfolio(
          address,
          Array.isArray(input.chains)
            ? input.chains.filter((chain): chain is string => typeof chain === "string")
            : undefined
        );
        return record(
          def,
          holdings.upsertCryptoWallet(
            typeof input.wallet_provider === "string"
              ? input.wallet_provider
              : "wallet",
            typeof input.label === "string" ? input.label : "Crypto Wallet",
            portfolio
          ) as unknown as Record<string, unknown>,
          FINANCE_ALIASES
        );
      }
      throw httpError(400, "provider must be paypal, moralis, or crypto");
    },
    async refresh_external(db, def, id) {
      const credentials = new CredentialStore(db);
      const holdings = new HoldingsService(db);
      const connection = holdings.get(id);
      if (!connection) throw httpError(404, "Finance connection not found");
      try {
        if (connection.category === "wallet" && connection.reference) {
          const portfolio = await new CryptoProvider(credentials).fetchPortfolio(
            connection.reference
          );
          return record(
            def,
            holdings.updateBalance(
              id,
              portfolio.totalUsd,
              "USD",
              portfolio.totalCad,
              { tokens: portfolio.tokens }
            ) as unknown as Record<string, unknown>,
            FINANCE_ALIASES
          );
        }
        if (connection.category === "paypal") {
          const balance = await new PayPalService(credentials).fetchBalance();
          return record(
            def,
            holdings.updateBalance(
              id,
              balance.total,
              balance.currency,
              balance.totalCad,
              balance.raw
            ) as unknown as Record<string, unknown>,
            FINANCE_ALIASES
          );
        }
        throw httpError(400, "Refresh not supported for this connection type");
      } catch (error) {
        holdings.updateBalance(
          id,
          connection.balance,
          connection.currency,
          connection.balanceCad,
          connection.breakdown,
          "error"
        );
        throw error;
      }
    },
  },
};

function requirePlatformAdmin(ctx: OperationContext): void {
  requireUser(ctx);
  if (!ctx.isAdmin) throw httpError(403, "Platform administrator required");
}

export const platformGroupAdapter: RecordAdapter = {
  id: "platform_group_service",
  list(_db, def, query, ctx) {
    const core = ctx.data!.coreDb;
    ensurePlatformGroups(core);
    const userId = requireUser(ctx);
    const rows = ctx.isAdmin
      ? (core.prepare("SELECT * FROM platform_groups ORDER BY name").all() as Array<
          Record<string, unknown>
        >)
      : (core
          .prepare(
            `SELECT DISTINCT g.* FROM platform_groups g
             JOIN platform_group_members m ON m.group_id=g.id
             WHERE m.member_kind='user' AND m.member_id=?
             ORDER BY g.name`
          )
          .all(userId) as Array<Record<string, unknown>>);
    return result(def, rows, query);
  },
  get(db, def, id, ctx) {
    return this.list!(db, def, {}, ctx).records.find((row) => row.id === id) ?? null;
  },
};

export const platformGroupMemberAdapter: RecordAdapter = {
  id: "platform_group_member_service",
  list(_db, def, query, ctx) {
    const core = ctx.data!.coreDb;
    ensurePlatformGroups(core);
    const groupId =
      typeof query.filters?.group_id === "string" ? query.filters.group_id : "";
    if (!groupId) throw httpError(400, "group_id filter required");
    if (!ctx.isAdmin) {
      const membership = core
        .prepare(
          `SELECT 1 FROM platform_group_members
           WHERE group_id=? AND member_kind='user' AND member_id=?`
        )
        .get(groupId, requireUser(ctx));
      if (!membership) throw httpError(403, "Group membership required");
    }
    return result(
      def,
      listGroupMembers(groupId, core).map((member) => ({
        ...member,
        id: `${member.group_id}:${member.member_kind}:${member.member_id}:${member.tenant_id ?? ""}`,
      })),
      query
    );
  },
  get(db, def, id, ctx) {
    const [groupId] = id.split(":");
    if (!groupId) return null;
    return (
      this.list!(
        db,
        def,
        { filters: { group_id: groupId }, limit: 500 },
        ctx
      ).records.find((row) => row.id === id) ?? null
    );
  },
  actions: {
    add(_db, def, _id, input, ctx) {
      requirePlatformAdmin(ctx);
      return record(
        def,
        {
          ...addGroupMember(
          {
            groupId: requiredText(input, "group_id"),
            memberKind: requiredText(input, "member_kind") as never,
            memberId: requiredText(input, "member_id"),
            tenantId:
              typeof input.tenant_id === "string" ? input.tenant_id : undefined,
          },
          ctx.data!.coreDb
          ),
          id: `${input.group_id}:${input.member_kind}:${input.member_id}:${input.tenant_id ?? ""}`,
        } as unknown as Record<string, unknown>
      );
    },
    remove(_db, _def, _id, input, ctx) {
      requirePlatformAdmin(ctx);
      return {
        ok: removeGroupMember(
          {
            groupId: requiredText(input, "group_id"),
            memberKind: requiredText(input, "member_kind") as never,
            memberId: requiredText(input, "member_id"),
            tenantId:
              typeof input.tenant_id === "string" ? input.tenant_id : undefined,
          },
          ctx.data!.coreDb
        ),
      };
    },
  },
};

export const platformActionAdapters = [
  shareGrantAdapter,
  federatedShareInviteAdapter,
  directConversationAdapter,
  directMessageAdapter,
  dmBlobAdapter,
  supportTicketAdapter,
  supportMessageAdapter,
  catalogSourceAdapter,
  catalogInstallAdapter,
  marketplaceListingAdapter,
  marketplaceEntitlementAdapter,
  marketplaceOrderAdapter,
  marketplaceSellerAccountAdapter,
  bridgeConnectionAdapter,
  peerConnectionAdapter,
  inferenceEndpointAdapter,
  financeConnectionAdapter,
  platformGroupAdapter,
  platformGroupMemberAdapter,
] as const;

const OBJECT_TYPE_BY_ADAPTER_ID: Record<string, string> = {
  share_grant_read: "ShareGrant",
  federated_share_invite_service: "FederatedShareInvite",
  dm_conversation_read: "DirectConversation",
  dm_message_read: "DirectMessage",
  dm_blob_service: "DmBlob",
  support_ticket_read: "SupportTicket",
  support_message_read: "SupportMessage",
  catalog_source_read: "CatalogSource",
  catalog_install_read: "CatalogInstall",
  marketplace_listing_read: "MarketplaceListing",
  marketplace_entitlement_read: "MarketplaceEntitlement",
  marketplace_order_read: "MarketplaceOrder",
  marketplace_seller_account_read: "MarketplaceSellerAccount",
  bridge_connection_read: "BridgeConnection",
  peer_connection_read: "PeerConnection",
  inference_endpoint_read: "InferenceEndpoint",
  finance_connection_service: "FinanceConnection",
  platform_group_service: "PlatformGroup",
  platform_group_member_service: "PlatformGroupMember",
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
    action("share_model", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          model_path: { type: "string" },
          grantee_user_id: { type: "string" },
          grantee_email: { type: "string" },
          name: { type: "string" },
        },
        ["model_path"]
      ),
    }),
    action("clone_shared", {
      target: "collection",
      effect: "write",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        { kind: { type: "string" }, resource_id: { type: "string" } },
        ["kind", "resource_id"]
      ),
    }),
  ],
  FederatedShareInvite: [
    action("accept", {
      target: "collection",
      roles: ["viewer", ...writeRoles],
      sensitiveInputPaths: ["invite_token"],
      inputSchema: objectSchema(
        {
          invite_token: { type: "string" },
          grantee_tenant_id: { type: "string" },
        },
        ["invite_token"]
      ),
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
    action("add_member", {
      inputSchema: objectSchema({ user_id: { type: "string" } }, ["user_id"]),
    }),
    action("remove_member", {
      effect: "destructive",
      confirmation: { required: true },
      inputSchema: objectSchema({ user_id: { type: "string" } }, ["user_id"]),
    }),
    action("share", {
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          resource_kind: { type: "string" },
          resource_id: { type: "string" },
          role: { enum: ["viewer", "editor", "owner"] },
        },
        ["resource_kind", "resource_id"]
      ),
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
  DmBlob: [
    action("upload", {
      target: "collection",
      roles: ["viewer", ...writeRoles],
      inputSchema: objectSchema(
        {
          filename: { type: "string" },
          mime: { type: "string" },
          buffer: {},
        },
        ["filename", "mime", "buffer"]
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
  CatalogInstall: [
    action("activate_plugin_path", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          path: { type: "string" },
          build_if_needed: { type: "boolean" },
          install_for_tenant: { type: "boolean" },
          reload: { type: "boolean" },
        },
        ["path"]
      ),
    }),
    action("install_entry", {
      target: "collection",
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          entry_id: { type: "string" },
          source_catalog: { type: "string" },
        },
        ["entry_id"]
      ),
    }),
    action("install_plugin", {
      target: "collection",
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
      inputSchema: objectSchema({ plugin_id: { type: "string" } }, ["plugin_id"]),
    }),
    action("register_local_plugin", {
      target: "collection",
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
      inputSchema: objectSchema({ path: { type: "string" } }, ["path"]),
    }),
    action("unregister_local_plugin", {
      target: "collection",
      effect: "destructive",
      confirmation: { required: true },
      inputSchema: objectSchema({ path: { type: "string" } }, ["path"]),
    }),
    action("uninstall_plugin", {
      target: "collection",
      effect: "destructive",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema({ plugin_id: { type: "string" } }, ["plugin_id"]),
    }),
    action("load_runtime", {
      target: "collection",
      effect: "external",
      roles: ["owner"],
    }),
    action("reconcile_runtime", {
      target: "collection",
      roles: ["owner"],
      inputSchema: objectSchema(
        { operator_tenant_id: { type: "string" } },
        ["operator_tenant_id"]
      ),
    }),
  ],
  MarketplaceListing: [
    action("acquire", {
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
      idempotency: { required: true },
      retry: { maxAttempts: 20 },
    }),
    action("acquire_live", {
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
    }),
    action("publish", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          kind: { type: "string" },
          resource_id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          price_credits: { type: "number" },
          price_cents: { type: "number" },
          currency: { type: "string" },
          seller_kind: { enum: ["official", "user"] },
          catalog_entry_id: { type: "string" },
          delivery_mode: { enum: ["clone", "live"] },
          pricing_model: { type: "string" },
          price_period: { type: "string" },
          meter_unit: { type: "string" },
          meter_rate: { type: "number" },
          license: { type: "string" },
          inference_endpoint_id: { type: "string" },
          bundle_children: { type: "array" },
        },
        ["kind"]
      ),
    }),
    action("archive", {
      effect: "destructive",
      confirmation: { required: true },
    }),
    action("export_portable", {
      target: "collection",
      inputSchema: objectSchema(
        { kind: { type: "string" }, resource_id: { type: "string" } },
        ["kind", "resource_id"]
      ),
    }),
    action("import_portable", {
      target: "collection",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema({ bundle: { type: "object" } }, ["bundle"]),
    }),
  ],
  MarketplaceEntitlement: [
    action("cancel", {
      effect: "destructive",
      confirmation: { required: true },
    }),
  ],
  MarketplaceOrder: [
    action("start_checkout", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema(
        {
          provider: { enum: ["stripe", "paypal", "crypto"] },
          listing_id: { type: "string" },
          catalog_entry_id: { type: "string" },
          success_url: { type: "string" },
          cancel_url: { type: "string" },
        },
        ["provider", "success_url", "cancel_url"]
      ),
    }),
    action("capture_paypal", {
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
    }),
    action("confirm_crypto", {
      effect: "external",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: objectSchema({ tx_hash: { type: "string" } }, ["tx_hash"]),
    }),
  ],
  MarketplaceSellerAccount: [
    action("accept_tos", {
      target: "collection",
      confirmation: { required: true },
      idempotency: { required: true },
    }),
    action("connect_payout", {
      target: "collection",
      confirmation: { required: true },
      inputSchema: objectSchema({
        stripe_connect_account_id: { type: ["string", "null"] },
        paypal_merchant_id: { type: ["string", "null"] },
        metamask_address: { type: ["string", "null"] },
        payout_preference: { enum: ["stripe", "paypal", "crypto"] },
      }),
    }),
    action("commerce_config", {
      target: "collection",
      effect: "read",
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
    action("enable_tailscale", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
    }),
    action("invite", {
      target: "collection",
      effect: "external",
      confirmation: { required: true },
      inputSchema: objectSchema(
        {
          email: { type: "string" },
          remote_bridge_url: { type: "string" },
        },
        ["email"]
      ),
    }),
    action("accept", {
      effect: "external",
      confirmation: { required: true },
      sensitiveInputPaths: ["federation_token"],
      inputSchema: objectSchema(
        {
          remote_bridge_url: { type: "string" },
          federation_token: { type: "string" },
          remote_user_id: { type: "string" },
          remote_display_name: { type: "string" },
          remote_email: { type: "string" },
          tailscale_node_id: { type: "string" },
          tailscale_dns_name: { type: "string" },
        },
        ["remote_bridge_url", "federation_token"]
      ),
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
      inputSchema: objectSchema({
        endpoint_id: { type: "string" },
        messages: { type: "array" },
        sampling: { type: "object" },
        priority: { type: "number" },
      }),
    }),
  ],
  FinanceConnection: [
    action("configure_moralis", {
      target: "collection",
      effect: "external",
      execution: "async",
      confirmation: { required: true },
      sensitiveInputPaths: ["api_key"],
      inputSchema: objectSchema({ api_key: { type: "string" } }, ["api_key"]),
    }),
    action("configure_paypal", {
      target: "collection",
      effect: "external",
      execution: "async",
      confirmation: { required: true },
      sensitiveInputPaths: ["client_secret"],
      inputSchema: objectSchema(
        {
          client_id: { type: "string" },
          client_secret: { type: "string" },
          env: { enum: ["sandbox", "live"] },
        },
        ["client_id", "client_secret"]
      ),
    }),
    action("preview_crypto", {
      target: "collection",
      effect: "external",
      execution: "async",
      inputSchema: objectSchema(
        {
          address: { type: "string" },
          chains: { type: "array", items: { type: "string" } },
        },
        ["address"]
      ),
    }),
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
      sensitiveInputPaths: ["api_key", "client_secret"],
      inputSchema: objectSchema(
        {
          provider: { enum: ["paypal", "moralis", "crypto"] },
          address: { type: "string" },
          wallet_provider: { type: "string" },
          label: { type: "string" },
          chains: { type: "array", items: { type: "string" } },
          api_key: { type: "string" },
          client_id: { type: "string" },
          client_secret: { type: "string" },
          env: { enum: ["sandbox", "live"] },
        },
        ["provider"]
      ),
    }),
    action("refresh_external", {
      effect: "external",
      execution: "async",
      cancellable: true,
    }),
  ],
  PlatformGroupMember: [
    action("add", {
      target: "collection",
      roles: ["owner"],
      confirmation: { required: true },
      inputSchema: objectSchema(
        {
          group_id: { type: "string" },
          member_kind: { enum: ["user", "agent"] },
          member_id: { type: "string" },
          tenant_id: { type: "string" },
        },
        ["group_id", "member_kind", "member_id"]
      ),
    }),
    action("remove", {
      target: "collection",
      roles: ["owner"],
      effect: "destructive",
      confirmation: { required: true },
      inputSchema: objectSchema(
        {
          group_id: { type: "string" },
          member_kind: { enum: ["user", "agent"] },
          member_id: { type: "string" },
          tenant_id: { type: "string" },
        },
        ["group_id", "member_kind", "member_id"]
      ),
    }),
  ],
};
