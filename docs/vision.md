# GodMode Vision

**Internal draft.** This document fills the positioning gap previously referenced as `POSITIONING.md`. It is the north-star spine for README, marketing `/www`, wiki seeds, and roadmap epic **#104**. Keep private (not a public marketing page). Operator decisions are recorded under **Decisions**.

---

## Slogan (canonical)

> **Create, edit, organize, and monitor everything you do for yourself, your agents, and your people. Built to be the last platform stack you need.**

That sentence is the GitHub / README spine. Everything below unpacks it.

**GodMode** is the open-source Control Center for everything you do digitally: yourself, your agents, and your people. Self-expanding. Built around Digital You. The last platform stack you need.

---

## Narrative pillars (lean hard)

These are the story. Feature inventories serve them; they do not replace them.

1. **Last platform.** One home for everything you will ever need digitally: create, edit, organize, and monitor life and work for you, your agents, and your people. Stop assembling a new app stack for every job.
2. **Self-expansion.** Intelligence builds and extends GodMode from inside GodMode: structure, tools, packs, and plugins without leaving the Control Center. The platform grows with you.
3. **Digital You.** Your twin: private thinking partner and stand-in. It compounds as you use the platform (Reflection, memory, voice). You stay in the loop; it learns you.
4. **Connect anything.** Wire APIs, services, hardware-bound connectors, and custom packs into the same workspace. Automate and integrate without bolting on yet another separate automation product.
5. **Open source.** Apache 2.0 core. Local-first and self-host stay first-class. Cloud is convenience and commerce, not a lock-in identity.
6. **All-encompassing Control Center.** Knowledge, work, people, money, agents, and (over time) owned email, accounting, robots/devices, and inference live in one product. Marketplace covers niche professions; Core covers what everyone needs.

---

## North star

GodMode is the durable home for a human and their agents: one workspace where you **create**, **edit**, **organize**, and **monitor** knowledge, work, people, money surfaces, and the agents that help run them. It is meant to be the **last digital platform** you adopt: self-expanding, open source, and complete enough that niche needs arrive as packs rather than as a new product category.

**Last platform stack** means:

1. **One Control Center** for everything digital you care about (structure, wiki, tasks, calendar, contacts, vault, bank, agents), not another single-purpose SaaS you replace next year.
2. **Core stays universal.** Niche profession, hobby, and vendor domains are something you build with Intelligence, or install as Marketplace packs and plugins when you want to move faster.
3. **Self-expanding:** Intelligence can scaffold, code, and install plugins from inside the workspace. Connect and automate new surfaces without leaving GodMode.
4. **Depth grows inside the same product:** owned email and domains, accounting, robot/IoT actor plane, owned inference and training, rather than assembling a new stack for each job.
5. **Install flexibility:** desktop, local, and private hub are first-class. Cloud is browser convenience, multi-tenant ops, and commerce authority. Open source either way.

Ambition is the all-encompassing digital home (Office/Workspace + ERP-class depth **over time**), delivered as a personal OS you host or rent, not as a chat gateway alone.

### Fifth category (competitive frame)

Relative to common agent products, GodMode is a **fifth category**: a **self-hosted personal OS / Control Center** where agents live inside a persistent workspace they can extend.

| Category | Examples | What they optimize for |
| --- | --- | --- |
| Personal-assistant gateways | OpenClaw, Hermes-class | Channels, always-on messaging agents |
| Computer / sandbox agents | Agent Zero-class | Isolated machine + browser/terminal |
| Developer frameworks | CrewAI, LangGraph, Letta-as-SDK | Embed agents in *your* app |
| Cloud chat / coding tools | Claude Cowork, Cursor, Claude Code | Managed chat or repo-scoped coding |
| **Personal OS / Control Center** | **GodMode** | Structure + productivity suite + org-chart agents + Shared + Marketplace in one stack |

A fuller capability matrix lives in **private** maintainer docs (`COMPARISON.md`). Keep comparison and this vision doc **private for now** (not published to `/www` or as a public repo marketing page).

---

## Product identity (today)

**What ships now:** a local-first personal Control Center kernel (v0.9.x): React web shell + Node Bridge + SQLite multi-tenant stores + Intelligence / Digital You + productivity and social surfaces + Marketplace + optional Cloud paywall and coding isolation.

| Term | Meaning |
| --- | --- |
| **GodMode** | The platform / Control Center |
| **Intelligence** | Built-in platform agent (setup, structure, cross-cutting tools, plugin build) |
| **Chat panel** | Floating UI to talk to agents (not an agent name) |
| **Digital You** | Per-user twin: private thinking partner **and** stand-in voice when you are unavailable |
| **Agents → Pipeline** | Models, tools, rules, profiles, MCP, training |

Fresh tenants seed as **personal OS only**: empty structure tree, Intelligence tool allowlist, bootstrap knowledge. Niche verticals are not preloaded.

---

## NOW · NEAR · LATER

Board doctrine: [GodMode Roadmap](https://github.com/users/ReBoticsAI/projects/1). Core checklist items must not jump ahead of launch + dogfood.

### NOW (usable product + launch truth)

- Personal Control Center surfaces: Home, Structure, Wiki, Tasks, Calendar, Vault, Bank (thin ledger), Contacts, Notifications, Support, Coding, Shared, Marketplace UI.
- Intelligence + Digital You + department/page agents; Chat modes Agent / Plan / Ask; Knowledge (rules, skills, memory, artifacts, reflection, tools).
- Authority kill switches (#96 Done); SaaS coding isolation Layers 1–4 foundation (#112 and children Done).
- **In progress / P0 Ready:** last-pass marketing + docs accuracy (#204), then Hostinger SaaS cutover (#192–#200, #203): secrets, VPS, Cloudflare, public www + Stripe URL, live Stripe, prod Resend + admin MFA, backups drill, adversarial review, DNS sign-off.

### NEAR (after Cloud is live)

- **P1 dogfood:** SaaS plugin loop scaffold → build → install without Bridge restart (#201); develop Core via hub Coding + GitHub PR (#202).
- **Marketplace trust:** intake verify + buyer protection / pinned install / least privilege (#180, #177, #76); verify pipeline (#3) as needed.
- Local / desktop / private hub remain first-class alongside Cloud.

### LATER (Backlog; Core epic #104 and beyond)

**Core Control Center completeness (#104 children, P2):** domains (#89), owned email (#90), accounting (#91), Contacts depth (#92), wiki editing/export (#93), robot/IoT actor plane (#94), owned inference (#95), unified search (#97), continuity backup/restore/export (#98), communications beyond email (#99), outbound reach (#100), sites/public presence (#101), org scale (#102), unified inbox/attention (#103), goal/mission lineage (#115), Digital You depth (#79), training/persona adapters (#77), model harness profiles (#64), **GodMode Inference by ReBotics** (#111), Tasks↔GitHub sync (#110), knowledge graph for agent memory (#206).

**P3 / connectors / scale:** Bank UI beyond placeholder (#65), live bank/exchange OAuth (#72), calendar/email sync connectors (#73), external knowledge connectors (#74), Hub PWA (#75), optional Postgres (#78), Admin support polish (#68).

**Post-Cloud Core graduation (after SaaS live):** full eCommerce (#105), heavy ERP (#106), heavy CRM (#107) move from fence toward Core work in parallel with support/ops as users arrive. Infra-as-verb GPU/VM provisioning (#108) stays on the fence until revisited.

**Plugin-backlog (not Core):** trading/markets, vendor robot/smart-home packs, SaaS sync connectors, industry verticals (#109).

Isolation ceiling items (#172 VM-grade, #173 non-HTTP egress, #181 build worker pool) stay design/deferred relative to SaaS v1.

```text
NOW     Marketing/docs truth (#204) → Hostinger SaaS live (P0)
  │
NEAR    Dogfood GodMode-from-GodMode → Marketplace trust (P1)
  │
LATER   Isolation decisions → Core #104 depth → fence / plugin ideas
```

---

## Architecture (how the stack holds)

### Apps

| App | Role |
| --- | --- |
| **web** | React + Vite Control Center UI |
| **bridge** | Node/Express API, SQLite, AI orchestration, ObjectType kernel |
| **desktop** | Electron shell (Bridge + web); Admin Updates |
| **connector** | Optional local process for hardware-bound marketplace plugins |

### Packages

`@godmode/kernel` (ObjectType vocabulary), `@godmode/plugin-api`, `@godmode/plugin-host`, `@godmode/web-host`, `@godmode/flow-core`.

### Kernel and storage

Durable mutations go through the **ObjectType kernel**: metadata → adapter or native SQLite → Record CRUD, named actions, async `OperationRun`s.

- **`core.sqlite`**: users, sessions, tenants, marketplace, shares, federation, SaaS entitlements, releases.
- **`tenants/<id>.sqlite`**: structure, AI, wiki, tasks, calendar, vault, holdings, automations, native OT tables.

### Deployment modes

| Mode | Meaning |
| --- | --- |
| **local** (default) | Workstation / desktop; open signup default |
| **hub** | Multi-tenant server |
| **client** | Personal Docker; marketplace via Cloud hub URL |
| **SaaS** | Hub + official paid Cloud surface (`isSaas`) |
| **private hub** | Team/family hub without SaaS paywall |

Local-first and Cloud are **one product, two install postures**, not two products.

### Plugins

Discovery via `GODMODE_PLUGIN_PATH` and marketplace-registered paths. Fresh clone with no plugins = personal OS only. Plugins register routes, tools, ObjectTypes, and web bundles. Intelligence can scaffold → build → install.

---

## Pillars

Ordered for the public story first; surfaces below support the narrative pillars above.

| Pillar | Job |
| --- | --- |
| **Last platform** | One Control Center for everything digital you need; Core depth grows in-product |
| **Self-expansion** | Intelligence builds the workspace and plugins from inside GodMode |
| **Digital You** | Private thinking partner + stand-in twin; compounds with use |
| **Connect anything** | Plugins, Marketplace packs, connectors, APIs, and automations into one stack |
| **Open source** | Apache 2.0 core; local-first / self-host first-class; Cloud optional |
| **Intelligence** | Platform guide and builder; mutates workspace; codes plugins |
| **Structure** | Org tree (departments / divisions / pages); agents scoped to the tree; starts empty |
| **Knowledge** | Rules, skills, memory, artifacts, reflection, tools; wiki as durable prose |
| **Work** | Tasks (incl. `auto`), calendar, automations, notifications, coding |
| **People** | Contacts, DMs/channels, Shared live grants |
| **Money surfaces** | Vault (secrets); Bank today; accounting as Core depth |
| **Marketplace** | Official / Local / Community / Installed / Sell; niche packs without forking core |
| **Authority** | Bounded delegation: audit, kill switches, spend/coding/deploy gates |

**Connect anything (detail):** users and Intelligence can attach external systems and custom capability into GodMode: Marketplace packs, Local plugins on self-host, Connector for hardware-bound plugins, coding tools that implement integrations, Shared live grants, and (later) outbound reach / sync connectors. The point is one Control Center that absorbs connections, not a separate automation silo beside GodMode.

---

## Agents

### Role split (stable doctrine)

| Agent | Job |
| --- | --- |
| **Digital You** | For the **user**: bounce ideas, stay on track, learn voice and judgment; **stand-in** when unavailable so agents can get *your* perspective (not a teammate product, not a final decision maker for others) |
| **Intelligence** | For the **platform**: setup, structure, wiki, coding, plugin build, cross-cutting ops |
| **Domain / department agents** | Specialized areas under Intelligence in the org chart |

### Org chart

- **Intelligence** is the platform root; department and page agents report to it.
- **Digital You** is a separate DB root (`parent_id` null), shown **beside** Intelligence with no parent/child link.
- Marketing and docs: department agents under Intelligence; Digital You as a parallel root (not “under both”).

### Digital You (canonical wording)

**Digital You is a stand-in and a private thinking partner.**

- **Private thinking partner:** chat, reflection, persona, self-coaching; learns from platform use.
- **Stand-in:** can represent your perspective when you are unavailable (agents seeking judgment / voice). It is **not** “for teammates as a proxy of a specific operator,” and it is **not** automatic full delegation of irreversible actions without Authority bounds.

Implementation today is a twin agent with restricted tools, profile, and memories. Stand-in quality **compounds with use**: Reflection and saved memories build the model of you over time. It is usable as a thinking partner immediately; it is **not complete** as a rich stand-in until that memory has depth. Product surfaces that automate stand-in (persona proposals, ask-via-Digital-You defaults) deepen under #79.

**Public copy:** state the intended role (stand-in + thinking partner) and that it gets better as you use the platform. Do not imply a finished auto-coverage product on day one.

---

## Memory

**Today:** no knowledge graph in shipped core. Model is classic layers + hybrid RAG (`docs/AGENT_MEMORY.md`):

| Layer | Store | Mechanism |
| --- | --- | --- |
| Working | `ai_messages` | Compaction; may enqueue episodic distill |
| Semantic | `ai_memories` | FTS + optional vector embed; hybrid retrieve into chat |
| Episodic | memories `category=episode` | Debounced distill; often pending approval |
| Procedural | Skills + rules + capability RAG | Playbook-gated skills |
| Durable wiki | `wiki_pages` + wiki RAG | Chat snippets; synthesize → proposals |

**Planned:** knowledge graph layer additive to RAG (#206, Backlog). Contacts “social graph” remains a UI metaphor until that ships.

**Reflection** is the curated proposal path into long-term knowledge (first-class differentiator vs many chat agents).

Embeddings: optional (e.g. EmbeddingGemma); SaaS may use a shared embed queue. Prompt sections typically include memory, wiki, and capabilities.

---

## Marketplace and extension economy

- **Marketplace** installs a **copy** of a pack into *your* workspace.
- **Shared** grants **live** access to another user’s resources (not export ping-pong).
- Tabs: Official / Local / Community / Installed / Sell.
- Commerce: USD / PayPal / crypto when configured; Community sellers **90%** / platform **10%**; Official paid → platform merchant of record; Cloud is commerce authority.
- Local plugin folders: self-host / desktop; blocked on SaaS unless explicitly allowed.
- **No credits.** Credits are a remnant of an old system and are being removed from the product story. Marketplace commerce is real money: Community is user-to-user with a platform cut (sellers connect Stripe / PayPal / crypto to accept payouts); Official paid packs use platform merchant of record. Cloud subscription is separate Stripe billing for the hosted seat.
- Professional domains such as **trading and markets** ship as **optional Marketplace plugins**, not as part of the open-source Control Center.

**Self-build tension (acknowledged):** Intelligence can rebuild many packs. Marketplace still wins on time-save, trust, Official listing, and hardware-bound connectors. Monetization for Cloud is subscription + Marketplace MoR + (later) **GodMode Inference by ReBotics** (#111).

---

## Security, Authority, Cloud vs local

### Local / desktop / private hub

- Data stays with you; open signup default (configurable).
- Coding sandbox often looser (especially Windows); operator-trusted machines.
- Local plugin folders and sibling Desktop plugins supported.

### GodMode Cloud (SaaS)

- Paywall: plan → Checkout → account; browser onboarding + revenue.
- Stronger defaults: email verify, optional OAuth when enabled, **admin MFA** hard gate (prod verify on launch track), Marketplace-only installs by default, coding on with Layers 1–4 isolation, quotas and kill switches.
- Isolation is production-minded, not VM-grade (#172 deferred for SaaS v1).
- BYOK: you bring AI provider keys. Later: **GodMode Inference by ReBotics** (#111) as an optional hosted inference product under the GodMode brand.

### Authority

Kill switches and audit for coding / spend / deploy / delete / send / agent pause shipped (#96). Full budget accounting remains Core depth (#91). Robots and unbounded agents need the same bounded-delegation story as humans.

Public DNS cutover only after launch checklist gates (marketing truth, mail, MFA, Stripe, backups, adversarial review).

---

## Launch sequencing

Canonical Ready doctrine (README, `DEPLOY.md`, #104):

1. **P0** Hostinger SaaS live (browser onboarding + revenue). Local/desktop/self-hosted stay first-class.
2. **P1** Dogfood GodMode-from-GodMode (plugins + Core), then marketplace trust.
3. **Backlog** Isolation/scale decisions, then Core #104 children, then plugin-backlog / on-the-fence.

Refined launch order from issue comments:

**#204** (docs/marketing accuracy) → **#195** (Cloudflare) → finish **#196** (public www + Stripe business URL). **#203** (adversarial security) before **#200** (DNS cutover).

Not on the public board: personal fundraising tracks, unrelated business-plan artifacts.

---

## Core epic #104 (Control Center completeness)

Umbrella issue for “last platform stack” depth. Checklist is **vision**, not a queue jumper ahead of live + dogfood.

**Owned vs connected** (from `CORE_VS_PLUGINS.md`):

| Core (owned) | Plugin / fence |
| --- | --- |
| Owned email send/receive + domains | Sync Gmail/Outlook |
| Accounting (income, expenses, accounts, reports) | Exchange OAuth for funded trading agents |
| Contacts as relationship system of record | Industry CRM suites as deep verticals |
| Robot/IoT **actor plane** (registry, telemetry, commands, audit) | Brand-specific device SDKs |
| Wiki editing and export inside GodMode | Separate docs products outside wiki |

**Test for Core:** most users would be blocked day-to-day without it; cross-cutting; control / system-of-record; not a single vendor or profession.

---

## Public vs private boundary

| Public (OSS GodMode) | Private / sibling |
| --- | --- |
| Universal Control Center core (Apache 2.0) | Domain plugin implementations (e.g. trading/markets packs) |
| Plugin SDK, Marketplace UI, personal-OS seed | Operator bootstrap packs, private rules with personal trees |
| Generic docs, security, deploy, feature catalog | Operator setup, credentials, hostnames, machine-specific ops |
| Roadmap epic #104 and labels | Private research archives, hardware IPC internals |

CI gate: `npm run audit:oss` (no trading source, no operator PII, no static private plugin `file:` deps in public core).

**Residue to clean in public docs/code over time** `(open for review)`: legacy trading page-kind names in Bridge validation, federation wording that still mentions domain proxies, Bank “wallets for agents” claims ahead of `agent_id` parity.

---

## Implications for marketing, docs, and wiki

### Must align to this vision

1. **Lead with the full slogan** and the narrative pillars: last platform, self-expansion, Digital You, connect anything, open source, all-encompassing Control Center.
2. **Digital You** = stand-in **and** private thinking partner; note that it deepens as you use the platform (Reflection / memory), not a finished auto-coverage product on day one.
3. **Self-expansion in plain language:** Intelligence builds and extends your GodMode from inside GodMode (structure, packs, plugins, connections). Do not name third-party automation products.
4. **Connect anything** as a hero theme alongside Marketplace: wire the tools and services you already use into one home.
5. **Open source** is a first-class promise (Apache 2.0, self-host), not a footnote under Cloud CTAs.
6. **Marketing aims at the destination** (everything you will ever need digitally). Do not over-inventory thin current surfaces.
7. **Intelligence ≠ GodMode**; Chat panel is UI, not the agent name.
8. **Three “email” meanings** stay distinct: transactional Cloud mail (shipped), account/support email, owned inbox/domains (roadmap Core).
9. **Primary acquisition CTA on `/www`:** Cloud (Open Cloud / Start Cloud signup). Self-host and GitHub remain secondary for people who want to run it themselves. Developer Getting Started may still lead with desktop/clone.
10. **Agent hierarchy:** department agents under Intelligence; Digital You parallel root. Prefer the name **Digital You** everywhere (retire “Digital user”).
11. **Trading:** optional plugin domains only; never public product identity.
12. **Comparison matrix and this vision:** stay private for now; do not publish `COMPARISON.md` or `vision.md` as marketing pages.
13. **No credits** in marketing or Marketplace copy. Sellers need payout setup (e.g. Stripe Connect) to sell Community listings.
14. Wiki seeds (`docs/features/*`) and `FEATURES.md` should cite this file as positioning source of truth (internal). Public Node requirement: **22.13+** (align README away from “20+”).

### Doc debt this draft replaces

- Missing `POSITIONING.md` referenced by #104 / #204 → **this `vision.md`** (keep private / internal).
- After approval: update README slogan/Node engines, marketing home hero, `godmode-overview.md`, and Digital You feature page to match canonical wording. Strip credits language from user-facing Marketplace docs.

---

## What is explicitly not the public product

- Trading / markets / charting platforms as core identity (plugins only).
- Operator personal department trees or life/enterprise PII.
- Claiming a knowledge graph as shipped (planned in #206; not present today).
- Selling Core #104 backlog items as shipped.
- Collapsing Cloud transactional email with owned GodMode email.
- Presenting SaaS coding isolation as VM-equivalent.

---

## Decisions (locked from operator review)

0. **Public narrative lean:** last platform + self-expansion + Digital You + connect anything + open source + all-encompassing digital home. Do not name third-party automation products in marketing.
1. **Marketing hero:** full GitHub slogan.
2. **Digital You stand-in claim:** intended role is stand-in + thinking partner; capability compounds via Reflection/memory with use; not complete as rich stand-in on day one; #79 deepens automation later.
3. **Primary `/www` CTA:** Cloud signup; self-host secondary (see Implications §6).
4. **COMPARISON + vision:** keep private for now.
5. **Marketing tone:** aim at what we are building toward; do not over-detail thin current inventory.
6. **Credits:** retiring; Marketplace is real-money U2U (+ platform cut) and Official MoR; sellers connect payout rails (e.g. Stripe).
7. **eCommerce / ERP / CRM (#105–#107):** graduate toward Core after Cloud launch; work in parallel with post-launch support. Do not publish internal go-to-market sequencing beyond that.
8. **Hosted inference (#111):** **GodMode Inference by ReBotics** (GodMode-branded product).
9. **Naming:** **Digital You** everywhere; retire “Digital user.”
10. **Node:** public requirement **22.13+** (what we build and document in Getting Started; fix README “20+”).

---

## One-paragraph synthesis

GodMode is an **open-source**, local-first **Control Center**: the **last platform stack** for everything you will ever need digitally. **Create, edit, organize, and monitor** for yourself, your agents, and your people. **Self-expansion** means Intelligence builds and extends the product from inside it. **Digital You** is your stand-in and private thinking partner. **Connect anything** through plugins, Marketplace, connectors, and in-workspace build. Cloud is the near-term go-live and revenue path; desktop and self-host stay first-class. Niche professions are optional packs. Near-term execution is SaaS launch → dogfood → marketplace trust; Core epic #104 is the long arc of Control Center completeness.

---

*Draft compiled from vision briefs (codebase, docs-marketing, roadmap, private lineage, transcripts) plus public README / CORE_VS_PLUGINS and private COMPARISON framing. No operator PII. Do not treat Backlog epics as shipped.*
