import type { CoreWikiPage } from "../core-db.js";

/** `[[Page]]`, `[[Page|label]]`, `[[Page#section]]` */
const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

/** `[text](/wiki/slug)` or `[text](/wiki/slug#anchor)` */
const MD_WIKI_LINK_RE = /\[([^\]]*)\]\(\s*\/wiki\/([^)\s#]+)/g;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Raw link targets from wikilinks and markdown /wiki/… links. */
export function extractWikiLinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const m of markdown.matchAll(WIKI_LINK_RE)) {
    const t = m[1]?.trim();
    if (t) targets.push(t);
  }
  for (const m of markdown.matchAll(MD_WIKI_LINK_RE)) {
    const t = m[2]?.trim();
    if (t) targets.push(t);
  }
  return targets;
}

/** Resolve a wikilink target (title or slug) to a page in the corpus. */
export function resolveWikiTarget(
  target: string,
  pages: CoreWikiPage[]
): CoreWikiPage | null {
  const raw = target.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const bySlug = pages.find((p) => p.slug.toLowerCase() === lower);
  if (bySlug) return bySlug;
  const byTitle = pages.find((p) => p.title.toLowerCase() === lower);
  if (byTitle) return byTitle;
  const slugified = slugify(raw);
  return pages.find((p) => p.slug === slugified) ?? null;
}

export function pageLinksToTarget(
  source: CoreWikiPage,
  targetId: string,
  pages: CoreWikiPage[]
): boolean {
  if (source.id === targetId) return false;
  for (const t of extractWikiLinkTargets(source.body_markdown)) {
    const resolved = resolveWikiTarget(t, pages);
    if (resolved?.id === targetId) return true;
  }
  return false;
}

export type WikiBacklink = Pick<CoreWikiPage, "id" | "slug" | "title">;

export function findBacklinksForPage(
  targetId: string,
  pages: CoreWikiPage[]
): WikiBacklink[] {
  const out: WikiBacklink[] = [];
  for (const p of pages) {
    if (pageLinksToTarget(p, targetId, pages)) {
      out.push({ id: p.id, slug: p.slug, title: p.title });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
