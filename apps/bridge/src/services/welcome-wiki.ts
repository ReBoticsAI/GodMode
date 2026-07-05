import type { CoreDatabase, CoreWikiPage } from "../core-db.js";
import { createPage } from "./wiki-service.js";
import { ensurePlatformWikiPages } from "./platform-wiki-seed.js";

export const WELCOME_WIKI_BODY = [
  "# Welcome to GodMode",
  "",
  "You start with **Intelligence** (GodMode's built-in AI) and **Digital You** (your persona agent). Your workspace has **no departments yet** — that is intentional.",
  "",
  "Ask Intelligence in chat to create your first department, agent, or pages — it can do this with tools, not just instructions. You can also open **Structure** later to rearrange the tree by hand.",
  "",
  "Use the sidebar for Calendar, Tasks, Wiki, and Vault. Browse **Marketplace** to install packs others have published, or **Shared** when someone grants you access.",
  "",
  "Read more in the wiki: [[godmode-overview]], [[workspace-structure]], [[agents]], [[shared-and-marketplace]], [[personal-tools]].",
  "",
  "Add API keys in **Vault → Secrets**, then set Intelligence to use a cloud provider in **Agents → Pipeline → Backend**.",
].join("\n");

/** Idempotent: ensure the onboarding welcome page exists for a tenant (core DB). */
export function ensureWelcomeWikiPage(
  core: CoreDatabase,
  tenantId: string,
  authorUserId: string
): CoreWikiPage {
  const existing = core
    .prepare(
      `SELECT id FROM wiki_pages
       WHERE tenant_id = ? AND slug = 'welcome' AND visibility = 'internal'`
    )
    .get(tenantId) as { id: string } | undefined;

  if (existing) {
    ensurePlatformWikiPages(core, tenantId, authorUserId);
    return core
      .prepare(`SELECT * FROM wiki_pages WHERE id = ?`)
      .get(existing.id) as CoreWikiPage;
  }

  const page = createPage(
    {
      tenantId,
      authorUserId,
      title: "Welcome to GodMode",
      bodyMarkdown: WELCOME_WIKI_BODY,
      space: "onboarding",
      visibility: "internal",
      slug: "welcome",
    },
    core
  );
  ensurePlatformWikiPages(core, tenantId, authorUserId);
  return page;
}

/** Backfill welcome pages for tenants that predate correct wiki seeding. */
export function backfillWelcomeWikiPages(core: CoreDatabase): void {
  const tenants = core
    .prepare(`SELECT id, owner_user_id FROM tenants`)
    .all() as Array<{ id: string; owner_user_id: string }>;
  for (const t of tenants) {
    try {
      ensureWelcomeWikiPage(core, t.id, t.owner_user_id);
    } catch {
      /* skip broken rows */
    }
  }
}
