import type { CoreDatabase } from "../core-db.js";
import { createPage } from "./wiki-service.js";

export type PlatformWikiPageSeed = {
  slug: string;
  title: string;
  bodyMarkdown: string;
};

export const PLATFORM_WIKI_SPACE = "platform";

/** Canonical platform docs — Intelligence should read these via read_wiki_page. */
export const PLATFORM_WIKI_PAGES: PlatformWikiPageSeed[] = [
  {
    slug: "godmode-overview",
    title: "GodMode overview",
    bodyMarkdown: [
      "# GodMode overview",
      "",
      "**GodMode** is the platform — your personal operating system for work, life areas, and automations.",
      "",
      "**Intelligence** is GodMode's built-in AI assistant (the robot in the sidebar). It is not the platform name.",
      "",
      "Other key pieces:",
      "",
      "- **Digital You** — your persona agent (created on first login)",
      "- **Departments / divisions / pages** — how workspace navigation is organized (you start with an empty tree)",
      "- **Agents** — specialized AIs for departments or tasks",
      "- **Wiki** — this knowledge base (Intelligence can read and update it)",
      "- **Shared** — live resources someone else granted you",
      "- **Marketplace** — install published packs (integrations, templates, workflows)",
      "",
      "Intelligence can create departments, pages, agents, wiki articles, tasks, and more **directly from chat** using platform tools — you do not have to click through every screen yourself.",
    ].join("\n"),
  },
  {
    slug: "workspace-structure",
    title: "Workspace structure",
    bodyMarkdown: [
      "# Workspace structure",
      "",
      "GodMode organizes work in a tree:",
      "",
      "1. **Department** — top-level area (e.g. Work, Life, a client project)",
      "2. **Division** — group inside a department (e.g. Marketing under Work)",
      "3. **Page** — a screen in the sidebar (dashboard, project board, etc.)",
      "",
      "New workspaces start with **no departments**. Ask Intelligence to create your first department and pages, or use **Structure** once you have content to rearrange.",
      "",
      "Personal items (Calendar, Tasks, Bank, Vault, Wiki) live outside the department tree in the sidebar.",
    ].join("\n"),
  },
  {
    slug: "agents",
    title: "Agents",
    bodyMarkdown: [
      "# Agents",
      "",
      "| Agent | Role |",
      "|-------|------|",
      "| **Intelligence** | Platform-wide companion — setup, structure, wiki, cross-cutting tasks |",
      "| **Digital You** | Your persona — preferences, tone, personal context |",
      "| **Department agents** | Own a division or page (e.g. Research agent under Work) |",
      "| **Custom agents** | Anything you create for a workflow or domain |",
      "",
      "Create agents from **Agents** in the sidebar or ask Intelligence in chat (`create_agent`). Attach an agent to a structure node so opening that page auto-opens the right chat.",
      "",
      "Configure models, tools, and prompts under **Agents → Pipeline**.",
    ].join("\n"),
  },
  {
    slug: "shared-and-marketplace",
    title: "Shared and Marketplace",
    bodyMarkdown: [
      "# Shared and Marketplace",
      "",
      "## Shared",
      "",
      "When another GodMode user **shares** a resource with you (a department, agent, workflow, etc.), it appears under **Shared** in your sidebar. You get live access according to the grant — not a static copy.",
      "",
      "## Marketplace",
      "",
      "The **Marketplace** lists published packs you can install into your workspace: integrations, agent templates, workflow packs, and more. Browse → acquire → the pack provisions structure and assets into your tenant.",
      "",
      "Your own workspace stays separate unless you explicitly install or accept a share.",
    ].join("\n"),
  },
  {
    slug: "personal-tools",
    title: "Personal tools",
    bodyMarkdown: [
      "# Personal tools",
      "",
      "Every workspace includes these sidebar pages:",
      "",
      "- **Calendar** — events and schedules",
      "- **Tasks** — Kanban boards; tag tasks `auto` for Intelligence to resume work",
      "- **Wiki** — markdown knowledge base (you are reading it now)",
      "- **Vault** — secrets and API keys",
      "- **Bank** — holdings and financial tracking",
      "- **Notifications** — platform alerts",
      "- **Support** — submit and track help requests",
      "",
      "Add API keys in **Vault → Secrets**, then point Intelligence at a cloud provider under **Agents → Pipeline → Backend** if you are not using a local model.",
    ].join("\n"),
  },
];

function ensureWikiSlug(
  core: CoreDatabase,
  tenantId: string,
  authorUserId: string,
  seed: PlatformWikiPageSeed
): void {
  const existing = core
    .prepare(
      `SELECT id FROM wiki_pages
       WHERE tenant_id = ? AND slug = ? AND visibility = 'internal'`
    )
    .get(tenantId, seed.slug) as { id: string } | undefined;
  if (existing) return;

  createPage(
    {
      tenantId,
      authorUserId,
      title: seed.title,
      bodyMarkdown: seed.bodyMarkdown,
      space: PLATFORM_WIKI_SPACE,
      visibility: "internal",
      slug: seed.slug,
    },
    core
  );
}

/** Idempotent: seed platform reference wiki pages for a tenant. */
export function ensurePlatformWikiPages(
  core: CoreDatabase,
  tenantId: string,
  authorUserId: string
): void {
  for (const page of PLATFORM_WIKI_PAGES) {
    ensureWikiSlug(core, tenantId, authorUserId, page);
  }
}

export function backfillPlatformWikiPages(core: CoreDatabase): void {
  const tenants = core
    .prepare(`SELECT id, owner_user_id FROM tenants`)
    .all() as Array<{ id: string; owner_user_id: string }>;
  for (const t of tenants) {
    try {
      ensurePlatformWikiPages(core, t.id, t.owner_user_id);
    } catch {
      /* skip broken rows */
    }
  }
}
