/**
 * Installation pick for Vault Connect must not default to the platform org (#456).
 */
import { describe, expect, it } from "vitest";
import { pickGithubInstallationId } from "../github-app.js";

describe("pickGithubInstallationId", () => {
  const platform = { id: 150588979, accountLogin: "ReBoticsAI" };
  const personal = { id: 99, accountLogin: "alice" };

  it("matches the OAuth login account", () => {
    expect(pickGithubInstallationId([platform, personal], "alice")).toBe(99);
    expect(pickGithubInstallationId([platform, personal], "ReBoticsAI")).toBe(
      150588979
    );
  });

  it("does not fall back to the first install when login is unmatched", () => {
    expect(pickGithubInstallationId([platform, personal], "other")).toBeNull();
    expect(pickGithubInstallationId([platform, personal], null)).toBeNull();
    expect(pickGithubInstallationId([platform, personal], "")).toBeNull();
  });

  it("allows a sole user-visible install when login is missing", () => {
    expect(pickGithubInstallationId([personal], undefined)).toBe(99);
  });

  it("returns null when there are no installs", () => {
    expect(pickGithubInstallationId([], "alice")).toBeNull();
  });
});
