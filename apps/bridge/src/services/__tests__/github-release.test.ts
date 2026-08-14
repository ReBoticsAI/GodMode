import { describe, expect, it } from "vitest";
import {
  formatGithubReleasePermissionError,
  isGithubIntegrationPermissionError,
  prepareGithubRelease,
} from "../coding/github-release.js";

describe("prepareGithubRelease", () => {
  it("stages a draft payload with stripped attribution", () => {
    const staged = prepareGithubRelease({
      owner: "Acme",
      repo: "demo.git",
      tag: "v1.0.0",
      name: "Ship\nCo-authored-by: Cursor <cursor@cursor.com>",
      body: "Notes\nMade with Cursor",
      draft: true,
      assets: [{ name: "notes.txt", contentBase64: Buffer.from("hi").toString("base64") }],
    });
    expect(staged.owner).toBe("Acme");
    expect(staged.repo).toBe("demo");
    expect(staged.tag).toBe("v1.0.0");
    expect(staged.draft).toBe(true);
    expect(staged.staged).toBe(true);
    expect(staged.assetCount).toBe(1);
    expect(staged.name).not.toMatch(/Cursor/i);
    expect(staged.body).not.toMatch(/Cursor/i);
    expect(staged.summary).toMatch(/Draft release v1\.0\.0/);
  });

  it("rejects unsafe tags", () => {
    expect(() =>
      prepareGithubRelease({
        owner: "a",
        repo: "b",
        tag: "../evil",
      })
    ).toThrow(/invalid/);
  });
});

describe("GitHub integration permission errors", () => {
  it("detects Resource not accessible by integration", () => {
    expect(
      isGithubIntegrationPermissionError(
        "GitHub release create failed: Resource not accessible by integration"
      )
    ).toBe(true);
    expect(isGithubIntegrationPermissionError("network timeout")).toBe(false);
  });

  it("rewrites failures with Contents write reconnect guidance", () => {
    const msg = formatGithubReleasePermissionError(
      "GitHub release create failed: Resource not accessible by integration"
    );
    expect(msg).toMatch(/Contents write/i);
    expect(msg).toMatch(/Vault/i);
    expect(formatGithubReleasePermissionError("other failure")).toBe(
      "other failure"
    );
  });
});
