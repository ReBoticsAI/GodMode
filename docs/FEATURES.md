# GodMode features

Complete reference for the personal OS shipped in core. **Intelligence** is the built-in platform agent; the **Chat panel** is where you talk to agents.

Canonical per-feature pages (marketing site and platform wiki seed):

## Hubs

- [GodMode overview](features/godmode-overview.md) - What GodMode is, and how Intelligence relates to the personal OS.
- [Workspace structure](features/workspace-structure.md) - Departments, divisions, and pages. New workspaces start empty.
- [Shared and Marketplace](features/shared-and-marketplace.md) - Live grants and the pack marketplace at a glance.
- [Personal tools](features/personal-tools.md) - Calendar, Tasks, Wiki, Vault, Bank, Notifications, Support.

## Platform and agents

- [Admin Updates](features/admin-updates.md) - Stable/nightly channels, signed release checks, defer/skip, host-supervisor apply.
- [Home hub](features/home-hub.md) - Welcome dashboard with quick links to Calendar, Tasks, Wiki, Vault, Shared, and Marketplace.
- [Intelligence](features/intelligence.md) - Platform-wide companion for setup, structure, wiki, and cross-cutting work.
- [Digital You](features/digital-you.md) - Persona agent created on first login for tone, preferences, and personal context.
- [Chat panel](features/chat-panel.md) - Floating window for agent chat, history, model picker, tools, and in-panel tabs.
- [Model picker](features/model-picker.md) - Unified catalog: local GGUFs, Cursor subscription, cloud providers, and shared endpoints.
- [Model harness profiles](features/model-harness-profiles.md) - Per-family tool mode, sampling, and discovery middleware.
- [Cursor Cloud](features/cursor-cloud.md) - Run Intelligence on your Cursor plan with GodMode tools.
- [Agents](features/agents.md) - Org chart with Intelligence and Digital You at the root; Pipeline configures each agent.
- [DMs and channels](features/dms-and-channels.md) - Direct messages and group conversations with users and agents.

## Knowledge and memory

- [Rules](features/rules.md) - Behavior constraints attached to the active agent.
- [Skills](features/skills.md) - Reusable workflows or playbooks the agent can invoke.
- [Memory](features/memory.md) - Semantic facts (global or chat-scoped); hybrid RAG when embeddings are enabled.
- [Artifacts](features/artifacts.md) - Generated outputs linked to agent work.
- [Reflection](features/reflection.md) - Queued knowledge proposals and RAG maintenance for review before merge.
- [Tools](features/tools.md) - Platform tools allowlisted for the active agent.

## Productivity

- [Structure](features/structure.md) - Tree editor for departments, divisions, and pages.
- [Wiki](features/wiki.md) - Markdown knowledge base with spaces, visibility, backlinks, and RAG.
- [Tasks](features/tasks.md) - Multiple personal kanban boards; optional GitHub Project sync; tag a card auto for autonomous agent work.
- [Automations](features/automations.md) - Same kanban board in Chat; auto tags drive the autonomous runner.
- [Calendar](features/calendar.md) - Personal events and activity feed; agents have Chat calendar tabs too.
- [Notifications](features/notifications.md) - Platform alerts, including signed-release availability.
- [Vault](features/vault.md) - Secrets, API keys, and Cursor subscription connect.
- [Bank](features/bank.md) - Connect wallets and accounts for you and your agents.
- [Support](features/support.md) - Platform bugs via GitHub; shared resource issues to owners; optional Support group.

## Social and extension

- [Contacts](features/contacts.md) - Social graph for people, groups, and relationships.
- [Shared](features/shared.md) - Live resources another user granted you; federation tooling.
- [Settings](features/settings.md) - Account, appearance, and session settings.
- [Marketplace](features/marketplace.md) - Official, Local, Community, Installed, and Sell tabs with real checkout.
- [Intelligence plugin pipeline](features/plugin-pipeline.md) - scaffold_plugin → build_plugin → install_plugin for local and hub authoring.
- [Git and GitHub plugins](features/git-github-plugins.md) - Structured git_* and gh_* tools for commit, PR, and CI when host tools exist.
- [Connector](features/connector.md) - Optional local process for hardware-bound marketplace plugins.
- [Desktop](features/desktop.md) - Electron shell and installers that embed Bridge and web for local use.
- [ObjectType Records](features/objecttype-records.md) - Metadata-driven list/form pages and declared actions for core and plugins.

## Chat modes and commands

- [Agent mode](features/agent-mode.md) - Default mode: Intelligence runs tools and mutates workspace state.
- [Plan mode](features/plan-mode.md) - Structured planning; confirms before destructive tool calls.
- [Ask mode](features/ask-mode.md) - Read-only Q&A without tool side effects.
- [Slash commands](features/slash-commands.md) - Type / for /help, /clear, and custom commands from Settings.

Architecture notes remain in the longer engineering docs: [OBJECTTYPE_KERNEL.md](OBJECTTYPE_KERNEL.md), [architecture.md](architecture.md), [MARKETPLACE.md](MARKETPLACE.md).
