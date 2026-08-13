import { afterEach, describe, expect, it, vi } from "vitest";
import {
  githubHttpsAuthGitEnv,
  parseGithubHttpsRemote,
  redactRemoteUrl,
} from "../coding/git-host-auth.js";
import {
  createGithubPullRequest,
  resolveGithubRemoteFromUrl,
  stripCursorPrAttribution,
} from "../coding/github-pr.js";

describe("git-host-auth (#442)", () => {
  it("parses github.com HTTPS remotes and rejects SSH / other hosts", () => {
    expect(parseGithubHttpsRemote("https://github.com/Acme/Widget.git")).toEqual(
      {
        owner: "Acme",
        repo: "Widget",
        httpsUrl: "https://github.com/Acme/Widget.git",
      }
    );
    expect(parseGithubHttpsRemote("https://github.com/Acme/Widget")).toEqual({
      owner: "Acme",
      repo: "Widget",
      httpsUrl: "https://github.com/Acme/Widget.git",
    });
    expect(parseGithubHttpsRemote("git@github.com:Acme/Widget.git")).toBeNull();
    expect(
      parseGithubHttpsRemote("https://gitlab.com/Acme/Widget.git")
    ).toBeNull();
  });

  it("redacts embedded credentials from remote URLs", () => {
    expect(
      redactRemoteUrl("https://x-access-token:secret@github.com/Acme/Widget.git")
    ).toBe("https://github.com/Acme/Widget.git");
  });

  it("builds GIT_CONFIG env without putting the raw token in the header value plaintext", () => {
    const env = githubHttpsAuthGitEnv("tok_test_123");
    expect(env.GIT_CONFIG_COUNT).toBe("2");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^AUTHORIZATION: basic /);
    expect(env.GIT_CONFIG_VALUE_0).not.toContain("tok_test_123");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });
});

describe("github-pr (#442)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips Cursor attribution from PR title/body", () => {
    expect(
      stripCursorPrAttribution(
        "Fix bug\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\nMade with Cursor"
      )
    ).toBe("Fix bug");
  });

  it("resolves owner/repo from HTTPS remotes only", () => {
    expect(
      resolveGithubRemoteFromUrl("https://github.com/Acme/Widget.git")
    ).toMatchObject({ owner: "Acme", repo: "Widget" });
    expect(() =>
      resolveGithubRemoteFromUrl("git@github.com:Acme/Widget.git")
    ).toThrow(/https:\/\/github\.com/);
  });

  it("creates a pull request via the GitHub API", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        number: 42,
        html_url: "https://github.com/Acme/Widget/pull/42",
        state: "open",
        title: "Ship slice",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await createGithubPullRequest({
      accessToken: "tok",
      owner: "Acme",
      repo: "Widget",
      title: "Ship slice",
      body: "Part of #442",
      head: "feat/x",
      base: "main",
    });
    expect(res).toEqual({
      number: 42,
      url: "https://github.com/Acme/Widget/pull/42",
      htmlUrl: "https://github.com/Acme/Widget/pull/42",
      state: "open",
      title: "Ship slice",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/Acme/Widget/pulls");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("surfaces GitHub API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({ message: "Validation Failed" }),
      }))
    );
    await expect(
      createGithubPullRequest({
        accessToken: "tok",
        owner: "Acme",
        repo: "Widget",
        title: "x",
        head: "feat/x",
      })
    ).rejects.toThrow(/Validation Failed/);
  });
});
