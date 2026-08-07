/**
 * GitHub PR check status helpers for Core CI babysitting.
 *
 * `gh pr checks --json` fields (see `gh pr checks --help`):
 *   bucket, completedAt, description, event, link, name, startedAt, state, workflow
 *
 * There is no `conclusion` field. Requesting it fails with:
 *   Unknown JSON field: "conclusion"
 */

/** Fields passed to `gh pr checks --json`. Must stay within GH_PR_CHECKS_ALLOWED_JSON_FIELDS. */
export const GH_PR_CHECKS_JSON_FIELDS = [
  "name",
  "state",
  "bucket",
  "link",
] as const;

export const GH_PR_CHECKS_JSON_FIELDS_CSV = GH_PR_CHECKS_JSON_FIELDS.join(",");

/** Allowlist from `gh pr checks --help` JSON FIELDS (regression guard). */
export const GH_PR_CHECKS_ALLOWED_JSON_FIELDS = new Set([
  "bucket",
  "completedAt",
  "description",
  "event",
  "link",
  "name",
  "startedAt",
  "state",
  "workflow",
]);

export type PrCheckState = "pending" | "success" | "failure" | "unknown";

export type PrCheckSummary = {
  state: PrCheckState;
  total: number;
  pending: number;
  failed: number;
  passed: number;
  details: Array<{ name: string; state: string; url?: string }>;
};

export type GhPrCheckRow = {
  name?: string;
  state?: string;
  /** gh categorizes state into pass | fail | pending | skipping | cancel */
  bucket?: string | null;
  link?: string;
  html_url?: string;
  detailsUrl?: string;
  /** Optional normalized outcome (not a `gh pr checks --json` field). */
  conclusion?: string | null;
};

function bucketToConclusion(bucket: string): string | null {
  if (bucket === "fail" || bucket === "cancel") return "failure";
  if (bucket === "pass" || bucket === "skipping") return "success";
  return null;
}

/**
 * Normalize `gh pr checks --json` rows (state + bucket + link) into a single gate state.
 * success only when every check completed successfully (or skipped/neutral).
 */
export function summarizePrChecks(
  rows: GhPrCheckRow[] | null | undefined
): PrCheckSummary {
  const list = Array.isArray(rows) ? rows : [];
  const details = list.map((r) => {
    const bucket = String(r.bucket ?? "").toLowerCase();
    return {
      name: String(r.name ?? "check"),
      state: String(r.state ?? r.bucket ?? r.conclusion ?? "unknown"),
      url: r.html_url ?? r.link ?? r.detailsUrl,
      bucket,
    };
  });
  if (!list.length) {
    return {
      state: "unknown",
      total: 0,
      pending: 0,
      failed: 0,
      passed: 0,
      details: details.map(({ name, state, url }) => ({ name, state, url })),
    };
  }
  let pending = 0;
  let failed = 0;
  let passed = 0;
  for (const r of list) {
    const state = String(r.state ?? "").toLowerCase();
    const bucket = String(r.bucket ?? "").toLowerCase();
    const conclusion = String(
      r.conclusion ?? bucketToConclusion(bucket) ?? ""
    ).toLowerCase();

    if (
      bucket === "pending" ||
      state === "pending" ||
      state === "queued" ||
      state === "in_progress" ||
      state === "expected" ||
      (!conclusion && (state === "pending" || (!state && !bucket)))
    ) {
      pending += 1;
      continue;
    }
    if (
      bucket === "fail" ||
      bucket === "cancel" ||
      conclusion === "failure" ||
      conclusion === "timed_out" ||
      conclusion === "cancelled" ||
      conclusion === "action_required" ||
      state === "failure" ||
      state === "fail"
    ) {
      failed += 1;
      continue;
    }
    // success, neutral, skipped, pass
    passed += 1;
  }
  let gate: PrCheckState = "success";
  if (failed > 0) gate = "failure";
  else if (pending > 0) gate = "pending";
  else if (passed === 0) gate = "unknown";
  return {
    state: gate,
    total: list.length,
    pending,
    failed,
    passed,
    details: details.map(({ name, state, url }) => ({ name, state, url })),
  };
}

/** Whether Done / issue close is allowed for a Core PR. */
export function corePrDoneAllowed(summary: PrCheckSummary): boolean {
  return summary.state === "success";
}
