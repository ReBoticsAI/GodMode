/**
 * One-shot generator for docs/features/*.md content.
 * Run: node scripts/features/generate-feature-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "docs/features");
fs.mkdirSync(outDir, { recursive: true });

const SECTION_ORDER = [
  "Hubs",
  "Platform and agents",
  "Knowledge and memory",
  "Productivity",
  "Social and extension",
  "Chat modes and commands",
];

/** @type {Array<{slug:string,title:string,section:string,location:string,summary:string,body:string}>} */
const pages = [
  {
    slug: "_index",
    title: "Features",
    section: "Hubs",
    location: "Marketing /www/features and Wiki space platform",
    summary: "Catalog of built-in GodMode features. Same pages seed the platform wiki for agents.",
    body: `# Features

GodMode is a local-first personal OS. These pages describe every built-in feature.

Intelligence and other agents should read pages in the **platform** wiki space (seeded from this catalog) when answering product questions.

## How to use this catalog

- Open a feature page for route, behavior, and agent notes.
- Related hubs: [[godmode-overview]], [[workspace-structure]], [[personal-tools]], [[shared-and-marketplace]].

## Sections

- Platform and agents
- Knowledge and memory
- Productivity
- Social and extension
- Chat modes and commands
`,
  },
  {
    slug: "godmode-overview",
    title: "GodMode overview",
    section: "Hubs",
    location: "Platform wiki",
    summary: "What GodMode is, and how Intelligence relates to the personal OS.",
    body: `# GodMode overview

**GodMode** is the platform: your personal operating system for work, life areas, and automations.

**Intelligence** is GodMode's built-in AI assistant (the robot in the sidebar). It is not the platform name.

## Key pieces

- **Digital You**: your persona agent (created on first login)
- **Departments / divisions / pages**: how workspace navigation is organized (you start with an empty tree)
- **Agents**: specialized AIs for departments or tasks
- **Wiki**: this knowledge base (Intelligence can read and update it)
- **Shared**: live resources someone else granted you
- **Marketplace**: install and sell published packs

Intelligence can create departments, pages, agents, wiki articles, tasks, and more **directly from chat** using platform tools. You do not have to click through every screen yourself.

See also: [[intelligence]], [[digital-you]], [[structure]], [[marketplace]].
`,
  },
  {
    slug: "workspace-structure",
    title: "Workspace structure",
    section: "Hubs",
    location: "/structure",
    summary: "Departments, divisions, and pages. New workspaces start empty.",
    body: `# Workspace structure

GodMode organizes work in a tree:

1. **Department**: top-level area (for example Work, Life, or a client project)
2. **Division**: group inside a department
3. **Page**: a screen in the sidebar

New workspaces start with **no departments**. Ask Intelligence to create your first department and pages, or use **Structure** once you have content to rearrange.

Personal items (Calendar, Tasks, Bank, Vault, Wiki) live outside the department tree in the sidebar.

See [[structure]] for the Structure editor details.
`,
  },
  {
    slug: "shared-and-marketplace",
    title: "Shared and Marketplace",
    section: "Hubs",
    location: "Sidebar → Shared; /marketplace",
    summary: "Live grants and the pack marketplace at a glance.",
    body: `# Shared and Marketplace

## Shared

When another GodMode user **shares** a resource with you, it appears under **Shared** in your sidebar. You get live access according to the grant, not a static copy.

See [[shared]].

## Marketplace

The **Marketplace** lists published packs you can install: integrations, agent templates, workflow packs, and more. Community listings support user-to-user checkout (sellers keep 90%).

See [[marketplace]] and [[plugin-pipeline]].
`,
  },
  {
    slug: "personal-tools",
    title: "Personal tools",
    section: "Hubs",
    location: "Sidebar personal pages",
    summary: "Calendar, Tasks, Wiki, Vault, Bank, Notifications, Support.",
    body: `# Personal tools

Every workspace includes these sidebar pages:

- **Calendar**: events and schedules ([[calendar]])
- **Tasks**: Kanban boards; tag tasks \`auto\` for autonomous work ([[tasks]])
- **Wiki**: markdown knowledge base ([[wiki]])
- **Vault**: secrets and API keys ([[vault]])
- **Bank**: holdings and financial tracking ([[bank]])
- **Notifications**: platform alerts ([[notifications]])
- **Support**: submit and track help requests ([[support]])

Add API keys in **Vault → Secrets**, then point Intelligence at a cloud provider under **Agents → Pipeline → Backend** if you are not using a local model.
`,
  },

  // Platform and agents
  {
    slug: "admin-updates",
    title: "Admin Updates",
    section: "Platform and agents",
    location: "/settings/admin?tab=updates",
    summary: "Stable/nightly channels, signed release checks, defer/skip, host-supervisor apply.",
    body: `# Admin Updates

Admins choose a release channel (stable or nightly), review signed release availability, and defer or skip updates. When a host supervisor is installed, apply can restart services into the new package.

## Route

\`/settings/admin?tab=updates\`

## Agent notes

- Prefer reading release notifications from the platform alerts surface.
- Do not claim an update applied unless the host supervisor status confirms it.
`,
  },
  {
    slug: "home-hub",
    title: "Home hub",
    section: "Platform and agents",
    location: "/home",
    summary: "Welcome dashboard with quick links to Calendar, Tasks, Wiki, Vault, Shared, and Marketplace.",
    body: `# Home hub

The Home hub is the landing dashboard after login. It surfaces quick links into personal tools and Marketplace.

## Route

\`/home\`

## Agent notes

Use Home as a friendly orientation target for new users before diving into Structure or Agents.
`,
  },
  {
    slug: "intelligence",
    title: "Intelligence",
    section: "Platform and agents",
    location: "Chat panel → agent picker",
    summary: "Platform-wide companion for setup, structure, wiki, and cross-cutting work.",
    body: `# Intelligence

Intelligence is the built-in platform agent. It uses platform tools to create pages, agents, tasks, wiki articles, and more from chat.

## Where to open

Chat panel → agent picker → **Intelligence**

## What it is not

Intelligence is not the product name. GodMode is the OS; Intelligence is the guide agent.

## Agent notes

- Prefer Intelligence for cross-cutting platform work.
- Use Digital You for persona and personal preference context ([[digital-you]]).
- Department agents own scoped structure nodes ([[agents]]).
`,
  },
  {
    slug: "digital-you",
    title: "Digital You",
    section: "Platform and agents",
    location: "Sidebar → Digital name",
    summary: "Persona agent created on first login for tone, preferences, and personal context.",
    body: `# Digital You

Digital You is your persona agent, created on first login. It holds tone, preferences, and personal context. It is distinct from Intelligence and from department subagents.

## Where to open

Sidebar → **Digital** (your display name)

## Agent notes

Do not conflate Digital You with Intelligence. Route personal preference questions here; route platform setup to Intelligence.
`,
  },
  {
    slug: "chat-panel",
    title: "Chat panel",
    section: "Platform and agents",
    location: "Sidebar → Chat",
    summary: "Floating window for agent chat, history, model picker, tools, and in-panel tabs.",
    body: `# Chat panel

The Chat panel is the floating window where you talk to agents. It is not an agent's name.

## Capabilities

- Agent chat and history
- Model picker
- Tool execution
- In-panel tabs (Knowledge, Vault, Bank, Support, and more)
- DMs and channels ([[dms-and-channels]])

## Modes

See [[agent-mode]], [[plan-mode]], and [[ask-mode]].
`,
  },
  {
    slug: "model-picker",
    title: "Model picker",
    section: "Platform and agents",
    location: "Chat composer",
    summary: "Unified catalog: local GGUFs, Cursor subscription, cloud providers, and shared endpoints.",
    body: `# Model picker

The composer model picker lists local GGUFs, Cursor subscription models, cloud providers, and shared/remote endpoints. Embedding-only GGUFs are excluded.

## Agent notes

Respect the user's selected model. Do not assume a cloud provider is configured without Vault credentials.
`,
  },
  {
    slug: "model-harness-profiles",
    title: "Model harness profiles",
    section: "Platform and agents",
    location: "Applied on model select",
    summary: "Per-family tool mode, sampling, and discovery middleware.",
    body: `# Model harness profiles

When you select a model, GodMode applies a harness profile for that family (tool mode, sampling, discovery middleware). Examples include Gemma 4 and Cursor Auto / Composer / Grok families.

See LOCAL_LLM docs in the repository for deeper engineering notes.
`,
  },
  {
    slug: "cursor-cloud",
    title: "Cursor Cloud",
    section: "Platform and agents",
    location: "Vault → Cursor subscription",
    summary: "Run Intelligence on your Cursor plan with GodMode tools.",
    body: `# Cursor Cloud

Connect a Cursor subscription in Vault, then run Intelligence (\`cursor_cloud\`) with GodMode tools on that plan.

## Route

Vault → Cursor subscription

See [[vault]].
`,
  },
  {
    slug: "agents",
    title: "Agents",
    section: "Platform and agents",
    location: "/agents",
    summary: "Org chart with Intelligence and Digital You at the root; Pipeline configures each agent.",
    body: `# Agents

| Agent | Role |
|-------|------|
| **Intelligence** | Platform-wide companion |
| **Digital You** | Persona and personal context |
| **Department agents** | Own a division or page |
| **Custom agents** | Workflow or domain specific |

## Route

\`/agents\`

Configure models, tools, rules, and profiles under **Agents → Pipeline**.

Attach an agent to a structure node so opening that page can auto-open the right chat.
`,
  },
  {
    slug: "dms-and-channels",
    title: "DMs and channels",
    section: "Platform and agents",
    location: "Chat panel → DMs / Channels",
    summary: "Direct messages and group conversations with users and agents.",
    body: `# DMs and channels

Use the Chat panel DMs and Channels sections for direct and group conversations involving users and agents.

See [[chat-panel]].
`,
  },

  // Knowledge
  {
    slug: "rules",
    title: "Rules",
    section: "Knowledge and memory",
    location: "Chat → Knowledge → Rules",
    summary: "Behavior constraints attached to the active agent.",
    body: `# Rules

Rules are behavior constraints attached to the active agent. They shape how the agent responds and which actions it prefers.
`,
  },
  {
    slug: "skills",
    title: "Skills",
    section: "Knowledge and memory",
    location: "Chat → Knowledge → Skills",
    summary: "Reusable workflows or playbooks the agent can invoke.",
    body: `# Skills

Skills are reusable workflows or playbooks. Quality gates apply on create so low-quality skills do not silently ship.
`,
  },
  {
    slug: "memory",
    title: "Memory",
    section: "Knowledge and memory",
    location: "Chat → Knowledge → Memory",
    summary: "Semantic facts (global or chat-scoped); hybrid RAG when embeddings are enabled.",
    body: `# Memory

Memory stores semantic facts (global or chat-scoped). When embeddings are enabled, hybrid RAG can inject relevant memory into chat.
`,
  },
  {
    slug: "artifacts",
    title: "Artifacts",
    section: "Knowledge and memory",
    location: "Chat → Knowledge → Artifacts",
    summary: "Generated outputs linked to agent work.",
    body: `# Artifacts

Artifacts are generated outputs linked to agent work (documents, drafts, structured results).
`,
  },
  {
    slug: "reflection",
    title: "Reflection",
    section: "Knowledge and memory",
    location: "Chat → Knowledge → Reflection",
    summary: "Queued knowledge proposals and RAG maintenance for review before merge.",
    body: `# Reflection

Reflection queues knowledge proposals and RAG maintenance. Review before merging into long-term memory.
`,
  },
  {
    slug: "tools",
    title: "Tools",
    section: "Knowledge and memory",
    location: "Chat → Knowledge → Tools",
    summary: "Platform tools allowlisted for the active agent.",
    body: `# Tools

The Tools tab shows platform tools allowlisted for the active agent. Pipeline and policy decide what each agent may call.
`,
  },

  // Productivity
  {
    slug: "structure",
    title: "Structure",
    section: "Productivity",
    location: "/structure",
    summary: "Tree editor for departments, divisions, and pages.",
    body: `# Structure

Structure is the tree editor for departments → divisions → pages. New workspaces start empty; Intelligence or Structure creates content.

## Route

\`/structure\`

See also [[workspace-structure]] and [[objecttype-records]] for page types driven by ObjectTypes.
`,
  },
  {
    slug: "wiki",
    title: "Wiki",
    section: "Productivity",
    location: "/wiki",
    summary: "Markdown knowledge base with spaces, visibility, backlinks, and RAG.",
    body: `# Wiki

Wiki is the markdown knowledge base with spaces, internal/external visibility, and backlinks. Hybrid wiki snippets can inject into chat when RAG is enabled.

Platform product docs live in the **platform** space and are seeded from this feature catalog so agents share the same truth as the marketing site.
`,
  },
  {
    slug: "tasks",
    title: "Tasks",
    section: "Productivity",
    location: "/tasks",
    summary: "Kanban boards; tag a card auto for autonomous agent work.",
    body: `# Tasks

Tasks are Kanban boards with columns, priorities, subtasks, and comments. Tag a card \`auto\` to queue autonomous agent work.

## Route

\`/tasks\`

The Automations tab in Chat shows the same board ([[automations]]).
`,
  },
  {
    slug: "automations",
    title: "Automations",
    section: "Productivity",
    location: "Chat panel → Automations tab",
    summary: "Same kanban board in Chat; auto tags drive the autonomous runner.",
    body: `# Automations

Automations use the same kanban board as Tasks, surfaced inside the Chat panel. Tag \`auto\` for the autonomous runner.

See [[tasks]].
`,
  },
  {
    slug: "calendar",
    title: "Calendar",
    section: "Productivity",
    location: "/calendar",
    summary: "Personal events and activity feed; agents have Chat calendar tabs too.",
    body: `# Calendar

Calendar covers personal events and an activity feed. Agents also get their own calendar workspace in Chat → Calendar.

## Route

\`/calendar\`
`,
  },
  {
    slug: "notifications",
    title: "Notifications",
    section: "Productivity",
    location: "/notifications",
    summary: "Platform alerts, including signed-release availability.",
    body: `# Notifications

Notifications list platform alerts, including deduplicated signed-release availability. Also available as a Chat → Notifications tab.

## Route

\`/notifications\`
`,
  },
  {
    slug: "vault",
    title: "Vault",
    section: "Productivity",
    location: "/vault",
    summary: "Secrets, API keys, and Cursor subscription connect.",
    body: `# Vault

Vault stores secrets, API keys, and Cursor subscription connection. Chat → Vault tab gives quick access while chatting.

## Route

\`/vault\`

See [[cursor-cloud]].
`,
  },
  {
    slug: "bank",
    title: "Bank",
    section: "Productivity",
    location: "/bank",
    summary: "Connect wallets and accounts for you and your agents.",
    body: `# Bank

Bank connects wallets and accounts for you and your agents to track balances. Also available as Chat → Bank.

## Route

\`/bank\`
`,
  },
  {
    slug: "support",
    title: "Support",
    section: "Productivity",
    location: "/support",
    summary: "Platform bugs via GitHub; shared resource issues to owners; optional Support group.",
    body: `# Support

Support handles platform bugs via GitHub and shared-resource issues to resource owners. Hub Support group staffing (Admin) lets users and agents answer tickets. Also as Chat → Support.

## Route

\`/support\`
`,
  },

  // Social and extension
  {
    slug: "contacts",
    title: "Contacts",
    section: "Social and extension",
    location: "/contacts",
    summary: "Social graph for people, groups, and relationships.",
    body: `# Contacts

Contacts is the social graph for people, groups, and relationship views.

## Route

\`/contacts\`
`,
  },
  {
    slug: "shared",
    title: "Shared",
    section: "Social and extension",
    location: "Sidebar → Shared",
    summary: "Live resources another user granted you; federation tooling.",
    body: `# Shared

Shared shows live resources another user granted you. Grants are live access, not a static copy. Federation tooling (including Tailscale network panel) supports cross-home collaboration.

See [[shared-and-marketplace]].
`,
  },
  {
    slug: "settings",
    title: "Settings",
    section: "Social and extension",
    location: "/settings",
    summary: "Account, appearance, and session settings.",
    body: `# Settings

Settings covers account, appearance, and session preferences.

## Route

\`/settings\`

Admin surfaces (including Updates) live under admin settings for privileged users ([[admin-updates]]).
`,
  },
  {
    slug: "marketplace",
    title: "Marketplace",
    section: "Social and extension",
    location: "/marketplace",
    summary: "Official, Local, Community, Installed, and Sell tabs with real checkout.",
    body: `# Marketplace

Marketplace installs packs and plugins from catalogs. On GodMode Cloud it supports paid Official items and user-to-user Community listings with real-money checkout.

## Tabs

| Tab | Role |
|-----|------|
| Official | Curated ReBotics catalog (free + paid). Paid revenue is 100% to the platform. |
| Local | Local plugin folders and third-party indexes (typically free). |
| Community | User listings. Sellers keep 90%; platform takes 10%. |
| Installed | Workspace plugins and install history. |
| Sell | Accept ToS, connect payouts, publish and manage listings. |

## Product rules

- No credits. Purchases are USD (or crypto) via Stripe, PayPal, or MetaMask-compatible checkout.
- SaaS is the commerce authority for paid checkout.
- Chargebacks lead to a permanent Marketplace ban.

## Route

\`/marketplace\`

See [[plugin-pipeline]] and [[git-github-plugins]].
`,
  },
  {
    slug: "plugin-pipeline",
    title: "Intelligence plugin pipeline",
    section: "Social and extension",
    location: "Chat tools",
    summary: "scaffold_plugin → build_plugin → install_plugin for local and hub authoring.",
    body: `# Intelligence plugin pipeline

Intelligence can author plugins through \`scaffold_plugin\` → \`build_plugin\` → \`install_plugin\` for local or hub authoring. Domain packs register ObjectTypes, actions, bridge routes, web pages, and install hooks without forking core.

See PLUGIN_AUTHORING docs in the repository and [[objecttype-records]].
`,
  },
  {
    slug: "git-github-plugins",
    title: "Git and GitHub plugins",
    section: "Social and extension",
    location: "Marketplace → Official",
    summary: "Structured git_* and gh_* tools for commit, PR, and CI when host tools exist.",
    body: `# Git and GitHub plugins

Official Marketplace packs can expose structured \`git_*\` and \`gh_*\` tools for commit → PR → CI flows. They require host \`git\` / \`gh\` availability.

See [[marketplace]].
`,
  },
  {
    slug: "connector",
    title: "Connector",
    section: "Social and extension",
    location: "apps/connector",
    summary: "Optional local process for hardware-bound marketplace plugins.",
    body: `# Connector

Connector is an optional local process for hardware-bound marketplace plugins (desktop apps, devices).
`,
  },
  {
    slug: "desktop",
    title: "Desktop",
    section: "Social and extension",
    location: "apps/desktop",
    summary: "Electron shell and installers that embed Bridge and web for local use.",
    body: `# Desktop

Desktop is the Electron shell plus installers that embed Bridge and the web UI for local personal use.
`,
  },
  {
    slug: "objecttype-records",
    title: "ObjectType Records",
    section: "Social and extension",
    location: "/records/:objectType",
    summary: "Metadata-driven list/form pages and declared actions for core and plugins.",
    body: `# ObjectType Records

ObjectType Records are metadata-driven list and form pages with declared actions for core and installed-plugin domains. Plugins extend GodMode by registering ObjectTypes against the kernel instead of forking core.

## Route

\`/records/:objectType\`

Structure pages can also bind a \`StructureNode.object_type\` to the Record renderer.
`,
  },

  // Chat modes
  {
    slug: "agent-mode",
    title: "Agent mode",
    section: "Chat modes and commands",
    location: "Chat composer mode",
    summary: "Default mode: Intelligence runs tools and mutates workspace state.",
    body: `# Agent mode

Agent is the default Chat mode. Intelligence (or the selected agent) runs tools and may mutate workspace state.
`,
  },
  {
    slug: "plan-mode",
    title: "Plan mode",
    section: "Chat modes and commands",
    location: "Chat composer mode",
    summary: "Structured planning; confirms before destructive tool calls.",
    body: `# Plan mode

Plan mode is structured planning. The agent confirms before destructive tool calls.
`,
  },
  {
    slug: "ask-mode",
    title: "Ask mode",
    section: "Chat modes and commands",
    location: "Chat composer mode",
    summary: "Read-only Q&A without tool side effects.",
    body: `# Ask mode

Ask mode is read-only Q&A without tool side effects.
`,
  },
  {
    slug: "slash-commands",
    title: "Slash commands",
    section: "Chat modes and commands",
    location: "Chat composer",
    summary: "Type / for /help, /clear, and custom commands from Settings.",
    body: `# Slash commands

Type \`/\` in the composer for \`/help\`, \`/clear\`, and custom commands from **Settings → Commands**.
`,
  },
];

function serialize(page) {
  return [
    "---",
    `slug: ${page.slug}`,
    `title: ${JSON.stringify(page.title)}`,
    `section: ${JSON.stringify(page.section)}`,
    `location: ${JSON.stringify(page.location)}`,
    `summary: ${JSON.stringify(page.summary)}`,
    "---",
    "",
    page.body.trim() + "\n",
  ].join("\n");
}

for (const page of pages) {
  const file = path.join(outDir, `${page.slug}.md`);
  fs.writeFileSync(file, serialize(page), "utf8");
}

const toc = [
  "# GodMode features",
  "",
  "Complete reference for the personal OS shipped in core. **Intelligence** is the built-in platform agent; the **Chat panel** is where you talk to agents.",
  "",
  "Canonical per-feature pages (marketing site and platform wiki seed):",
  "",
  ...SECTION_ORDER.flatMap((section) => {
    const rows = pages.filter((p) => p.section === section && p.slug !== "_index");
    if (!rows.length) return [];
    return [`## ${section}`, "", ...rows.map((p) => `- [${p.title}](features/${p.slug}.md) - ${p.summary}`), ""];
  }),
  "Architecture notes remain in the longer engineering docs: [OBJECTTYPE_KERNEL.md](OBJECTTYPE_KERNEL.md), [architecture.md](architecture.md), [MARKETPLACE.md](MARKETPLACE.md).",
  "",
].join("\n");

fs.writeFileSync(path.join(root, "docs/FEATURES.md"), toc, "utf8");
console.log(`Wrote ${pages.length} feature docs to ${outDir}`);
