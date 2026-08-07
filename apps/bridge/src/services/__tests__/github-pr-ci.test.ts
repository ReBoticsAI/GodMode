import { describe, expect, it } from "vitest";
import {
  GH_PR_CHECKS_ALLOWED_JSON_FIELDS,
  GH_PR_CHECKS_JSON_FIELDS,
  GH_PR_CHECKS_JSON_FIELDS_CSV,
  corePrDoneAllowed,
  summarizePrChecks,
} from "../github-pr-ci.js";

describe("GH_PR_CHECKS_JSON_FIELDS", () => {
  it("only uses fields documented by gh pr checks --json", () => {
    for (const field of GH_PR_CHECKS_JSON_FIELDS) {
      expect(GH_PR_CHECKS_ALLOWED_JSON_FIELDS.has(field)).toBe(true);
    }
  });

  it("does not request conclusion (Unknown JSON field regression)", () => {
    expect(GH_PR_CHECKS_JSON_FIELDS).not.toContain("conclusion");
    expect(GH_PR_CHECKS_JSON_FIELDS_CSV).not.toMatch(/\bconclusion\b/);
    expect(GH_PR_CHECKS_JSON_FIELDS_CSV).toBe("name,state,bucket,link");
  });
});

describe("summarizePrChecks", () => {
  it("is pending when any check is in progress", () => {
    const s = summarizePrChecks([
      { name: "a", state: "SUCCESS", conclusion: "success" },
      { name: "b", state: "IN_PROGRESS", conclusion: null },
    ]);
    expect(s.state).toBe("pending");
    expect(corePrDoneAllowed(s)).toBe(false);
  });

  it("is failure when any check failed", () => {
    const s = summarizePrChecks([
      { name: "a", state: "COMPLETED", conclusion: "failure" },
      { name: "b", state: "SUCCESS", conclusion: "success" },
    ]);
    expect(s.state).toBe("failure");
    expect(corePrDoneAllowed(s)).toBe(false);
  });

  it("is success when all checks passed", () => {
    const s = summarizePrChecks([
      { name: "a", state: "SUCCESS", conclusion: "success" },
      { name: "b", state: "COMPLETED", conclusion: "skipped" },
    ]);
    expect(s.state).toBe("success");
    expect(corePrDoneAllowed(s)).toBe(true);
  });

  it("accepts gh pr checks rows (state + bucket, no conclusion)", () => {
    const pending = summarizePrChecks([
      { name: "validate", state: "IN_PROGRESS", bucket: "pending", link: "https://example/1" },
      { name: "pages", state: "IN_PROGRESS", bucket: "pending", link: "https://example/2" },
    ]);
    expect(pending.state).toBe("pending");
    expect(pending.details[0]?.url).toBe("https://example/1");

    const green = summarizePrChecks([
      { name: "validate", state: "SUCCESS", bucket: "pass", link: "https://example/3" },
      { name: "pages", state: "SUCCESS", bucket: "pass", link: "https://example/4" },
    ]);
    expect(green.state).toBe("success");
    expect(corePrDoneAllowed(green)).toBe(true);

    const failed = summarizePrChecks([
      { name: "validate", state: "FAILURE", bucket: "fail", link: "https://example/5" },
      { name: "pages", state: "SUCCESS", bucket: "pass", link: "https://example/6" },
    ]);
    expect(failed.state).toBe("failure");
    expect(corePrDoneAllowed(failed)).toBe(false);
  });
});
