import fs from "node:fs";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { configureDbPragmas, logDbConfig } from "./services/db-config.js";
import { backfillWelcomeWikiPages } from "./services/welcome-wiki.js";
import { ensurePlatformGroups } from "./services/platform-groups.js";
import {
  addCol,
  runMigrations,
  type Migration,
} from "./services/db-migrations.js";

function ensurePlatformGroupsTables(db: CoreDatabase): void {
  ensurePlatformGroups(db);
}

export type MembershipRole = "viewer" | "editor" | "owner";
export type ShareGrantRole = "viewer" | "editor" | "owner";
export type MarketplaceListingKind =
  | "agent"
  | "department"
  | "division"
  | "page"
  | "skill"
  | "rule"
  | "artifact"
  | "workflow"
  | "adapter"
  | "dataset"
  | "knowledge"
  | "promptflow"
  | "bundle"
  | "connector_package"
  | "inference"
  | "model"
  | "user_calendar"
  | "user_tasks";

export type DeliveryMode = "clone" | "live";
export type PricingModel = "one_time" | "subscription" | "metered";
export type EntitlementStatus = "active" | "expired" | "cancelled";

export interface CoreUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: number;
  /** scrypt password hash (`scrypt$<saltHex>$<hashHex>`); null for OAuth-only users. */
  password_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoreUserProfile {
  user_id: string;
  headline: string | null;
  bio: string | null;
  pronouns: string | null;
  location: string | null;
  timezone: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  website: string | null;
  twitter: string | null;
  github: string | null;
  linkedin: string | null;
  emoji: string | null;
  birthday: string | null;
  languages: string | null;
  interests: string | null;
  values: string | null;
  goals: string | null;
  personality_notes: string | null;
  decision_style: string | null;
  risk_tolerance: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoreTenant {
  id: string;
  name: string;
  slug: string;
  is_operator: number;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CoreTenantMembership {
  user_id: string;
  tenant_id: string;
  role: MembershipRole;
  created_at: string;
}

export interface CoreSession {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface CoreCreditWallet {
  user_id: string;
  balance: number;
  updated_at: string;
}

export interface CoreMarketplaceListing {
  id: string;
  seller_user_id: string;
  seller_tenant_id: string;
  kind: MarketplaceListingKind;
  resource_id: string;
  title: string;
  description: string | null;
  price_credits: number;
  bundle_json: string;
  visibility: string;
  status: string;
  delivery_mode: DeliveryMode;
  pricing_model: PricingModel;
  price_period: string | null;
  meter_unit: string | null;
  meter_rate: number | null;
  license: string | null;
  inference_endpoint_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoreMarketplaceEntitlement {
  id: string;
  listing_id: string;
  buyer_user_id: string;
  buyer_tenant_id: string;
  kind: MarketplaceListingKind;
  owner_tenant_id: string;
  owner_user_id: string;
  resource_kind: MarketplaceListingKind;
  resource_id: string;
  share_grant_id: string;
  pricing_model: PricingModel;
  status: EntitlementStatus;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoreInferenceEndpoint {
  id: string;
  owner_tenant_id: string;
  owner_user_id: string;
  name: string;
  base_model_path: string;
  adapter_ids_json: string;
  meter_unit: string;
  meter_rate: number;
  capacity_hint: number;
  status: string;
  created_at: string;
}

export interface CoreShareGrant {
  id: string;
  owner_tenant_id: string;
  owner_user_id: string;
  resource_kind: MarketplaceListingKind;
  resource_id: string;
  grantee_user_id: string | null;
  grantee_tenant_id: string | null;
  role: ShareGrantRole;
  bridge_url: string | null;
  federation_token: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CoreDatabase = Database.Database;

let coreDbSingleton: CoreDatabase | null = null;

export function initCoreDb(): CoreDatabase {
  if (coreDbSingleton) return coreDbSingleton;

  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.coreDbPath);
  configureDbPragmas(db);
  logDbConfig(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TEXT,
      profile_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS oauth_accounts_user_idx ON oauth_accounts(user_id);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, expires_at);

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_operator INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS tenants_owner_idx ON tenants(owner_user_id);

    CREATE TABLE IF NOT EXISTS tenant_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tenant_id)
    );
    CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_idx
      ON tenant_memberships(tenant_id, role);

    CREATE TABLE IF NOT EXISTS credit_wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS credit_ledger_user_idx
      ON credit_ledger(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT NOT NULL REFERENCES users(id),
      seller_tenant_id TEXT NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      price_credits INTEGER NOT NULL DEFAULT 0,
      bundle_json TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx
      ON marketplace_listings(status, visibility, created_at DESC);

    CREATE TABLE IF NOT EXISTS marketplace_purchases (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),
      buyer_user_id TEXT NOT NULL REFERENCES users(id),
      buyer_tenant_id TEXT NOT NULL REFERENCES tenants(id),
      price_credits INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS marketplace_purchases_buyer_idx
      ON marketplace_purchases(buyer_user_id, created_at DESC);

    -- Durable coordinator for clone acquisitions that span core + one tenant DB.
    -- Each database commits only its owned writes, audit, and outbox atomically;
    -- receipts allow the coordinator to safely resume after process failure.
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_operations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      buyer_tenant_id TEXT NOT NULL,
      listing_bundle_json TEXT NOT NULL,
      listing_title TEXT NOT NULL,
      status TEXT NOT NULL,
      imported_kind TEXT,
      imported_id TEXT,
      purchase_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      UNIQUE (buyer_tenant_id, buyer_user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS marketplace_acquisition_status_idx
      ON marketplace_acquisition_operations(status, updated_at);
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_steps (
      operation_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (operation_id, step_name)
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_audit (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      owner_database TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_outbox (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS share_grants (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      grantee_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      grantee_tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'viewer',
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (grantee_user_id IS NOT NULL AND grantee_tenant_id IS NULL)
        OR (grantee_user_id IS NULL AND grantee_tenant_id IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS share_grants_grantee_user_idx
      ON share_grants(grantee_user_id, resource_kind, resource_id);
    CREATE INDEX IF NOT EXISTS share_grants_grantee_tenant_idx
      ON share_grants(grantee_tenant_id, resource_kind, resource_id);
    CREATE INDEX IF NOT EXISTS share_grants_owner_resource_idx
      ON share_grants(owner_tenant_id, resource_kind, resource_id);

    CREATE TABLE IF NOT EXISTS platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cross-tenant registry for opt-in collaborative chat sessions. A session's
    -- chat + artifacts live in the INITIATOR's tenant DB (home_tenant_id); other
    -- participants route their reads/writes to that home DB. Stored in core so it
    -- is resolvable across tenants.
    CREATE TABLE IF NOT EXISTS shared_chat_sessions (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL UNIQUE,
      home_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS shared_chat_sessions_chat_idx
      ON shared_chat_sessions(chat_id);
    CREATE INDEX IF NOT EXISTS shared_chat_sessions_agent_idx
      ON shared_chat_sessions(agent_id);

    -- Human-to-human persistent chat (cross-tenant; lives in core DB).
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
      title TEXT,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT,
      last_message_preview TEXT
    );
    CREATE INDEX IF NOT EXISTS dm_conversations_updated_idx
      ON dm_conversations(last_message_at DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS dm_conversation_members (
      conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_read_at TEXT,
      last_read_message_id TEXT,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS dm_conversation_members_user_idx
      ON dm_conversation_members(user_id, conversation_id);

    CREATE TABLE IF NOT EXISTS dm_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id),
      body_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS dm_messages_conversation_idx
      ON dm_messages(conversation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS dm_blobs (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS dm_blobs_owner_idx
      ON dm_blobs(owner_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS dm_message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'resource_ref')),
      blob_id TEXT REFERENCES dm_blobs(id) ON DELETE SET NULL,
      resource_kind TEXT,
      resource_id TEXT,
      label TEXT,
      href TEXT,
      mime TEXT,
      size INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS dm_message_attachments_message_idx
      ON dm_message_attachments(message_id);

    CREATE TABLE IF NOT EXISTS marketplace_entitlements (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),
      buyer_user_id TEXT NOT NULL REFERENCES users(id),
      buyer_tenant_id TEXT NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL,
      owner_tenant_id TEXT NOT NULL REFERENCES tenants(id),
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      share_grant_id TEXT NOT NULL REFERENCES share_grants(id) ON DELETE CASCADE,
      pricing_model TEXT NOT NULL DEFAULT 'one_time',
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS marketplace_entitlements_buyer_idx
      ON marketplace_entitlements(buyer_user_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS inference_endpoints (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT NOT NULL REFERENCES tenants(id),
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      base_model_path TEXT NOT NULL,
      adapter_ids_json TEXT NOT NULL DEFAULT '[]',
      meter_unit TEXT NOT NULL DEFAULT 'request',
      meter_rate INTEGER NOT NULL DEFAULT 1,
      capacity_hint INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS inference_endpoints_owner_idx
      ON inference_endpoints(owner_tenant_id, status);

    CREATE TABLE IF NOT EXISTS inference_usage (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES inference_endpoints(id),
      buyer_user_id TEXT NOT NULL REFERENCES users(id),
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 1,
      credits_charged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS inference_usage_endpoint_idx
      ON inference_usage(endpoint_id, created_at DESC);

    -- Registry of bridge connections for hardware-bound plugin federation.
    -- Bridge (never SC directly): 'local' is this Bridge's own SC stack;
    -- 'remote' proxies another Bridge's federation API (peer URL + token).
    CREATE TABLE IF NOT EXISTS bridge_connections (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      label TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'local',
      remote_bridge_url TEXT,
      remote_bridge_token TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS bridge_connections_owner_idx
      ON bridge_connections(owner_tenant_id, status);

    -- Extended, social-network-style profile fields for a user. One row per
    -- user; display_name + avatar_url stay on the users table so existing
    -- member/lookup queries keep working.
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      headline TEXT,
      bio TEXT,
      pronouns TEXT,
      location TEXT,
      timezone TEXT,
      phone TEXT,
      company TEXT,
      job_title TEXT,
      website TEXT,
      twitter TEXT,
      github TEXT,
      linkedin TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cross-cutting notifications for both human users and agents.
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('user', 'agent')),
      recipient_id TEXT NOT NULL,
      recipient_tenant_id TEXT,
      category TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      resource_kind TEXT,
      resource_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx
      ON notifications(recipient_kind, recipient_id, read_at, created_at DESC);

    -- Append-only platform event log feeding the autonomy (hooks) engine.
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
      actor_id TEXT,
      tenant_id TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS events_type_idx ON events(type, created_at DESC);
    CREATE INDEX IF NOT EXISTS events_tenant_idx ON events(tenant_id, created_at DESC);

    -- Trigger -> condition -> action automations owned by a user or an agent.
    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'agent')),
      owner_id TEXT NOT NULL,
      owner_tenant_id TEXT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('event', 'schedule')),
      event_type TEXT,
      schedule_cron TEXT,
      condition_json TEXT,
      action_kind TEXT NOT NULL CHECK (action_kind IN ('notify', 'run_agent', 'run_workflow', 'send_message', 'webhook')),
      action_config_json TEXT,
      rate_limit_per_hour INTEGER,
      require_approval INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fired_at TEXT
    );
    CREATE INDEX IF NOT EXISTS hooks_owner_idx ON hooks(owner_kind, owner_id);
    CREATE INDEX IF NOT EXISTS hooks_event_idx
      ON hooks(trigger_kind, enabled, event_type);

    -- Audit/execution log for hook firings.
    CREATE TABLE IF NOT EXISTS hook_runs (
      id TEXT PRIMARY KEY,
      hook_id TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
      event_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped', 'pending_approval')),
      detail TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS hook_runs_hook_idx
      ON hook_runs(hook_id, created_at DESC);

    -- Support desk: tickets + threaded messages.
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      requester_kind TEXT NOT NULL CHECK (requester_kind IN ('user', 'agent')),
      requester_id TEXT NOT NULL,
      requester_tenant_id TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      category TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
      priority TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS support_tickets_status_idx
      ON support_tickets(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS support_tickets_requester_idx
      ON support_tickets(requester_kind, requester_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'agent', 'admin')),
      author_id TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS support_messages_ticket_idx
      ON support_messages(ticket_id, created_at ASC);

    -- Internal/external knowledge base pages.
    CREATE TABLE IF NOT EXISTS wiki_pages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      space TEXT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'internal'
        CHECK (visibility IN ('internal', 'external')),
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (visibility, slug)
    );
    CREATE INDEX IF NOT EXISTS wiki_pages_scope_idx
      ON wiki_pages(tenant_id, visibility, updated_at DESC);

    CREATE TABLE IF NOT EXISTS wiki_revisions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS wiki_revisions_page_idx
      ON wiki_revisions(page_id, created_at DESC);
  `);

  runMigrations(db, CORE_MIGRATIONS);
  ensurePlatformGroupsTables(db);

  backfillWelcomeWikiPages(db);

  // Self-heal: purge blank notification rows
  try {
    db.prepare(
      `DELETE FROM notifications
       WHERE (title IS NULL OR trim(title) = '')
         AND (body IS NULL OR trim(body) = '')`
    ).run();
  } catch {
    /* optional cleanup */
  }

  coreDbSingleton = db;
  return db;
}

export const CORE_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "core_user_columns_v1", up: ensureCoreUserColumns },
  { version: 2, name: "core_marketplace_columns_v1", up: ensureCoreMarketplaceColumns },
  { version: 3, name: "core_dm_agent_columns_v1", up: ensureDmAgentColumns },
  {
    version: 4,
    name: "core_hooks_workflow_action_v1",
    up: ensureHooksRunWorkflowAction,
    foreignKeysOff: true,
  },
  {
    version: 5,
    name: "core_dm_members_agent_fk_v1",
    up: ensureDmMembersAgentFkFix,
    foreignKeysOff: true,
  },
  {
    version: 6,
    name: "core_wiki_tenant_slugs_v1",
    up: ensureWikiPerTenantSlugIndexes,
    foreignKeysOff: true,
  },
  { version: 7, name: "core_wiki_search_v1", up: ensureWikiSearchAndProposals },
  { version: 8, name: "core_oss_platform_v2", up: ensureOssPlatformV2Tables },
];

function ensureCoreUserColumns(db: CoreDatabase): void {
  ensureUsersIsAdminColumn(db);
  ensureUsersPasswordHashColumn(db);
  ensureUserProfileExtendedColumns(db);
}

function ensureCoreMarketplaceColumns(db: CoreDatabase): void {
  ensureMarketplaceListingEconomyColumns(db);
  ensureShareGrantFederationColumns(db);
}

/**
 * Idempotent migration: databases created before the `run_workflow` hook action
 * existed carry a CHECK constraint that rejects it. SQLite cannot alter a CHECK
 * in place, so rebuild the hooks table with the widened constraint (preserving
 * rows and the hook_runs FK reference by name). No-op once the constraint allows
 * `run_workflow`.
 */
function ensureHooksRunWorkflowAction(db: CoreDatabase): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hooks'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'run_workflow'")) return;

  db.exec(`
      DROP TABLE IF EXISTS hooks_new;
      CREATE TABLE hooks_new (
        id TEXT PRIMARY KEY,
        owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'agent')),
        owner_id TEXT NOT NULL,
        owner_tenant_id TEXT,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('event', 'schedule')),
        event_type TEXT,
        schedule_cron TEXT,
        condition_json TEXT,
        action_kind TEXT NOT NULL CHECK (action_kind IN ('notify', 'run_agent', 'run_workflow', 'send_message', 'webhook')),
        action_config_json TEXT,
        rate_limit_per_hour INTEGER,
        require_approval INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_fired_at TEXT
      );
      INSERT INTO hooks_new SELECT * FROM hooks;
      DROP TABLE hooks;
      ALTER TABLE hooks_new RENAME TO hooks;
      CREATE INDEX IF NOT EXISTS hooks_owner_idx ON hooks(owner_kind, owner_id);
      CREATE INDEX IF NOT EXISTS hooks_event_idx
        ON hooks(trigger_kind, enabled, event_type);
  `);
}

/** Idempotent migration for databases created before is_admin existed. */
function ensureUsersIsAdminColumn(db: CoreDatabase): void {
  addCol(db, "users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
}

/** Idempotent migration for extended user_profiles columns. */
function ensureUserProfileExtendedColumns(db: CoreDatabase): void {
  const add = (name: string, def: string) => {
    addCol(db, "user_profiles", name, def);
  };
  add("emoji", "TEXT");
  add("birthday", "TEXT");
  add("languages", "TEXT");
  add("interests", "TEXT");
  add("values", "TEXT");
  add("goals", "TEXT");
  add("personality_notes", "TEXT");
  add("decision_style", "TEXT");
  add("risk_tolerance", "TEXT");
}

/** Idempotent migration for databases created before password_hash existed. */
function ensureUsersPasswordHashColumn(db: CoreDatabase): void {
  addCol(db, "users", "password_hash", "TEXT");
}

/** Idempotent migration for marketplace economy columns. */
function ensureMarketplaceListingEconomyColumns(db: CoreDatabase): void {
  addCol(db, "marketplace_listings", "delivery_mode", "TEXT NOT NULL DEFAULT 'clone'");
  addCol(db, "marketplace_listings", "pricing_model", "TEXT NOT NULL DEFAULT 'one_time'");
  addCol(db, "marketplace_listings", "price_period", "TEXT");
  addCol(db, "marketplace_listings", "meter_unit", "TEXT");
  addCol(db, "marketplace_listings", "meter_rate", "INTEGER");
  addCol(db, "marketplace_listings", "license", "TEXT");
  addCol(db, "marketplace_listings", "inference_endpoint_id", "TEXT");
}

/**
 * Idempotent migration: a share grant on a federated resource can carry the
 * owner's federation bridge URL + token so the grantee's Bridge can proxy SC
 * operations to the owner's Bridge (remote connection).
 */
/** Idempotent migration: mixed human+agent conversation members and agent senders. */
function ensureDmAgentColumns(db: CoreDatabase): void {
  addCol(db, "dm_conversation_members", "member_kind", "TEXT NOT NULL DEFAULT 'user'");
  addCol(db, "dm_conversation_members", "agent_id", "TEXT");
  addCol(db, "dm_conversation_members", "agent_tenant_id", "TEXT");
  addCol(db, "dm_messages", "sender_kind", "TEXT NOT NULL DEFAULT 'user'");
  addCol(db, "dm_messages", "sender_agent_id", "TEXT");
  addCol(db, "dm_messages", "sender_agent_tenant_id", "TEXT");
}

/**
 * Idempotent migration: older databases defined `dm_conversation_members.user_id`
 * with a `REFERENCES users(id)` foreign key. Agent members are stored with a
 * synthetic `agent:<id>` user_id that can never satisfy that constraint, so
 * adding an agent to a group failed with "FOREIGN KEY constraint failed".
 * Rebuild the table without the user_id FK (keeping the conversation FK).
 */
function ensureDmMembersAgentFkFix(db: CoreDatabase): void {
  const fks = db
    .prepare("PRAGMA foreign_key_list(dm_conversation_members)")
    .all() as Array<{ table: string }>;
  if (!fks.some((f) => f.table === "users")) return;

  db.exec(`
      DROP TABLE IF EXISTS dm_conversation_members_new;
      CREATE TABLE dm_conversation_members_new (
        conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_read_at TEXT,
        last_read_message_id TEXT,
        member_kind TEXT NOT NULL DEFAULT 'user',
        agent_id TEXT,
        agent_tenant_id TEXT,
        PRIMARY KEY (conversation_id, user_id)
      );
      INSERT INTO dm_conversation_members_new
        (conversation_id, user_id, role, joined_at, last_read_at,
         last_read_message_id, member_kind, agent_id, agent_tenant_id)
      SELECT conversation_id, user_id, role, joined_at, last_read_at,
         last_read_message_id, member_kind, agent_id, agent_tenant_id
      FROM dm_conversation_members;
      DROP TABLE dm_conversation_members;
      ALTER TABLE dm_conversation_members_new RENAME TO dm_conversation_members;
      CREATE INDEX IF NOT EXISTS dm_conversation_members_user_idx
        ON dm_conversation_members(user_id, conversation_id);
  `);
}

/**
 * Internal wiki slugs are unique per tenant; external slugs stay globally unique.
 */
function ensureWikiPerTenantSlugIndexes(db: CoreDatabase): void {
  const migrated = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name='wiki_pages_tenant_visibility_slug_idx'`
    )
    .get();
  if (migrated) return;

  db.exec(`
      DROP TABLE IF EXISTS wiki_pages__migrated;
      CREATE TABLE wiki_pages__migrated (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      space TEXT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'internal'
        CHECK (visibility IN ('internal', 'external')),
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO wiki_pages__migrated
      SELECT id, tenant_id, space, slug, title, body_markdown, visibility, author_user_id, created_at, updated_at
      FROM wiki_pages;
    DROP TABLE wiki_pages;
    ALTER TABLE wiki_pages__migrated RENAME TO wiki_pages;
    CREATE INDEX IF NOT EXISTS wiki_pages_scope_idx
      ON wiki_pages(tenant_id, visibility, updated_at DESC);
    CREATE UNIQUE INDEX wiki_pages_tenant_visibility_slug_idx
      ON wiki_pages(tenant_id, visibility, slug);
      CREATE UNIQUE INDEX wiki_pages_external_slug_idx
        ON wiki_pages(slug) WHERE visibility = 'external';
  `);
}

/** Wiki hybrid RAG (FTS + embeddings) and staged synthesize proposals. */
function ensureWikiSearchAndProposals(db: CoreDatabase): void {
  addCol(db, "wiki_pages", "embedding", "BLOB");
  addCol(db, "wiki_pages", "embedding_dim", "INTEGER");

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(
      page_id UNINDEXED,
      title,
      body
    );

    CREATE TABLE IF NOT EXISTS wiki_page_proposals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create', 'update')),
      space TEXT,
      slug TEXT,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      target_page_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'synthesize',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS wiki_page_proposals_status_idx
      ON wiki_page_proposals(tenant_id, status, created_at DESC);
  `);
}

function ensureShareGrantFederationColumns(db: CoreDatabase): void {
  addCol(db, "share_grants", "bridge_url", "TEXT");
  addCol(db, "share_grants", "federation_token", "TEXT");
  addCol(db, "share_grants", "grantee_email", "TEXT");
  addCol(db, "share_grants", "grantee_peer_connection_id", "TEXT");
  addCol(db, "share_grants", "expires_at", "TEXT");
}

/** OSS v2: catalog installs, peer federation, support routing, onboarding. */
function ensureOssPlatformV2Tables(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS catalog_sources_user_idx ON catalog_sources(user_id);

    CREATE TABLE IF NOT EXISTS catalog_installs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      entry_title TEXT NOT NULL,
      install_type TEXT NOT NULL,
      source_catalog TEXT,
      installed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS catalog_installs_tenant_idx ON catalog_installs(tenant_id, installed_at DESC);

    CREATE TABLE IF NOT EXISTS tenant_plugins (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL,
      version TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      plugin_root TEXT,
      state TEXT NOT NULL DEFAULT 'active',
      desired_state TEXT NOT NULL DEFAULT 'active',
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, plugin_id)
    );
    CREATE INDEX IF NOT EXISTS tenant_plugins_tenant_idx
      ON tenant_plugins(tenant_id, installed_at);

    CREATE TABLE IF NOT EXISTS peer_connections (
      id TEXT PRIMARY KEY,
      local_user_id TEXT NOT NULL,
      remote_bridge_url TEXT NOT NULL,
      remote_user_id TEXT,
      remote_display_name TEXT,
      remote_email TEXT,
      tailscale_node_id TEXT,
      tailscale_dns_name TEXT,
      federation_token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_health_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS peer_connections_user_idx ON peer_connections(local_user_id);

    CREATE TABLE IF NOT EXISTS federated_share_invites (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      invitee_email TEXT NOT NULL,
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT,
      accepted_peer_connection_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS federated_share_invites_token_idx ON federated_share_invites(invite_token);
  `);

  addCol(
    db,
    "support_tickets",
    "target_kind",
    "TEXT NOT NULL DEFAULT 'resource_owner'"
  );
  addCol(db, "support_tickets", "shared_grant_id", "TEXT");
  addCol(db, "support_tickets", "owner_user_id", "TEXT");
}

export function getCoreDb(): CoreDatabase {
  if (!coreDbSingleton) return initCoreDb();
  return coreDbSingleton;
}

export function getPlatformMeta(db: CoreDatabase, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM platform_meta WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setPlatformMeta(
  db: CoreDatabase,
  key: string,
  value: string
): void {
  db.prepare(
    `INSERT INTO platform_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(key, value);
}

export function getOperatorTenantId(db: CoreDatabase): string | null {
  const row = db
    .prepare("SELECT id FROM tenants WHERE is_operator=1 LIMIT 1")
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

/** All tenant ids known to the platform (operator first). Used by background workers. */
export function listAllTenantIds(db: CoreDatabase): string[] {
  return (
    db
      .prepare("SELECT id FROM tenants ORDER BY is_operator DESC, created_at ASC")
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}

export type BridgeConnectionMode = "local" | "remote";

export interface CoreBridgeConnection {
  id: string;
  owner_tenant_id: string;
  owner_user_id: string;
  label: string;
  mode: BridgeConnectionMode;
  remote_bridge_url: string | null;
  remote_bridge_token: string | null;
  status: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoreSharedChatSession {
  id: string;
  chat_id: string;
  home_tenant_id: string;
  agent_id: string;
  created_by_user_id: string;
  created_at: string;
}

export type DmConversationKind = "direct" | "group";
export type DmMemberRole = "owner" | "member";
export type DmMemberKind = "user" | "agent";
export type DmSenderKind = "user" | "agent";
export type DmAttachmentKind = "image" | "file" | "resource_ref";

export interface CoreDmConversation {
  id: string;
  kind: DmConversationKind;
  title: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
}

export interface CoreDmConversationMember {
  conversation_id: string;
  user_id: string;
  role: DmMemberRole;
  joined_at: string;
  last_read_at: string | null;
  last_read_message_id: string | null;
  member_kind?: DmMemberKind;
  agent_id?: string | null;
  agent_tenant_id?: string | null;
}

export interface CoreDmMessage {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  body_text: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  sender_kind?: DmSenderKind;
  sender_agent_id?: string | null;
  sender_agent_tenant_id?: string | null;
}

export interface CoreDmBlob {
  id: string;
  owner_user_id: string;
  filename: string;
  mime: string;
  size: number;
  path: string;
  created_at: string;
}

export interface CoreDmMessageAttachment {
  id: string;
  message_id: string;
  kind: DmAttachmentKind;
  blob_id: string | null;
  resource_kind: string | null;
  resource_id: string | null;
  label: string | null;
  href: string | null;
  mime: string | null;
  size: number | null;
  created_at: string;
}

export type NotificationRecipientKind = "user" | "agent";

export interface CoreNotification {
  id: string;
  recipient_kind: NotificationRecipientKind;
  recipient_id: string;
  recipient_tenant_id: string | null;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  resource_kind: string | null;
  resource_id: string | null;
  read_at: string | null;
  created_at: string;
}

export type EventActorKind = "user" | "agent" | "system";

export interface CoreEvent {
  id: string;
  type: string;
  actor_kind: EventActorKind;
  actor_id: string | null;
  tenant_id: string | null;
  payload_json: string | null;
  created_at: string;
}

export type HookOwnerKind = "user" | "agent";
export type HookTriggerKind = "event" | "schedule";
export type HookActionKind =
  | "notify"
  | "run_agent"
  | "run_workflow"
  | "send_message"
  | "webhook";

export interface CoreHook {
  id: string;
  owner_kind: HookOwnerKind;
  owner_id: string;
  owner_tenant_id: string | null;
  name: string;
  enabled: number;
  trigger_kind: HookTriggerKind;
  event_type: string | null;
  schedule_cron: string | null;
  condition_json: string | null;
  action_kind: HookActionKind;
  action_config_json: string | null;
  rate_limit_per_hour: number | null;
  require_approval: number;
  created_at: string;
  updated_at: string;
  last_fired_at: string | null;
}

export type HookRunStatus = "success" | "error" | "skipped" | "pending_approval";

export interface CoreHookRun {
  id: string;
  hook_id: string;
  event_id: string | null;
  status: HookRunStatus;
  detail: string | null;
  result_json: string | null;
  created_at: string;
}

export type SupportRequesterKind = "user" | "agent";
export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type SupportAuthorKind = "user" | "agent" | "admin";

export interface CoreSupportTicket {
  id: string;
  requester_kind: SupportRequesterKind;
  requester_id: string;
  requester_tenant_id: string | null;
  subject: string;
  body: string;
  category: string | null;
  status: SupportTicketStatus;
  priority: string | null;
  target_kind?: string | null;
  shared_grant_id?: string | null;
  owner_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoreSupportMessage {
  id: string;
  ticket_id: string;
  author_kind: SupportAuthorKind;
  author_id: string;
  body: string;
  created_at: string;
}

export type WikiVisibility = "internal" | "external";

export interface CoreWikiPage {
  id: string;
  tenant_id: string;
  space: string | null;
  slug: string;
  title: string;
  body_markdown: string;
  visibility: WikiVisibility;
  author_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CoreWikiRevision {
  id: string;
  page_id: string;
  title: string;
  body_markdown: string;
  author_user_id: string;
  created_at: string;
}

/**
 * Register a chat as a collaborative "shared session". The chat keeps living in
 * the initiator's tenant DB (`homeTenantId`); other participants route their
 * reads/writes to that home DB. Idempotent on `chat_id` — re-sharing an already
 * shared chat returns the existing session unchanged.
 */
export function createSharedChatSession(
  db: CoreDatabase,
  opts: {
    id: string;
    chatId: string;
    homeTenantId: string;
    agentId: string;
    createdByUserId: string;
  }
): CoreSharedChatSession {
  const existing = getSharedChatSession(db, opts.chatId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO shared_chat_sessions
       (id, chat_id, home_tenant_id, agent_id, created_by_user_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(opts.id, opts.chatId, opts.homeTenantId, opts.agentId, opts.createdByUserId);
  return getSharedChatSession(db, opts.chatId)!;
}

/** Resolve a chat's shared-session registry row (its home tenant), if any. */
export function getSharedChatSession(
  db: CoreDatabase,
  chatId: string
): CoreSharedChatSession | null {
  return (
    (db
      .prepare(`SELECT * FROM shared_chat_sessions WHERE chat_id = ?`)
      .get(chatId) as CoreSharedChatSession | undefined) ?? null
  );
}

/** Shared sessions visible to a user via home-tenant membership or agent share grant. */
export function listSharedChatSessionsForUser(
  db: CoreDatabase,
  userId: string
): CoreSharedChatSession[] {
  return db
    .prepare(
      `SELECT DISTINCT s.*
       FROM shared_chat_sessions s
       LEFT JOIN tenant_memberships m
         ON m.tenant_id = s.home_tenant_id AND m.user_id = ?
       LEFT JOIN share_grants g
         ON g.resource_kind = 'agent'
        AND g.resource_id = s.agent_id
        AND (g.grantee_user_id = ? OR g.grantee_tenant_id IN (
          SELECT tenant_id FROM tenant_memberships WHERE user_id = ?
        ))
       WHERE m.user_id IS NOT NULL OR g.id IS NOT NULL OR s.created_by_user_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(userId, userId, userId, userId) as CoreSharedChatSession[];
}

export function listBridgeConnectionsForTenant(
  db: CoreDatabase,
  ownerTenantId: string
): CoreBridgeConnection[] {
  return db
    .prepare(
      `SELECT * FROM bridge_connections
       WHERE owner_tenant_id=?
       ORDER BY mode ASC, created_at ASC`
    )
    .all(ownerTenantId) as CoreBridgeConnection[];
}

export function getBridgeConnection(
  db: CoreDatabase,
  connectionId: string
): CoreBridgeConnection | null {
  return (
    (db
      .prepare(`SELECT * FROM bridge_connections WHERE id=?`)
      .get(connectionId) as CoreBridgeConnection | undefined) ?? null
  );
}

export function getLocalBridgeConnection(
  db: CoreDatabase,
  ownerTenantId: string
): CoreBridgeConnection | null {
  return (
    (db
      .prepare(
        `SELECT * FROM bridge_connections
         WHERE owner_tenant_id=? AND mode='local'
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(ownerTenantId) as CoreBridgeConnection | undefined) ?? null
  );
}

export function createBridgeConnection(
  db: CoreDatabase,
  opts: {
    id: string;
    ownerTenantId: string;
    ownerUserId: string;
    label: string;
    mode: BridgeConnectionMode;
    remoteBridgeUrl?: string | null;
    remoteBridgeToken?: string | null;
    status?: string;
  }
): CoreBridgeConnection {
  db.prepare(
    `INSERT INTO bridge_connections
       (id, owner_tenant_id, owner_user_id, label, mode,
        remote_bridge_url, remote_bridge_token, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.id,
    opts.ownerTenantId,
    opts.ownerUserId,
    opts.label,
    opts.mode,
    opts.remoteBridgeUrl ?? null,
    opts.remoteBridgeToken ?? null,
    opts.status ?? "online"
  );
  return getBridgeConnection(db, opts.id)!;
}

/** Idempotent: one local connection per operator tenant at boot. */
export function ensureLocalBridgeConnection(
  db: CoreDatabase,
  opts: { ownerTenantId: string; ownerUserId: string; label?: string }
): CoreBridgeConnection {
  const existing = getLocalBridgeConnection(db, opts.ownerTenantId);
  if (existing) return existing;
  return createBridgeConnection(db, {
    id: uuidv4(),
    ownerTenantId: opts.ownerTenantId,
    ownerUserId: opts.ownerUserId,
    label: opts.label ?? "Local connector",
    mode: "local",
    status: "online",
  });
}
