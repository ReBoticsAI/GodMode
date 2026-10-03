---
slug: dms-and-channels
title: "DMs and channels"
section: "Platform and agents"
location: "Social Chat → directory"
summary: "Discord-style Chat: Cloud lobby, this-install lobby, channel agents, and DMs with people and agents."
---
# DMs and channels

![dms-and-channels in GodMode](/features/dms-and-channels.png)

Social Chat uses a Discord-style directory with three planes:

1. **Cloud lobby** — Shared public channels on GodMode Cloud: `#general`, `#dev`, `#roadmap`, `#support`, `#thegame`. Local / Desktop / PWA clients read them when online (proxy to Cloud). On SaaS, this hub is the SoR.
2. **This install** — A single per-machine public room: `#local`, seeded on this install’s Users hub.
3. **Direct messages** — People, local agents (Intelligence, Digital You), private groups, and marketplace share-grant peers.

## Channel agents

Each public channel slug maps 1:1 to a real agent id: `channel-{slug}` (for example `channel-local`, `channel-general`). Selecting that channel in Chat **possesses** that agent for the Social secondary tab (Automations, Calendar, Knowledge, Bank, Vault). Chat stays on the public conversation stream.

- Seeded on the operator tenant at bootstrap (`#local` everywhere; Cloud lobby agents also on SaaS).
- Bound onto the public conversation as `member_kind='agent'`.
- Channel agents use full agent tooling (not persona / Digital You tooling).

## Roles

Public channels use **Admin**, **Moderator**, **Member**, and **Visitor** (private DMs/groups still use `owner` where needed; treat owner like admin for groups).

| Role | Read messages | Post (with entitlement) | Moderate others’ messages | Edit channel-agent content | Assign roles |
|------|---------------|-------------------------|---------------------------|----------------------------|--------------|
| Admin | yes | yes | yes | yes | yes |
| Moderator | yes | yes | yes | no | no |
| Member | yes | yes | no | no | no |
| Visitor | yes | no | no | no | no |

- Platform / install admins (`users.is_admin`) are seeded as **Admin** on public channels.
- First successful post upserts membership as **Member** (does not demote Admin or Moderator).
- No membership row means effective **Visitor** (read-only lookers, including temporary users).
- Visitors can view secondary-tab surfaces; writes to channel-agent owned resources return 403 unless Admin.

## Read vs write

- Public lobby channels are meant to be openly readable (including temporary visitors on GodMode, and scrapable / SEO-friendly Cloud lobby HTTP endpoints on SaaS).
- Message APIs for public channels return display names, not emails.
- **Sending** in public channels requires a signed-in user with a GodMode Cloud seat, Seller account, or paid GodMode Inference pack (free trial alone is not enough). Temporary visitors can look, not post.
- Agent DMs (Intelligence / Digital You) still use the normal Inference / trial path for orientation chat.

## Storage

- **This install** (`#local`, DMs, groups): host **Users** hub SQLite (`Users.sqlite` under the Bridge data dir). Tables: `dm_conversations`, `dm_messages`, `dm_conversation_members`, attachments/blobs as needed.
- **Cloud lobby** (`#general`, …): same table shape on **GodMode Cloud’s** Users hub when `DEPLOYMENT_MODE=saas`. Local clients do not store Cloud lobby history as SoR; they fetch via `/api/dm/public-lobby` and `/api/dm/cloud-lobby/:slug/messages` when online.
- Channel agents live in the operator tenant `ai_agents` table; tool execution remains on tenant stores until a later unification.
- Agent DMs in the directory already present Intelligence / Digital You as DM rows.

See [[chat-panel]].
