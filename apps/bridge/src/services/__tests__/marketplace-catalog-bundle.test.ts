import { describe, expect, it } from "vitest";
import { githubRawContentUrl } from "../marketplace-catalog.js";

describe("githubRawContentUrl", () => {
  it("builds a pinned raw GitHub URL for a pack bundle", () => {
    expect(
      githubRawContentUrl(
        "https://github.com/alice/weekly-review-pack.git",
        "abcdef1",
        "bundle.json"
      )
    ).toBe("https://raw.githubusercontent.com/alice/weekly-review-pack/abcdef1/bundle.json");
  });
});
