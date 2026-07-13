import type { AppDatabase } from "../db.js";
import { getCoreDb } from "../core-db.js";
import type { LlmManager } from "./llm-manager.js";
import { createWikiProposal } from "./wiki-proposals.js";

export interface WikiSynthesizeResult {
  ok: boolean;
  skipped?: string;
  proposalIds?: string[];
}

/**
 * Propose wiki create/update patches from recent approved episode memories + globals.
 * Never writes pages directly — operators approve via wiki proposals inbox.
 */
export async function runWikiSynthesize(opts: {
  db: AppDatabase;
  llm: LlmManager;
  tenantId: string;
  agentId?: string;
}): Promise<WikiSynthesizeResult> {
  const { db, llm, tenantId } = opts;
  if (!llm.isReady()) return { ok: false, skipped: "llm_not_ready" };

  const agentId = opts.agentId ?? "intelligence";
  const memories = db
    .prepare(
      `SELECT text, category, source FROM ai_memories
       WHERE enabled = 1 AND status = 'active' AND agent_id = ?
         AND (category = 'episode' OR source IN ('distill', 'reflection', 'manual'))
       ORDER BY updated_at DESC LIMIT 40`
    )
    .all(agentId) as Array<{ text: string; category: string | null; source: string }>;

  if (memories.length < 3) {
    return { ok: false, skipped: "insufficient_memories" };
  }

  const core = getCoreDb();
  const existing = core
    .prepare(
      `SELECT id, space, slug, title FROM wiki_pages
       WHERE tenant_id = ? AND visibility = 'internal'
         AND (space IN ('knowledge', 'decisions') OR space IS NULL)
       ORDER BY updated_at DESC LIMIT 30`
    )
    .all(tenantId) as Array<{ id: string; space: string | null; slug: string; title: string }>;

  const memBlock = memories.map((m, i) => `${i + 1}. [${m.category ?? m.source}] ${m.text}`).join("\n");
  const pageBlock =
    existing.length === 0
      ? "(no pages yet — prefer create under knowledge/ or decisions/)"
      : existing.map((p) => `- id=${p.id} space=${p.space ?? ""} slug=${p.slug} title=${p.title}`).join("\n");

  const prompt = [
    "Consolidate the following memories into durable wiki pages humans can edit.",
    "Prefer updating knowledge/* and decisions/* over creating many new pages.",
    "Never dump raw chat transcripts. Merge themes.",
    "Return JSON only:",
    '{"proposals":[{"action":"create"|"update","space":"knowledge"|"decisions",',
    '"slug":"optional","title":"...","markdown":"...","targetPageId":"required for update","reason":"..."}]}',
    "Emit 0–3 proposals. Empty array if nothing durable.",
    "",
    "EXISTING PAGES:",
    pageBlock,
    "",
    "MEMORIES:",
    memBlock,
  ].join("\n");

  let proposals: Array<{
    action?: string;
    space?: string;
    slug?: string;
    title?: string;
    markdown?: string;
    targetPageId?: string;
    reason?: string;
  }> = [];

  try {
    const sampling = llm.getSamplingParams(db);
    const res = await fetch(`${llm.getServerBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        messages: [
          {
            role: "system",
            content:
              "You synthesize wiki page proposals. Reply with JSON only. No markdown fences.",
          },
          { role: "user", content: prompt },
        ],
        stream: false,
        temperature: 0.25,
        top_p: sampling.topP,
        max_tokens: 2000,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(extractJson(raw)) as { proposals?: typeof proposals };
    proposals = Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, 3) : [];
  } catch (err) {
    return {
      ok: false,
      skipped: `llm_parse:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const proposalIds: string[] = [];
  for (const p of proposals) {
    const title = String(p.title ?? "").trim();
    const markdown = String(p.markdown ?? "").trim();
    if (!title || !markdown) continue;
    const action = p.action === "update" ? "update" : "create";
    if (action === "update" && !p.targetPageId) continue;
    const space =
      p.space === "decisions" || p.space === "knowledge" ? p.space : "knowledge";
    const row = createWikiProposal(
      {
        tenantId,
        action,
        title,
        bodyMarkdown: markdown,
        space,
        slug: p.slug ? String(p.slug) : null,
        targetPageId: p.targetPageId ? String(p.targetPageId) : null,
        reason: p.reason ? String(p.reason) : null,
        source: "synthesize",
      },
      core
    );
    proposalIds.push(row.id);
  }

  return { ok: true, proposalIds };
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
