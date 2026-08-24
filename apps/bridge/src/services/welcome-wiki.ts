import type { CoreDatabase, CoreWikiPage } from "../core-db.js";
import { createRequire } from "node:module";
import { createPage } from "./wiki-service.js";
import { ensurePlatformWikiPages } from "./platform-wiki-seed.js";

const require = createRequire(import.meta.url);

export const WELCOME_WIKI_BODY = [
  "# Welcome to GodMode",
  "",
  "You start with **Intelligence** (the nervous system: grow GodMode from chat) and **Digital You** (your twin). Your workspace has **no anatomy yet**. That is intentional.",
  "",
  "Ask Intelligence in chat to grow your first department, agent or pages. It can do this with tools, not just instructions. You can also open **Structure** later to rearrange the tree by hand.",
  "",
  "Use the sidebar for Calendar, Tasks, Wiki and Vault. Browse **Marketplace** to install packs others have published, or **Shared** when someone grants you access.",
  "",
  "Read more in the wiki: [[godmode-overview]], [[workspace-structure]], [[agents]], [[shared-and-marketplace]], [[personal-tools]].",
  "",
  "Add API keys in **Vault → Inference**, then set Intelligence to use a cloud provider in **Agents → Pipeline → Backend**.",
].join("\n");

/** Idempotent: ensure the onboarding welcome page exists for a tenant (Workspace DB). */
export function ensureWelcomeWikiPage(
  workspace: CoreDatabase,
  tenantId: string,
  authorUserId: string
): CoreWikiPage {
  const existing = workspace
    .prepare(
      `SELECT id FROM wiki_pages
       WHERE tenant_id = ? AND slug = 'welcome' AND visibility = 'internal'`
    )
    .get(tenantId) as { id: string } | undefined;

  if (existing) {
    ensurePlatformWikiPages(workspace, tenantId, authorUserId);
    return workspace
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
    workspace
  );
  ensurePlatformWikiPages(workspace, tenantId, authorUserId);
  return page;
}

/**
 * Backfill welcome pages for tenants that predate correct wiki seeding.
 * `cloud` is used only to list tenants; writes go to each Workspace DB.
 */
export function backfillWelcomeWikiPages(cloud: CoreDatabase): void {
  const tenants = cloud
    .prepare(`SELECT id, owner_user_id FROM tenants`)
    .all() as Array<{ id: string; owner_user_id: string }>;
  for (const t of tenants) {
    try {
      // Dynamic require avoids core-db ↔ tenant-registry import cycle at load time.
      const { getTenantDb } = require("../tenant-registry.js") as typeof import("../tenant-registry.js");
      ensureWelcomeWikiPage(
        getTenantDb(t.id) as CoreDatabase,
        t.id,
        t.owner_user_id
      );
    } catch {
      /* skip broken rows */
    }
  }
}
