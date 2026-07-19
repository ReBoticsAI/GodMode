/**
 * Shared frontmatter + body parser for docs/features/*.md
 * (kept dependency-free for bridge and scripts)
 */

/**
 * @param {string} raw
 * @returns {{ meta: Record<string, string>, body: string }}
 */
export function parseFeatureDoc(raw) {
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

  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      try {
        v = JSON.parse(v.includes('"') ? v : `"${v.slice(1, -1)}"`);
      } catch {
        v = v.slice(1, -1);
      }
    }
    meta[m[1]] = String(v);
  }
  return { meta, body };
}

export const FEATURE_SECTION_ORDER = [
  "Hubs",
  "Platform and agents",
  "Knowledge and memory",
  "Productivity",
  "Social and extension",
  "Chat modes and commands",
];
