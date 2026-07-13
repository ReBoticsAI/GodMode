# GodMode

[![CI](https://github.com/ReBoticsAI/GodMode/actions/workflows/ci.yml/badge.svg)](https://github.com/ReBoticsAI/GodMode/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/ReBoticsAI/GodMode?label=release)](https://github.com/ReBoticsAI/GodMode/releases/tag/v0.1.0)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/ReBoticsAI/GodMode/blob/main/LICENSE)

**Local-first personal OS** with built-in Intelligence, multi-agent org chart, wiki, tasks, calendar, vault, and automations. Run it on your PC  -  your data stays in SQLite on your machine.

![GodMode home hub](docs/assets/readme/hero-home.png)

> **Quick demo:** [docs/assets/readme/demo.gif](docs/assets/readme/demo.gif)

## Terminology

| Name | Meaning |
|------|---------|
| **Intelligence** | The built-in platform agent  -  your guide to GodMode itself |
| **Chat panel** | The sidebar floating window where you talk to agents (not the agent's name) |
| **Digital You** | Your persona agent, created on first login |
| **Agents → Pipeline** | Where you configure models, tools, rules, and profiles |

## Why GodMode?

Chat-only assistants forget context between sessions. GodMode gives you a **persistent workspace** — departments, pages, agents, memory, and tools — that Intelligence can read, write, and extend over time.

Unlike a single chat thread, GodMode is a **self-hosted personal OS**: structure tree, org chart of agents, built-in wiki, tasks, calendar, vault, and marketplace plugins — in one local SQLite stack.

See the [feature catalog](docs/FEATURES.md) for the full list.

## Features (overview)

### Platform and agents

- **Home** (`/home`)  -  dashboard and quick links
- **Intelligence**  -  platform companion; setup, structure, cross-cutting work
- **Digital You**  -  persona agent for tone and personal context
- **Chat panel**  -  talk to any agent; history, tools, model picker
- **Agents** (`/agents`)  -  org chart and Pipeline configuration

### Knowledge (Chat → Knowledge tab)

Rules, Skills, Memory, Artifacts, Reflection, and Tools  -  per active agent.

### Productivity

Structure, Wiki, Tasks (kanban + `auto` autonomous cards), Calendar, Notifications, Vault, Bank, and Support  -  in the sidebar and as Chat panel tabs.

### Social and extension

**Shared** (live grants from other users), **Marketplace** (install and manage plugin packs), optional **Connector** for hardware-bound plugins.

![Intelligence in Chat panel](docs/assets/readme/intelligence-chat.png)

## Architecture

### System overview

```mermaid
flowchart TB
  subgraph client [Your machine]
    Web[Web Dashboard React]
    Bridge[Bridge API Node.js]
    CoreDb[(core.sqlite users and tenants)]
    TenantDb[(tenant.sqlite per workspace)]
    Web -->|REST and WebSocket| Bridge
    Bridge --> CoreDb
    Bridge --> TenantDb
  end
  subgraph intelligence [Intelligence loop]
    User[You] --> Chat[Chat panel]
    Chat --> Tools[Platform tools]
    Tools --> Structure[Structure wiki tasks]
    Tools --> Memory[Memory and artifacts]
  end
  Web --> intelligence
```

### Chat panel tabs vs sidebar pages

```mermaid
flowchart LR
  Sidebar[Sidebar pages] --> HomePage[Home]
  Sidebar --> WikiPage[Wiki]
  Sidebar --> TasksPage[Tasks]
  Chat[Chat panel tabs] --> ChatTab[Chat]
  Chat --> Know[Knowledge]
  Chat --> VaultTab[Vault]
  Chat --> BankTab[Bank]
  Chat --> SupportTab[Support]
  Chat --> AutoTab[Automations]
```

### Agent organization

**Intelligence** is the platform root agent; department subagents report to it. **Digital You** is your separate persona agent (tone and personal context) — also a root in the database (`parent_id` is null), shown beside Intelligence in the org chart with no parent/child link between them.

```mermaid
flowchart TB
  subgraph roots [" "]
    direction LR
    Intel[Intelligence]
    DigitalYou[Digital You]
  end
  Intel --> DeptAgents[Department agents]
  DeptAgents --> PageAgents[Page-scoped agents]
  PageAgents --> Tools[Tools rules skills]
  Tools --> Platform[Wiki tasks calendar vault]
```

### Plugin extension (optional)

```mermaid
flowchart LR
  Core[GodMode core]
  PluginHost[Plugin host]
  Plugin[Domain plugin repo]
  Core --> PluginHost
  PluginHost -->|discover at runtime| Plugin
  Plugin -->|registers routes tools UI| Core
```

Core ships as a complete personal OS. Plugins add domain packs without forking the platform. See [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md).

## Quick start

**Requirements:** Node.js 20+, npm 10+

```powershell
git clone https://github.com/ReBoticsAI/GodMode.git
cd GodMode
npm install
copy apps\bridge\.env.example apps\bridge\.env
npm run dev
```

Open **http://localhost:5173**, click **Sign up**, and create your account. The **first signup becomes platform admin** when `INITIAL_ADMINS` is empty.

Full walkthrough: **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** · Env reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

| Service | URL |
|---------|-----|
| Web dashboard | http://localhost:5173 |
| Bridge API | http://localhost:3847 |
| WebSocket | ws://localhost:3847/ws |

![Sign up](docs/assets/readme/auth-signup.png)

### First steps after install

1. **Sign up** with email and password (local auth only  -  no OAuth).
2. Open **Chat** and select **Intelligence**. Add an LLM API key under **Vault → Secrets**, then configure the provider in **Agents → Pipeline**.
3. Ask Intelligence to create your first department and pages, or use **Structure** once you have content.
4. Optional: install plugins under **Marketplace → Unofficial** (see [docs/MARKETPLACE.md](docs/MARKETPLACE.md) and [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md)).

### Demo seed (screenshots / docs)

Populate a sample workspace for captures or local exploration:

```powershell
npm run dev
# in another terminal:
$env:DEMO_PASSWORD = "your-demo-password"
node scripts/seed-readme-demo.mjs
```

## Configuration

Copy `apps/bridge/.env.example` → `apps/bridge/.env`. Key variables:

| Variable | Purpose |
|----------|---------|
| `AUTH_SESSION_SECRET` | Session signing secret  -  change before any network exposure |
| `INITIAL_ADMIN_PASSWORD` | Optional password for pre-seeded `INITIAL_ADMINS` users |
| `INITIAL_ADMINS` | Pre-seed admins as `Name:email` (leave empty for first-signup admin) |
| `AUTH_ALLOW_SIGNUP` | Allow open signup (default `true` in local mode) |
| `DEPLOYMENT_MODE` | `local` (default), `hub`, or `client` |

LLM and integration keys belong in **Vault** inside the app, not in `.env`, unless you prefer env-based bootstrap.

## Screenshots

### OSS gallery

| OSS empty home | Contacts graph | Chat modes | Settings plugins |
|------|-----------|--------|------|
| ![OSS home](docs/assets/readme/oss-home-empty.png) | ![Contacts](docs/assets/readme/contacts-graph.png) | ![Chat modes](docs/assets/readme/chat-modes.png) | ![Plugins](docs/assets/readme/settings-plugins.png) |

| Marketplace unofficial | Agents pipeline |
|------|-----------|
| ![Marketplace](docs/assets/readme/marketplace-unofficial.png) | ![Agents](docs/assets/readme/agents-pipeline.png) |

### Platform

| Home | Structure | Agents | Wiki |
|------|-----------|--------|------|
| ![Home](docs/assets/readme/hero-home.png) | ![Structure](docs/assets/readme/structure-tree.png) | ![Agents](docs/assets/readme/agents-workspace.png) | ![Wiki](docs/assets/readme/wiki.png) |

### Chat panel

| Intelligence | Knowledge → Rules | Memory | Reflection |
|--------------|-------------------|--------|------------|
| ![Intelligence](docs/assets/readme/intelligence-chat.png) | ![Rules](docs/assets/readme/chat-knowledge-rules.png) | ![Memory](docs/assets/readme/chat-knowledge-memory.png) | ![Reflection](docs/assets/readme/chat-knowledge-reflection.png) |

| Vault | Bank | Support | Automations |
|-------|------|---------|-------------|
| ![Vault](docs/assets/readme/chat-vault.png) | ![Bank](docs/assets/readme/chat-bank.png) | ![Support](docs/assets/readme/chat-support.png) | ![Automations](docs/assets/readme/chat-automations.png) |

| Notifications | Calendar |
|---------------|----------|
| ![Notifications](docs/assets/readme/chat-notifications.png) | ![Calendar](docs/assets/readme/chat-calendar.png) |

### Productivity and social

| Tasks | Task detail | Shared | Marketplace |
|-------|-------------|--------|-------------|
| ![Tasks](docs/assets/readme/tasks-kanban.png) | ![Task detail](docs/assets/readme/task-card-detail.png) | ![Shared (Tailscale network)](docs/assets/readme/shared.png) | ![Marketplace (Official catalog)](docs/assets/readme/marketplace.png) |

| Support (GitHub + owner routing) |
|----------------------------------|
| ![Support](docs/assets/readme/support.png) |

## Components

| Component | Path | Role |
|-----------|------|------|
| Web dashboard | `apps/web` | React UI  -  Chat panel, structure, productivity |
| Bridge | `apps/bridge` | REST/WebSocket API, auth, multi-tenant SQLite |
| Connector | `apps/connector` | Local runtime for hardware-bound marketplace plugins |
| Plugin API | `packages/plugin-api` | Plugin manifest and register contracts |
| Plugin host | `packages/plugin-host` | Runtime facades for plugins |
| Flow core | `packages/flow-core` | Shared structure and flow types |

## Deployment

**Local mode** (default) runs Bridge and Web on your workstation  -  ideal for personal use.

For Docker hub/client deployments, see [DEPLOY.md](DEPLOY.md). Architecture details: [docs/architecture.md](docs/architecture.md).

## Documentation

Full documentation index: **[docs/README.md](docs/README.md)**

| | |
|---|---|
| **Get started** | [GETTING_STARTED](docs/GETTING_STARTED.md) · [ONBOARDING](docs/ONBOARDING.md) · [FEATURES](docs/FEATURES.md) · [LOCAL_LLM](docs/LOCAL_LLM.md) · [CURSOR](docs/CURSOR_SUBSCRIPTION.md) |
| **Use GodMode** | [AGENT_MEMORY](docs/AGENT_MEMORY.md) · [MARKETPLACE](docs/MARKETPLACE.md) · [SHARED_FEDERATION](docs/SHARED_FEDERATION.md) · [CONFIGURATION](docs/CONFIGURATION.md) · [SECURITY](docs/SECURITY.md) |
| **Deploy & extend** | [DEPLOY](DEPLOY.md) · [architecture](docs/architecture.md) · [PLUGIN_AUTHORING](docs/PLUGIN_AUTHORING.md) (contributors) |
| **Project** | [CHANGELOG](CHANGELOG.md) · [CONTRIBUTING](CONTRIBUTING.md) (includes roadmap themes) |

## License

[Apache License 2.0](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
