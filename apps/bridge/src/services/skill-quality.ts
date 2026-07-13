import type { AppDatabase } from "../db.js";

const MIN_BODY_CHARS = 80;

interface SkillRow {
  id: string;
  name: string;
  body: string | null;
  status: string | null;
}

/**
 * Procedural skill gate: require playbook structure and reject near-duplicates.
 * Returns null when OK, or a human-readable rejection reason.
 */
export function gateSkillDraft(
  db: AppDatabase,
  agentId: string,
  input: { name: string; body: string; excludeSkillId?: string }
): string | null {
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name) return "Skill name is required";
  if (body.length < MIN_BODY_CHARS) {
    return `Skill body too short (need ≥${MIN_BODY_CHARS} chars of procedure steps)`;
  }
  if (!hasPlaybookStructure(body)) {
    return "Skill body must look like a playbook (numbered steps, ## headings, or imperative lines)";
  }

  const existing = listSkillsForGate(db, agentId);
  const nameLower = name.toLowerCase();
  for (const s of existing) {
    if (input.excludeSkillId && s.id === input.excludeSkillId) continue;
    if (s.status === "rejected") continue;
    if (s.name.trim().toLowerCase() === nameLower) {
      return `Near-duplicate skill name: "${s.name}" (${s.id})`;
    }
    const other = (s.body ?? "").trim();
    if (other && jaccardTokenOverlap(body, other) >= 0.72) {
      return `Near-duplicate of skill "${s.name}" (${s.id})`;
    }
  }
  return null;
}

function listSkillsForGate(db: AppDatabase, agentId: string): SkillRow[] {
  try {
    return db
      .prepare(
        `SELECT id, name, body, status FROM ai_skills
         WHERE agent_id = ? OR agent_id IS NULL`
      )
      .all(agentId) as SkillRow[];
  } catch {
    return [];
  }
}

function hasPlaybookStructure(body: string): boolean {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let stepish = 0;
  for (const line of lines) {
    if (/^#{1,3}\s+\S/.test(line)) stepish++;
    else if (/^(\d+[.)]|[-*•]|Step\s+\d+)\s+\S/i.test(line)) stepish++;
    else if (/^(When|If|Then|Do|Run|Check|Verify|Ask|Open|Call|Use)\b/i.test(line)) {
      stepish++;
    }
  }
  return stepish >= 2;
}

function jaccardTokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}
