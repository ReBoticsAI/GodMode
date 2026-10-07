import { describe, expect, it } from "vitest";
import {
  CORE_PR_MAX_CHANGED_LINES,
  CORE_PR_MAX_FILES,
  CORE_PR_OK_TO_MERGE_LABEL,
  evaluateCorePrMergeMatrix,
  forbiddenPathHit,
  parseAuthorAllowlist,
} from "../coding/github-pr-merge.js";
import type { PrCheckSummary } from "../github-pr-ci.js";

const green: PrCheckSummary = {
  state: "success",
  total: 3,
  pending: 0,
  failed: 0,
  passed: 3,
  details: [],
};

function baseInput(
  overrides: Partial<Parameters<typeof evaluateCorePrMergeMatrix>[0]> = {}
) {
  return {
    owner: "ReBoticsAI",
    repo: "GodMode",
    baseRef: "main",
    draft: false,
    state: "open",
    merged: false,
    mergeable: true as boolean | null,
    authorLogin: "maintainer",
    labels: [] as string[],
    title: "fix: graph capture",
    body: "Fixes #1234\n\nRepro: tap Bug pill.",
    files: [{ filename: "apps/web/src/lib/capture-page-screenshot.ts", additions: 10, deletions: 2 }],
    checkSummary: green,
    authorAllowlist: ["maintainer"],
    ...overrides,
  };
}

describe("evaluateCorePrMergeMatrix", () => {
  it("passes a green allowlisted PR", () => {
    const r = evaluateCorePrMergeMatrix(baseInput());
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("fails closed on pending CI", () => {
    const r = evaluateCorePrMergeMatrix(
      baseInput({
        checkSummary: {
          state: "pending",
          total: 2,
          pending: 1,
          failed: 0,
          passed: 1,
          details: [],
        },
      })
    );
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/CI gate/i);
  });

  it("fails closed with zero checks", () => {
    const r = evaluateCorePrMergeMatrix(
      baseInput({
        checkSummary: {
          state: "unknown",
          total: 0,
          pending: 0,
          failed: 0,
          passed: 0,
          details: [],
        },
      })
    );
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/No CI checks/i);
  });

  it("rejects drafts and non-main base", () => {
    expect(evaluateCorePrMergeMatrix(baseInput({ draft: true })).ok).toBe(false);
    expect(
      evaluateCorePrMergeMatrix(baseInput({ baseRef: "develop" })).ok
    ).toBe(false);
  });

  it("rejects forbidden paths and oversized diffs", () => {
    expect(forbiddenPathHit(".env")).toBe(true);
    expect(forbiddenPathHit("apps/bridge/src/x.ts")).toBe(false);
    const secrets = evaluateCorePrMergeMatrix(
      baseInput({
        files: [{ filename: "apps/bridge/.env.local", additions: 1, deletions: 0 }],
      })
    );
    expect(secrets.ok).toBe(false);
    expect(secrets.reasons.join(" ")).toMatch(/Forbidden path/i);

    const many = evaluateCorePrMergeMatrix(
      baseInput({
        files: Array.from({ length: CORE_PR_MAX_FILES + 1 }, (_, i) => ({
          filename: `apps/web/src/f${i}.ts`,
          additions: 1,
          deletions: 0,
        })),
      })
    );
    expect(many.ok).toBe(false);

    const huge = evaluateCorePrMergeMatrix(
      baseInput({
        files: [
          {
            filename: "apps/web/src/big.ts",
            additions: CORE_PR_MAX_CHANGED_LINES + 1,
            deletions: 0,
          },
        ],
      })
    );
    expect(huge.ok).toBe(false);
  });

  it("allows stranger authors only with ok-to-merge label", () => {
    const denied = evaluateCorePrMergeMatrix(
      baseInput({ authorLogin: "random-user", authorAllowlist: ["maintainer"] })
    );
    expect(denied.ok).toBe(false);
    expect(denied.reasons.join(" ")).toMatch(/allowlist/i);

    const labeled = evaluateCorePrMergeMatrix(
      baseInput({
        authorLogin: "random-user",
        authorAllowlist: ["maintainer"],
        labels: [CORE_PR_OK_TO_MERGE_LABEL],
      })
    );
    expect(labeled.ok).toBe(true);
  });

  it("rejects Cursor attribution and emails in body", () => {
    expect(
      evaluateCorePrMergeMatrix(
        baseInput({ body: "Made with Cursor\n\nFixes #1" })
      ).ok
    ).toBe(false);
    expect(
      evaluateCorePrMergeMatrix(
        baseInput({ body: "Contact person@example.com" })
      ).ok
    ).toBe(false);
  });

  it("parses author allowlist", () => {
    expect(parseAuthorAllowlist("Alice, Bob ;carol")).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });
});
