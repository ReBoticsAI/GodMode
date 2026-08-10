import { createRequire } from "node:module";
import type { CoreDatabase } from "../core-db.js";
import { createPage, updatePage } from "./wiki-service.js";
import { featureDocsForWikiSeed } from "./feature-docs.js";

const require = createRequire(import.meta.url);

export type PlatformWikiPageSeed = {
  slug: string;
  title: string;
  bodyMarkdown: string;
};

export const PLATFORM_WIKI_SPACE = "platform";

/** Canonical platform docs loaded from docs/features/*.md for agent wiki seeds. */
export function getPlatformWikiPages(): PlatformWikiPageSeed[] {
  return featureDocsForWikiSeed();
}
function ensureWikiSlug(
  workspace: CoreDatabase,
  tenantId: string,
  authorUserId: string,
  seed: PlatformWikiPageSeed
): void {
  const existing = workspace
    .prepare(
      `SELECT id, title, body_markdown, space FROM wiki_pages
       WHERE tenant_id = ? AND slug = ? AND visibility = 'internal'`
    )
    .get(tenantId, seed.slug) as
    | {
        id: string;
        title: string;
        body_markdown: string;
        space: string | null;
      }
    | undefined;

  if (!existing) {
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
      workspace
    );
    return;
  }

  // Platform space stays product-canonical: refresh title/body from disk.
  const sameSpace =
    existing.space === PLATFORM_WIKI_SPACE || existing.space == null;
  if (!sameSpace) return;

  const needsUpdate =
    existing.title !== seed.title ||
    existing.body_markdown !== seed.bodyMarkdown ||
    existing.space !== PLATFORM_WIKI_SPACE;

  if (!needsUpdate) return;

  updatePage(
    existing.id,
    {
      title: seed.title,
      bodyMarkdown: seed.bodyMarkdown,
      space: PLATFORM_WIKI_SPACE,
    },
    { tenantIds: [tenantId] },
    workspace
  );
}

/** Idempotent: seed (and refresh) platform reference wiki pages for a tenant (Workspace DB). */
export function ensurePlatformWikiPages(
  workspace: CoreDatabase,
  tenantId: string,
  authorUserId: string
): void {
  for (const page of getPlatformWikiPages()) {
    ensureWikiSlug(workspace, tenantId, authorUserId, page);
  }
}

export function backfillPlatformWikiPages(cloud: CoreDatabase): void {
  const tenants = cloud
    .prepare(`SELECT id, owner_user_id FROM tenants`)
    .all() as Array<{ id: string; owner_user_id: string }>;
  for (const t of tenants) {
    try {
      const { getTenantDb } = require("../tenant-registry.js") as typeof import("../tenant-registry.js");
      ensurePlatformWikiPages(
        getTenantDb(t.id) as CoreDatabase,
        t.id,
        t.owner_user_id
      );
    } catch {
      /* skip broken rows */
    }
  }
}
