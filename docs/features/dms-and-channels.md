---
slug: dms-and-channels
title: "DMs and channels"
section: "Platform and agents"
location: "Social Chat → directory"
summary: "Discord-style Chat: Cloud lobby, this-install lobby, channel agents, People, and Agents."
---
# DMs and channels

![dms-and-channels in GodMode](/features/dms-and-channels.png)

Social Chat uses a Discord-style directory with these planes:

1. **Cloud lobby** — Shared public channels on GodMode Cloud: `#general`, `#dev`, `#roadmap`, `#support`, `#thegame`. Local / Desktop / PWA clients read them when online (proxy to Cloud). On SaaS, this hub is the SoR.
2. **This install** — A single per-machine public room: `#local`, seeded on this install’s Users hub.
3. **People** — Direct chats with people, private groups, and marketplace share-grant peers.
4. **Agents** — Intelligence, Digital You, and each channel’s built-in agent (`#local`, `#general`, …) as a **1:1 DM**.

## Channel agents

Each public channel slug maps 1:1 to a real agent id: `channel-{slug}` (for example `channel-local`, `channel-general`).

- **Cloud / This install channel row** — Opens the shared public thread (everyone in the lobby). Selecting it also **possesses** that channel agent for Social secondary tabs (Automations, Calendar, Knowledge, Bank, Vault).
- **Agents → `#general` (or `#local`)** — Opens a private DM with that channel’s built-in agent (same destination as mentioning the agent).
- **`@general` / `@local` in the public channel** — Keeps the message in the lobby and mirrors it into the 1:1 DM with that channel agent so the agent can answer or act about the channel.

- Seeded on the operator tenant at bootstrap (local + Cloud lobby agent ids on every install; public Cloud lobby rooms only on SaaS).
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
- Message APIs for public channels return `@username` when the sender has claimed a Cloud handle, otherwise `display_name`. Emails are never returned on public-facing paths.
- Cloud-wide `@username` lives in `public_handles` (humans and seeded public agents such as `@general` / `@intelligence`). Claiming is optional in Settings → Profile. Mentions like `@qa_alpha` resolve across the GodMode Cloud ecosystem.
- **Sending** in public channels requires a signed-in user with a GodMode Cloud seat, Seller account, or paid GodMode Inference pack (free trial alone is not enough). Temporary visitors can look, not post.
- Agent DMs (Intelligence / Digital You) still use the normal Inference / trial path for orientation chat.

## Storage

- **This install** (`#local`, DMs, groups): host **Users** hub SQLite (`Users.sqlite` under the Bridge data dir). Tables: `dm_conversations`, `dm_messages`, `dm_conversation_members`, attachments/blobs as needed.
- **Cloud lobby** (`#general`, …): same table shape on **GodMode Cloud’s** Users hub when `DEPLOYMENT_MODE=saas`. Local clients do not store Cloud lobby history as SoR; they fetch via `/api/dm/public-lobby` and `/api/dm/cloud-lobby/:slug/messages` when online.
- Channel agents live in the operator tenant `ai_agents` table; tool execution remains on tenant stores until a later unification.
- Intelligence, Digital You, and channel agents (`#local`, `#general`, …) appear under **Agents**. Channel-agent rows open DMs, not the public lobby.

See [[chat-panel]].
