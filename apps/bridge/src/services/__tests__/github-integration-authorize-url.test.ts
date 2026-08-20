/**
 * Connect authorize URL must use user OAuth, not App install URL (#266).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { configState } = vi.hoisted(() => ({
  configState: {
    auth: { publicUrl: "https://app.example.test" },
    githubApp: {
      clientId: "Iv1.app-client",
      clientSecret: "app-secret",
      appId: "12345",
      privateKey: "",
      privateKeyPath: "",
      slug: "godmode-cloud",
    },
    oauth: {
      github: { clientId: "", clientSecret: "" },
      githubIntegration: {
        clientId: "Iv1.oauth-client",
        clientSecret: "oauth-secret",
      },
    },
    holdings: {
      secretKey: "a".repeat(64),
      secretKeyPath: "/tmp/unused-holdings.key",
    },
  },
}));

vi.mock("../../config.js", () => ({
  config: configState,
}));

import {
  beginGithubIntegrationConnect,
  buildGithubIntegrationAuthorizeUrl,
  takeGithubIntegrationOauthPending,
} from "../github-integration.js";

describe("buildGithubIntegrationAuthorizeUrl", () => {
  beforeEach(() => {
    configState.githubApp.clientId = "Iv1.app-client";
    configState.githubApp.clientSecret = "app-secret";
    configState.oauth.githubIntegration.clientId = "Iv1.oauth-client";
    configState.oauth.githubIntegration.clientSecret = "oauth-secret";
  });

  it("uses /login/oauth/authorize when GitHub App OAuth is configured", () => {
    const url = new URL(buildGithubIntegrationAuthorizeUrl("state-abc"));
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(url.searchParams.get("client_id")).toBe("Iv1.app-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.test/api/integrations/github/callback"
    );
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.pathname).not.toContain("/apps/");
    expect(url.pathname).not.toContain("installations");
  });

  it("sets classic OAuth scopes when falling back to OAuth App", () => {
    configState.githubApp.clientId = "";
    configState.githubApp.clientSecret = "";
    const url = new URL(buildGithubIntegrationAuthorizeUrl("state-oauth"));
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(url.searchParams.get("client_id")).toBe("Iv1.oauth-client");
    expect(url.searchParams.get("scope")).toContain("project");
  });

  it("stores and consumes connect state for the OAuth callback (#603 P1b)", () => {
    const { url } = beginGithubIntegrationConnect("user-smoke-1");
    expect(url).toContain("github.com/login/oauth/authorize");
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();
    expect(takeGithubIntegrationOauthPending(state!)).toEqual({
      userId: "user-smoke-1",
    });
    expect(takeGithubIntegrationOauthPending(state!)).toBeNull();
  });
});
