import { globFiles, grepSearch, type FsRootOpts } from "./fs-tools.js";

export interface CodebaseSearchResult {
  path: string;
  line: number;
  snippet: string;
  score: number;
}

/** Semantic-ish codebase search: regex grep + path ranking (Cursor parity phase A). */
export async function codebaseSearch(opts: {
  query: string;
  path?: string;
  glob?: string;
  limit?: number;
  tenantId?: string | null;
}): Promise<{ query: string; results: CodebaseSearchResult[] }> {
  const query = String(opts.query ?? "").trim();
  if (!query) throw new Error("query required");
  const limit = Math.min(Math.max(Number(opts.limit ?? 25), 1), 50);
  const rootOpts: FsRootOpts = { tenantId: opts.tenantId };

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  let pattern = query;
  if (terms.length > 1 && !/[\\^$.*+?()[\]{}|]/.test(query)) {
    pattern = terms.map((t) => `(?=.*${t})`).join("") + ".+";
  }

  const grep = await grepSearch({
    pattern,
    path: opts.path,
    glob: opts.glob,
    caseInsensitive: true,
    tenantId: opts.tenantId,
  });
  const raw = grep.output === "(no matches)" ? "" : grep.output;

  const lines = raw.split(/\n/).filter(Boolean);
  const scored: CodebaseSearchResult[] = [];

  for (const line of lines) {
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, filePath, lineNum, snippet] = m;
    const lowerPath = filePath.toLowerCase();
    let score = 1;
    for (const t of terms) {
      if (lowerPath.includes(t)) score += 3;
      if (snippet.toLowerCase().includes(t)) score += 2;
    }
    if (lowerPath.includes("test")) score -= 0.5;
    if (lowerPath.includes("node_modules")) continue;
    scored.push({
      path: filePath,
      line: Number(lineNum),
      snippet: snippet.trim().slice(0, 200),
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const deduped: CodebaseSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of scored) {
    const key = `${r.path}:${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
    if (deduped.length >= limit) break;
  }

  if (deduped.length === 0 && terms.length === 1) {
    const glob = globFiles({
      pattern: `**/*${terms[0]}*`,
      cwd: opts.path ?? ".",
      tenantId: opts.tenantId,
    });
    for (const match of glob.matches.slice(0, limit)) {
      deduped.push({ path: match, line: 1, snippet: "(filename match)", score: 0.5 });
    }
  }

  return { query, results: deduped };
}
