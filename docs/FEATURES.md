# GodMode features

Complete reference for the personal OS shipped in core. **Intelligence** is the built-in platform agent; the **Chat panel** (sidebar) is where you talk to Intelligence, Digital You, department agents, and DMs.

## Platform and agents

| Feature | Route / location | Description |
|---------|------------------|-------------|
| **Home hub** | `/home` | Welcome dashboard with quick links to Calendar, Tasks, Wiki, Vault, Shared, and Marketplace. |
| **Intelligence** | Chat panel → agent picker | Platform-wide companion for setup, structure, wiki, and cross-cutting work. Uses platform tools to create pages, agents, tasks, and more from chat. |
| **Digital You** | Sidebar → Digital *name* | Persona agent created on first login  -  tone, preferences, and personal context. Distinct from Intelligence and department subagents. |
| **Chat panel** | Sidebar → Chat | Floating window: agent chat, history, model picker, tool execution, and in-panel tabs (Knowledge, Vault, Bank, Support, …). |
| **Agents** | `/agents` | Org chart with **Intelligence** and **Digital You** at the root; department subagents below. **Pipeline** configures models, tools, rules, and profiles per agent. |
| **DMs and channels** | Chat panel → DMs / Channels | Direct messages and group conversations with users and agents. |

## Knowledge and memory (Chat → Knowledge)

| Tab | Description |
|-----|-------------|
| **Rules** | Behavior constraints attached to the active agent. |
| **Skills** | Reusable workflows the agent can invoke. |
| **Memory** | Saved facts and context (global or chat-scoped). |
| **Artifacts** | Generated outputs linked to agent work. |
| **Reflection** | Queued knowledge proposals and RAG maintenance  -  review before merging into long-term memory. |
| **Tools** | Platform tools allowlisted for the active agent. |

## Productivity

| Feature | Route / location | Description |
|---------|------------------|-------------|
| **Structure** | `/structure` | Tree editor: departments → divisions → pages. New workspaces start empty; Intelligence or Structure creates content. |
| **Wiki** | `/wiki` | Markdown knowledge base with spaces, internal/external visibility, and backlinks. |
| **Tasks** | `/tasks` | Kanban boards with columns, priorities, subtasks, and comments. Tag a card `auto` to queue autonomous agent work. |
| **Automations** | Chat panel → Automations tab | Same kanban board in the Chat window; tag `auto` for the autonomous runner. |
| **Calendar** | `/calendar` | Personal events and activity feed. Also available in Chat → Calendar tab. |
| **Notifications** | `/notifications` | Platform alerts. Also in Chat → Notifications tab. |
| **Vault** | `/vault` | Secrets and API keys for LLM providers and integrations. Chat → Vault tab for quick access while chatting. |
| **Bank** | `/bank` | Connect wallets and accounts for you and your agents to track balances. Chat → Bank tab. |
| **Support** | `/support` | Platform bugs via GitHub; shared resource issues to resource owners. Chat → Support tab. |

## Social and extension

| Feature | Route / location | Description |
|---------|------------------|-------------|
| **Contacts** | `/contacts` | Social graph — people, groups, and relationship view. |
| **Shared** | Sidebar → Shared | Live resources another user granted you; Tailscale network panel for cross-home federation. |
| **Settings** | `/settings` | Account, workspace, plugins, AI configuration, and slash commands. |
| **Marketplace** | `/marketplace` | Official and Unofficial catalog tabs; free install of packs and plugins. See [MARKETPLACE.md](MARKETPLACE.md). |
| **Marketplace** | `/marketplace` | Install and manage plugin packs (Official, Unofficial, Installed). |
| **Connector** | `apps/connector` | Optional local process for hardware-bound marketplace plugins (desktop apps, devices). |

## Chat modes and commands

| Mode / feature | Description |
|----------------|-------------|
| **Agent** | Default — Intelligence runs tools and mutates workspace state. |
| **Plan** | Structured planning; confirms before destructive tool calls. |
| **Ask** | Read-only Q&A without tool side effects. |
| **Slash commands** | Type `/` in the composer — `/help`, `/clear`, and custom commands from **Settings → Commands**. |

## Architecture notes

- **Local-first:** tenant data in SQLite on your machine (`core.sqlite` + per-tenant DB).
- **Multi-agent org:** scoped permissions, tool allowlists, and structure-linked agents.
- **Workspace growth:** Intelligence can create departments, wiki pages, tasks, and automations from chat.
- **Plugins:** optional domain packs register bridge routes, web pages, and install hooks without forking core.

See [architecture.md](architecture.md), [VERIFICATION.md](VERIFICATION.md), [MARKETPLACE.md](MARKETPLACE.md), [SHARED_FEDERATION.md](SHARED_FEDERATION.md), [ONBOARDING.md](ONBOARDING.md), and [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md).
