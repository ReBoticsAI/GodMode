/**
 * Fail-closed merge decision matrix for Core PRs (local maintainer Agents).
 */
import {
  corePrDoneAllowed,
  summarizePrChecks,
  type PrCheckSummary,
  type GhPrCheckRow,
} from "../github-pr-ci.js";

export const CORE_PR_MERGE_OWNER = "ReBoticsAI";
export const CORE_PR_MERGE_REPO = "GodMode";
export const CORE_PR_MERGE_BASE = "main";
export const CORE_PR_OK_TO_MERGE_LABEL = "maintainers:ok-to-merge";

/** Soft caps: oversized PRs need a human. */
export const CORE_PR_MAX_FILES = 40;
export const CORE_PR_MAX_CHANGED_LINES = 2000;

const FORBIDDEN_PATH =
  /(^|\/)(\.env|\.env\..*|credentials\.json|secrets?\/|id_rsa|\.pem$)|\bgodmode-plugin-(sierra|polymarket)\b|\/playbook-zones\/|from_sc|to_sc|\bpm_/i;

export type PrMergeFile = {
  filename: string;
  additions?: number;
  deletions?: number;
};

export type PrMergeGateInput = {
  owner: string;
  repo: string;
  baseRef: string;
  draft: boolean;
  state: string;
  merged: boolean;
  /** GitHub mergeable; null/undefined = unknown → fail closed. */
  mergeable: boolean | null | undefined;
  authorLogin: string;
  labels: string[];
  title: string;
  body: string;
  files: PrMergeFile[];
  checkSummary: PrCheckSummary;
  /** Lowercase logins allowed without ok-to-merge label. */
  authorAllowlist: string[];
};

export type PrMergeGateResult = {
  ok: boolean;
  reasons: string[];
};

export function parseAuthorAllowlist(raw: string | undefined | null): string[] {
  return String(raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function forbiddenPathHit(filename: string): boolean {
  return FORBIDDEN_PATH.test(filename.replace(/\\/g, "/"));
}

export function evaluateCorePrMergeMatrix(
  input: PrMergeGateInput
): PrMergeGateResult {
  const reasons: string[] = [];
  const owner = input.owner.trim();
  const repo = input.repo.trim().replace(/\.git$/i, "");
  if (
    owner.toLowerCase() !== CORE_PR_MERGE_OWNER.toLowerCase() ||
    repo.toLowerCase() !== CORE_PR_MERGE_REPO.toLowerCase()
  ) {
    reasons.push(
      `Only ${CORE_PR_MERGE_OWNER}/${CORE_PR_MERGE_REPO} may be merged by this tool`
    );
  }
  const base = String(input.baseRef ?? "")
    .replace(/^refs\/heads\//, "")
    .trim();
  if (base !== CORE_PR_MERGE_BASE) {
    reasons.push(`Base must be ${CORE_PR_MERGE_BASE} (got ${base || "empty"})`);
  }
  if (input.draft) reasons.push("Draft PRs cannot be merged");
  if (input.merged) reasons.push("PR is already merged");
  if (String(input.state ?? "").toLowerCase() !== "open") {
    reasons.push(`PR state must be open (got ${input.state || "empty"})`);
  }
  if (input.mergeable !== true) {
    reasons.push(
      input.mergeable === false
        ? "PR is not mergeable (conflicts or blocked)"
        : "mergeable state unknown; fail closed"
    );
  }
  if (!corePrDoneAllowed(input.checkSummary)) {
    reasons.push(
      `CI gate failed: state=${input.checkSummary.state} pending=${input.checkSummary.pending} failed=${input.checkSummary.failed}`
    );
  }
  if (input.checkSummary.total === 0) {
    reasons.push("No CI checks reported; fail closed");
  }

  const files = Array.isArray(input.files) ? input.files : [];
  if (files.length === 0) {
    reasons.push("PR file list empty; fail closed");
  }
  if (files.length > CORE_PR_MAX_FILES) {
    reasons.push(`Too many files (${files.length} > ${CORE_PR_MAX_FILES})`);
  }
  let changedLines = 0;
  for (const f of files) {
    const name = String(f.filename ?? "");
    if (!name) continue;
    if (forbiddenPathHit(name)) {
      reasons.push(`Forbidden path in diff: ${name}`);
    }
    changedLines +=
      Math.max(0, Number(f.additions) || 0) +
      Math.max(0, Number(f.deletions) || 0);
  }
  if (changedLines > CORE_PR_MAX_CHANGED_LINES) {
    reasons.push(
      `Diff too large (${changedLines} lines > ${CORE_PR_MAX_CHANGED_LINES})`
    );
  }

  const labels = (input.labels ?? []).map((l) => l.toLowerCase());
  const okLabel = labels.includes(CORE_PR_OK_TO_MERGE_LABEL.toLowerCase());
  const author = String(input.authorLogin ?? "")
    .trim()
    .toLowerCase();
  const allow = new Set(
    (input.authorAllowlist ?? []).map((a) => a.trim().toLowerCase())
  );
  if (!author) {
    reasons.push("Author login missing; fail closed");
  } else if (!okLabel && !allow.has(author)) {
    reasons.push(
      `Author @${author} not on allowlist and missing label ${CORE_PR_OK_TO_MERGE_LABEL}`
    );
  }

  const blob = `${input.title}\n${input.body ?? ""}`;
  if (/Co-authored-by:\s*Cursor|Made-with:\s*Cursor|Made with Cursor/i.test(blob)) {
    reasons.push("PR title/body still contains Cursor attribution trailers");
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(blob)) {
    reasons.push("PR title/body looks like it contains an email (PII)");
  }

  return { ok: reasons.length === 0, reasons };
}

export function checkSummaryFromGhRows(rows: GhPrCheckRow[]): PrCheckSummary {
  return summarizePrChecks(rows);
}
