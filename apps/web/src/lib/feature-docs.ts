export type FeatureDocMeta = {
  slug: string;
  title: string;
  section: string;
  location: string;
  summary: string;
  bodyMarkdown: string;
};

export const FEATURE_SECTION_ORDER = [
  "Hubs",
  "Platform and agents",
  "Knowledge and memory",
  "Productivity",
  "Social and extension",
  "Chat modes and commands",
] as const;

function parseFeatureDoc(raw: string): { meta: Record<string, string>; body: string } {
  const text = String(raw ?? "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { meta: {}, body: text };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: text };
  const fm = text.slice(4, end).trim();
  let body = text.slice(end + 4);
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);

  const meta: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      try {
        v = JSON.parse(v.startsWith('"') ? v : JSON.stringify(v.slice(1, -1)));
      } catch {
        v = v.slice(1, -1);
      }
    }
    meta[m[1]] = String(v);
  }
  return { meta, body };
}

const rawModules = import.meta.glob("../../../../docs/features/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function toDoc(raw: string, fallbackSlug: string): FeatureDocMeta {
  const { meta, body } = parseFeatureDoc(raw);
  const slug = meta.slug?.trim() || fallbackSlug;
  return {
    slug,
    title: meta.title?.trim() || slug,
    section: meta.section?.trim() || "Features",
    location: meta.location?.trim() || "",
    summary: meta.summary?.trim() || "",
    bodyMarkdown: body.trim() + "\n",
  };
}

const sectionRank = new Map(
  FEATURE_SECTION_ORDER.map((s, i) => [s, i] as const)
);

export const FEATURE_DOCS: FeatureDocMeta[] = Object.entries(rawModules)
  .map(([filePath, raw]) => {
    const base = filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? "unknown";
    return toDoc(raw, base);
  })
  .sort((a, b) => {
    const ra = sectionRank.get(a.section as (typeof FEATURE_SECTION_ORDER)[number]) ?? 99;
    const rb = sectionRank.get(b.section as (typeof FEATURE_SECTION_ORDER)[number]) ?? 99;
    if (ra !== rb) return ra - rb;
    if (a.slug === "_index") return -1;
    if (b.slug === "_index") return 1;
    return a.title.localeCompare(b.title);
  });

export function getFeatureDoc(slug: string): FeatureDocMeta | undefined {
  return FEATURE_DOCS.find(
    (d) => d.slug === slug || (slug === "features" && d.slug === "_index")
  );
}

export function featureDocsForIndex(): FeatureDocMeta[] {
  return FEATURE_DOCS.filter((d) => d.slug !== "_index");
}

/**
 * Drop agent-only H2 sections before public marketing render.
 * Same markdown still seeds the in-product platform wiki for agents.
 */
export function stripAgentFacingSections(markdown: string): string {
  const text = String(markdown ?? "");
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const title = heading[1].trim().toLowerCase();
      skipping = isAgentFacingHeading(title);
      if (skipping) continue;
    } else if (skipping) {
      continue;
    }
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function isAgentFacingHeading(titleLower: string): boolean {
  if (titleLower === "agent notes" || titleLower === "narrative for agents") {
    return true;
  }
  if (titleLower === "for agents" || titleLower === "agent guidance") {
    return true;
  }
  if (titleLower.startsWith("agent notes") || titleLower.startsWith("narrative for agents")) {
    return true;
  }
  return false;
}

/** Prepare feature markdown for public marketing pages. */
export function prepareMarketingFeatureMarkdown(markdown: string): string {
  return preprocessMarketingWikiLinks(stripAgentFacingSections(markdown));
}

/** Turn [[slug]] wikilinks into marketing feature hrefs for public pages. */
export function preprocessMarketingWikiLinks(markdown: string): string {
  const base = wikiMarketingBase();
  return markdown.replace(
    /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g,
    (_m, target, label) => {
      const slug = String(target).trim().toLowerCase().replace(/\s+/g, "-");
      const text = String(label ?? target).trim();
      const href =
        slug === "_index" || slug === "features"
          ? `${base}/features`
          : `${base}/features/${slug}`;
      return `[${text}](${href})`;
    }
  );
}

/** Same host rules as marketingBase.ts (local copy avoids pages↔lib cycles). */
function wikiMarketingBase(): string {
  const forced = import.meta.env.VITE_MARKETING_AT_ROOT;
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";
  const atRoot =
    forced === "true" ||
    (forced !== "false" &&
      (hostname === "godmode.software" ||
        hostname === "www.godmode.software" ||
        (hostname.endsWith(".pages.dev") && hostname.includes("godmode-www"))));
  return atRoot ? "" : "/www";
}
