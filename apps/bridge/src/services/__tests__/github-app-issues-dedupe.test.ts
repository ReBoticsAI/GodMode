import { describe, expect, it } from "vitest";
import {
  ISSUE_DEDUPE_TITLE_SCORE,
  titleSimilarity,
} from "../github-app-issues.js";

describe("titleSimilarity (GitHub issue dedupe)", () => {
  it("scores near-duplicate titles above the dedupe threshold", () => {
    const score = titleSimilarity(
      "Login Explore shows for signed-in users",
      "Login explore shows for signed in users"
    );
    expect(score).toBeGreaterThanOrEqual(ISSUE_DEDUPE_TITLE_SCORE);
  });

  it("scores unrelated titles below the threshold", () => {
    const score = titleSimilarity(
      "Login Explore empty state",
      "Marketplace Stripe webhook timeout"
    );
    expect(score).toBeLessThan(ISSUE_DEDUPE_TITLE_SCORE);
  });
});
