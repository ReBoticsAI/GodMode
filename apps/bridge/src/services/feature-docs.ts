import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type FeatureDoc = {
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

function repoRootFromHere(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function featuresDir(): string {
  const fromEnv = process.env.GODMODE_FEATURES_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(repoRootFromHere(), "docs/features");
}

function loadOne(filePath: string): FeatureDoc | null {
  const raw = fs.readFileSync(filePath, "utf8");
  const { meta, body } = parseFeatureDoc(raw);
  const slug =
    meta.slug?.trim() || path.basename(filePath, path.extname(filePath));
  if (!slug) return null;
  return {
    slug,
    title: meta.title?.trim() || slug,
    section: meta.section?.trim() || "Features",
    location: meta.location?.trim() || "",
    summary: meta.summary?.trim() || "",
    bodyMarkdown: body.trim() + "\n",
  };
}

let cached: FeatureDoc[] | null = null;

/** Load and cache all docs/features/*.md for wiki seeding / catalog. */
export function loadFeatureDocs(force = false): FeatureDoc[] {
  if (cached && !force) return cached;
  const dir = featuresDir();
  if (!fs.existsSync(dir)) {
    cached = [];
    return cached;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f));
  const docs = files
    .map(loadOne)
    .filter((d): d is FeatureDoc => Boolean(d));
  const sectionRank = new Map(
    FEATURE_SECTION_ORDER.map((s, i) => [s, i] as const)
  );
  docs.sort((a, b) => {
    const ra = sectionRank.get(a.section as (typeof FEATURE_SECTION_ORDER)[number]) ?? 99;
    const rb = sectionRank.get(b.section as (typeof FEATURE_SECTION_ORDER)[number]) ?? 99;
    if (ra !== rb) return ra - rb;
    if (a.slug === "_index") return -1;
    if (b.slug === "_index") return 1;
    return a.title.localeCompare(b.title);
  });
  cached = docs;
  return docs;
}

export function featureDocsForWikiSeed(): Array<{
  slug: string;
  title: string;
  bodyMarkdown: string;
}> {
  return loadFeatureDocs().map((d) => ({
    slug: d.slug === "_index" ? "features" : d.slug,
    title: d.title,
    bodyMarkdown: stripMarkdownImages(d.bodyMarkdown),
  }));
}

/** Drop image markdown/HTML so wiki/RAG stays text-only (token cost + non-vision models). */
export function stripMarkdownImages(markdown: string): string {
  return String(markdown ?? "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}
