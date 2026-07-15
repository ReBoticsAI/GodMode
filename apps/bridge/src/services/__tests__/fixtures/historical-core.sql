PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL
);
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE tenant_memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, tenant_id)
);
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE marketplace_listings (
  id TEXT PRIMARY KEY,
  seller_user_id TEXT NOT NULL REFERENCES users(id),
  seller_tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  title TEXT NOT NULL,
  bundle_json TEXT NOT NULL
);
CREATE TABLE share_grants (
  id TEXT PRIMARY KEY,
  owner_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  grantee_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  grantee_tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE dm_conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE dm_conversation_members (
  conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_read_at TEXT,
  last_read_message_id TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE dm_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  body_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at TEXT,
  deleted_at TEXT
);
CREATE TABLE hooks (
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
  action_kind TEXT NOT NULL CHECK (action_kind IN ('notify', 'run_agent', 'send_message', 'webhook')),
  action_config_json TEXT,
  rate_limit_per_hour INTEGER,
  require_approval INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_fired_at TEXT
);
CREATE TABLE hook_runs (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
  status TEXT NOT NULL
);
CREATE TABLE wiki_pages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  space TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'internal',
  author_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (visibility, slug)
);
CREATE TABLE wiki_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL DEFAULT '',
  author_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  requester_kind TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT ''
);

INSERT INTO users VALUES
  ('user-1', 'owner@example.test', 'Owner'),
  ('user-2', 'member@example.test', 'Member');
INSERT INTO tenants VALUES ('tenant-1', 'Historical tenant', 'user-1');
INSERT INTO tenant_memberships VALUES
  ('user-1', 'tenant-1', 'owner'),
  ('user-2', 'tenant-1', 'editor');
INSERT INTO user_profiles (user_id, headline) VALUES ('user-1', 'Historical owner');
INSERT INTO marketplace_listings
  (id, seller_user_id, seller_tenant_id, kind, resource_id, title, bundle_json)
VALUES ('listing-1', 'user-1', 'tenant-1', 'agent', 'agent-1', 'Legacy listing', '{}');
INSERT INTO share_grants
  (id, owner_tenant_id, owner_user_id, resource_kind, resource_id, grantee_user_id)
VALUES ('grant-1', 'tenant-1', 'user-1', 'agent', 'agent-1', 'user-2');
INSERT INTO dm_conversations (id, kind, created_by_user_id)
VALUES ('conversation-1', 'direct', 'user-1');
INSERT INTO dm_conversation_members (conversation_id, user_id)
VALUES ('conversation-1', 'user-1');
INSERT INTO dm_messages (id, conversation_id, sender_user_id, body_text)
VALUES ('message-1', 'conversation-1', 'user-1', 'Historical message');
INSERT INTO hooks
  (id, owner_kind, owner_id, name, trigger_kind, action_kind)
VALUES ('hook-1', 'user', 'user-1', 'Historical hook', 'event', 'notify');
INSERT INTO hook_runs VALUES ('hook-run-1', 'hook-1', 'success');
INSERT INTO wiki_pages
  (id, tenant_id, slug, title, body_markdown, visibility, author_user_id)
VALUES ('wiki-1', 'tenant-1', 'welcome', 'Welcome', 'Historical body', 'internal', 'user-1');
INSERT INTO wiki_revisions
  (id, page_id, title, body_markdown, author_user_id)
VALUES ('revision-1', 'wiki-1', 'Welcome', 'Historical body', 'user-1');
INSERT INTO support_tickets
  (id, requester_kind, requester_id, subject, body)
VALUES ('ticket-1', 'user', 'user-1', 'Historical ticket', 'Please preserve me');
