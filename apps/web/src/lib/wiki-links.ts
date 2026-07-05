const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type WikiLinkPage = { slug: string; title: string };

function resolveTarget(target: string, pages: WikiLinkPage[]): WikiLinkPage | null {
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

/** Turn `[[wikilinks]]` into markdown links before rendering. */
export function preprocessWikiLinks(content: string, pages: WikiLinkPage[]): string {
  return content.replace(WIKI_LINK_RE, (_, target: string, label?: string) => {
    const display = (label ?? target).trim();
    const resolved = resolveTarget(target, pages);
    if (resolved) {
      return `[${display}](/wiki/${resolved.slug})`;
    }
    return `[${display}](wiki:missing:${encodeURIComponent(target.trim())})`;
  });
}
