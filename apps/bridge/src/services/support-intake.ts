/**
 * Support Bug intake routing for weak tool-followers (e.g. Z.AI).
 *
 * Product flow is gather → ask_user_choice (Log vs Handoff) → report_platform_issue.
 * This module supplies: job-1 choice defaults, signup-only tool stripping,
 * and model-only path briefs so filing is not improvised via wiki/guide tools.
 */

/** Default Log vs Handoff buttons for Support job 1 (before filing). */
export const SUPPORT_JOB1_OPTIONS = [
  {
    id: "log_bug",
    label: "Log bug for developers",
  },
  {
    id: "handoff_coding",
    label: "Hand off to a coding subagent",
  },
] as const;

export const SUPPORT_JOB1_QUESTION =
  "How should we handle this bug?";

export const SUPPORT_JOB1_WHY =
  "Log files a GitHub issue only. Hand off files an issue first, then a coding subagent can open a focused fix PR for maintainers (we will not merge).";

/** Signup-only guide tools that must not appear on normal Intelligence turns. */
export const SIGNUP_ONLY_GUIDE_TOOLS = ["ask_guide_choice"] as const;

const SIGNUP_ONLY_GUIDE_SET = new Set<string>(SIGNUP_ONLY_GUIDE_TOOLS);

export function isSignupOnlyGuideTool(name: string): boolean {
  return SIGNUP_ONLY_GUIDE_SET.has(name);
}

/** Drop signup-only guide tools from normal (non-signup) chat schemas. */
export function filterSchemasOutsideSignupGuide<
  T extends { function: { name: string } },
>(schemas: T[]): T[] {
  return schemas.filter((s) => !isSignupOnlyGuideTool(s.function.name));
}

const BUG_PILL_MARKERS = [
  "i tapped the bug pill",
  "use the support skill (job 1)",
];

export function isSupportBugIntakeMessage(text: string | undefined | null): boolean {
  const lower = String(text ?? "").toLowerCase();
  if (!lower.trim()) return false;
  return BUG_PILL_MARKERS.some((m) => lower.includes(m));
}

export const SUPPORT_BUG_HARNESS_DELTA = [
  "<support_bug_intake>",
  "This turn is Support job 1 (OSS / product bug). Follow use_skill('support') if not already loaded.",
  "Never call ask_guide_choice, open_guide_surface, play_graph_tour, or wiki tools for this bug.",
  "Gather in 1–3 short turns if expected vs actual / repro is unclear. Do not file yet during gather.",
  "Then call ask_user_choice once with Log bug for developers vs Hand off to a coding subagent (do not invent Yes/No PR wording).",
  "After the user picks Log or Handoff, your next tool must be report_platform_issue (subject/body from notes + screenshot). Return the issue URL.",
  "On Handoff only: after report_platform_issue succeeds, continue with Vault GitHub Connect → coding subagent / fork+PR. Never merge.",
  "</support_bug_intake>",
].join("\n");

/**
 * Model-only brief after a Support choice button. Stored user message stays the label.
 * Returns null for non-Support path ids.
 */
export function supportPathModelGuide(id: string): string | null {
  const bodies: Record<string, string> = {
    log_bug: [
      "Support job 1: the user chose Log bug for developers.",
      "Immediately call report_platform_issue with subject/body from the gathered notes and screenshot (images or turn screenshots).",
      "Return the GitHub URL and stop. Do not start coding. Do not call ask_guide_choice, wiki, or open_guide_surface.",
    ].join(" "),
    handoff_coding: [
      "Support job 1: the user chose Hand off to a coding subagent.",
      "First call report_platform_issue with subject/body from the gathered notes and screenshot.",
      "Keep the issue URL, then require Vault GitHub Connect and continue fork/PR handoff per the Support skill. Never merge.",
      "Do not call ask_guide_choice, wiki, or open_guide_surface.",
    ].join(" "),
    // Legacy Yes/No PR defaults (pre job-1 Log/Handoff). Still file or hand off clearly.
    yes_offer_pr: [
      "The user wants a Core fix PR offer.",
      "If no GitHub issue exists yet this turn, call report_platform_issue first, then continue handoff (fork/PR). Never merge.",
      "Do not call ask_guide_choice or wiki tools.",
    ].join(" "),
    no_thanks: [
      "The user declined a Core fix PR.",
      "If no GitHub issue exists yet this turn, call report_platform_issue now, return the URL, and stop.",
      "Do not call ask_guide_choice or wiki tools.",
    ].join(" "),
    support_bug: SUPPORT_BUG_HARNESS_DELTA,
  };
  return bodies[id] ?? null;
}

export function resolveSupportIntakeGuide(opts: {
  pathId?: string | null;
  userMessage?: string | null;
}): string | null {
  const fromPath = opts.pathId ? supportPathModelGuide(opts.pathId) : null;
  if (fromPath) return fromPath;
  if (isSupportBugIntakeMessage(opts.userMessage)) {
    return SUPPORT_BUG_HARNESS_DELTA;
  }
  return null;
}
