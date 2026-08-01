/**
 * Drop agent-only H2 sections from dual-use feature markdown.
 * Marketing must not ship or render this copy; bridge wiki seed keeps the full files.
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
  if (
    titleLower.startsWith("agent notes") ||
    titleLower.startsWith("narrative for agents")
  ) {
    return true;
  }
  return false;
}
