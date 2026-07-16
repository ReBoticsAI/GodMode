# GodMode features

Complete reference for the personal OS shipped in core. **Intelligence** is the built-in platform agent; the **Chat panel** (sidebar) is where you talk to Intelligence, Digital You, department agents, and DMs.

For what shipped since v0.1.0, see [CHANGELOG.md](../CHANGELOG.md). Contribution themes: [CONTRIBUTING.md](../CONTRIBUTING.md#what-we-are-looking-for-roadmap-themes).

## Platform and agents

| Feature | Route / location | Description |
|---------|------------------|-------------|
| **Admin → Updates** | `/settings/admin?tab=updates` | Channel selection (stable/nightly), signed release checks, defer/skip, and host-supervisor apply when installed. See [RELEASES.md](RELEASES.md). |
| **Home hub** | `/home` | Welcome dashboard with quick links to Calendar, Tasks, Wiki, Vault, Shared, and Marketplace. |
| **Intelligence** | Chat panel → agent picker | Platform-wide companion for setup, structure, wiki, and cross-cutting work. Uses platform tools to create pages, agents, tasks, and more from chat. |
| **Digital You** | Sidebar → Digital *name* | Persona agent created on first login  -  tone, preferences, and personal context. Distinct from Intelligence and department subagents. |
| **Chat panel** | Sidebar → Chat | Floating window: agent chat, history, model picker, tool execution, and in-panel tabs (Knowledge, Vault, Bank, Support, …). |
| **Model picker** | Chat composer | Unified catalog: local GGUFs, Cursor subscription, cloud providers, and shared/remote endpoints. Embedding-only GGUFs are excluded. |
| **Model harness profiles** | Applied on model select | Per-family tool mode, sampling, and discovery middleware (e.g. Gemma 4, Cursor Auto / Composer / Grok). See [LOCAL_LLM.md](LOCAL_LLM.md). |
| **Cursor Cloud** | Vault → Cursor subscription | Run Intelligence on your Cursor plan (`cursor_cloud`) with GodMode tools. See [CURSOR_SUBSCRIPTION.md](CURSOR_SUBSCRIPTION.md). |
| **Agents** | `/agents` | Org chart with **Intelligence** and **Digital You** at the root; department subagents below. **Pipeline** configures models, tools, rules, and profiles per agent. |
| **DMs and channels** | Chat panel → DMs / Channels | Direct messages and group conversations with users and agents. |

## Knowledge and memory (Chat → Knowledge)

| Tab | Description |
|-----|-------------|
| **Rules** | Behavior constraints attached to the active agent. |
| **Skills** | Reusable workflows / playbooks the agent can invoke (quality-gated on create). |
| **Memory** | Semantic facts (global or chat-scoped); hybrid RAG when embeddings are enabled. |
| **Artifacts** | Generated outputs linked to agent work. |
| **Reflection** | Queued knowledge proposals and RAG maintenance  -  review before merging into long-term memory. |
| **Tools** | Platform tools allowlisted for the active agent. |

Longer architecture (working / semantic / episodic / procedural + wiki RAG): [AGENT_MEMORY.md](AGENT_MEMORY.md).

## Productivity

| Feature | Route / location | Description |
|---------|------------------|-------------|
| **Structure** | `/structure` | Tree editor: departments → divisions → pages. New workspaces start empty; Intelligence or Structure creates content. |
| **Wiki** | `/wiki` | Markdown knowledge base with spaces, internal/external visibility, and backlinks; hybrid wiki snippets can inject into chat. |
| **Tasks** | `/tasks` | Kanban boards with columns, priorities, subtasks, and comments. Tag a card `auto` to queue autonomous agent work. |
| **Automations** | Chat panel → Automations tab | Same kanban board in the Chat window; tag `auto` for the autonomous runner. |
| **Calendar** | `/calendar` | Personal events and activity feed. Also available in Chat → Calendar tab. |
| **Notifications** | `/notifications` | Platform alerts, including deduplicated signed-release availability. Also in Chat → Notifications tab. |
| **Vault** | `/vault` | Secrets, API keys, and Cursor subscription connect. Chat → Vault tab for quick access while chatting. |
| **Bank** | `/bank` | Connect wallets and accounts for you and your agents to track balances. Chat → Bank tab. |
| **Support** | `/support` | Platform bugs via GitHub; shared resource issues to resource owners. Hub **Support group** staffing (Admin) lets users and agents answer tickets. Chat → Support tab. |

## Social and extension

| Feature | Route / location | Description |
|---------|------------------|-------------|
| **Contacts** | `/contacts` | Social graph — people, groups, and relationship view. |
| **Shared** | Sidebar → Shared | Live resources another user granted you; Tailscale network panel for cross-home federation. |
| **Settings** | `/settings` | Account, appearance, and session settings. |
| **Marketplace** | `/marketplace` | Official, Unofficial, and Installed tabs; free install of packs and plugins. See [MARKETPLACE.md](MARKETPLACE.md). |
| **Intelligence plugin pipeline** | Chat tools | `scaffold_plugin` → `build_plugin` → `install_plugin` for local/hub authoring. See [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md). |
| **Git / GitHub plugins** | Marketplace → Official | Structured `git_*` / `gh_*` tools for commit→PR→CI (requires host `git`/`gh`). See [MARKETPLACE.md](MARKETPLACE.md#official-devtools-plugins-git--github). |
| **Connector** | `apps/connector` | Optional local process for hardware-bound marketplace plugins (desktop apps, devices). |
| **Desktop** | `apps/desktop` | Electron shell + installers that embed Bridge + web for local personal use. |
| **ObjectType Records** | `/records/:objectType` | Metadata-driven list/form pages and declared actions for core and installed-plugin domains. |

## Chat modes and commands

| Mode / feature | Description |
|----------------|-------------|
| **Agent** | Default — Intelligence runs tools and mutates workspace state. |
| **Plan** | Structured planning; confirms before destructive tool calls. |
| **Ask** | Read-only Q&A without tool side effects. |
| **Slash commands** | Type `/` in the composer — `/help`, `/clear`, and custom commands from **Settings → Commands**. |

## Architecture notes

- **Local-first:** tenant data in SQLite on your machine (`core.sqlite` + per-tenant DB).
- **LLM backends:** local llama.cpp (spawned or `LLAMA_EXTERNAL` attach), Cursor Cloud, or provider keys in Vault.
- **Multi-agent org:** scoped permissions, tool allowlists, and structure-linked agents.
- **Workspace growth:** Intelligence can create departments, wiki pages, tasks, and automations from chat.
- **ObjectType kernel:** authenticated web, agent, plugin, and HTTP consumers
  discover explicit Record CRUD and named actions across 74 audited ObjectTypes;
  exact-parity adapters preserve domain services and side effects behind the
  single durable mutation boundary.
- **Durable execution:** asynchronous actions enforce retries/backoff, timeout,
  declared cancellation, scoped idempotency, leases, and replay-safe recovery;
  declared events retain per-consumer receipts.
- **Plugins:** optional domain packs register ObjectTypes, actions, bridge routes,
  web pages, and install hooks without forking core through a versioned kernel
  client.
- **Completed cutover:** strict audits report zero legacy routes/callers,
  unmatched callers, and direct entry-point writes. WebSocket/token streams,
  binary transfer, ephemeral presence, and other reviewed wire-level exceptions
  remain specialized rather than being mislabeled as Record CRUD.
- **Cross-database safety:** plugin/acquisition sagas resume idempotently across
  core and tenant SQLite files, while shared-resource adapters enforce the exact
  grant and owner database.
- **Generic structure pages:** `StructureNode.object_type` selects the Record
  renderer; `segment` remains the URL component.

See [OBJECTTYPE_KERNEL.md](OBJECTTYPE_KERNEL.md), [architecture.md](architecture.md), [VERIFICATION.md](VERIFICATION.md), [MARKETPLACE.md](MARKETPLACE.md), [SHARED_FEDERATION.md](SHARED_FEDERATION.md), [ONBOARDING.md](ONBOARDING.md), [AGENT_MEMORY.md](AGENT_MEMORY.md), and [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md).
