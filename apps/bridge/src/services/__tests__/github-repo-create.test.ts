/**
 * github_repo_create: public repo via Connect; never delete; refuse platform org.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNotPlatformGithubOwner,
  assertSafeGithubRepoName,
  createGithubRepository,
  isPlatformGithubOwner,
} from "../coding/github-repo-create.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("assertSafeGithubRepoName", () => {
  it("accepts typical plugin repo names", () => {
    expect(assertSafeGithubRepoName("community-ping")).toBe("community-ping");
    expect(assertSafeGithubRepoName("My_Plugin.1")).toBe("My_Plugin.1");
  });

  it("rejects empty, path-like, and illegal names", () => {
    expect(() => assertSafeGithubRepoName("")).toThrow(/required/i);
    expect(() => assertSafeGithubRepoName("..")).toThrow(/invalid/i);
    expect(() => assertSafeGithubRepoName("has space")).toThrow(/letters/i);
    expect(() => assertSafeGithubRepoName("-lead")).toThrow(/letters/i);
  });
});

describe("platform GitHub owner guard", () => {
  it("treats ReBoticsAI as the platform account by default", () => {
    expect(isPlatformGithubOwner("ReBoticsAI")).toBe(true);
    expect(isPlatformGithubOwner("reboticsai")).toBe(true);
    expect(isPlatformGithubOwner("alice")).toBe(false);
    expect(() => assertNotPlatformGithubOwner("ReBoticsAI")).toThrow(
      /platform GitHub account/i
    );
  });
});

describe("createGithubRepository", () => {
  it("creates a public repo under the connected user and never calls DELETE", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (url.endsWith("/user") && method === "GET") {
        return new Response(JSON.stringify({ login: "alice" }), { status: 200 });
      }
      if (url.endsWith("/user/repos") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { private?: boolean };
        expect(body.private).toBe(false);
        return new Response(
          JSON.stringify({
            name: "community-ping",
            full_name: "alice/community-ping",
            html_url: "https://github.com/alice/community-ping",
            clone_url: "https://github.com/alice/community-ping.git",
            private: false,
            default_branch: "main",
            owner: { login: "alice" },
          }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), {
        status: 500,
      });
    }) as typeof fetch;

    const created = await createGithubRepository({
      accessToken: "ghu_test",
      name: "community-ping",
      description: "Tiny Community ping plugin",
    });
    expect(created.fullName).toBe("alice/community-ping");
    expect(created.private).toBe(false);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(calls.map((c) => c.method + " " + c.url)).toEqual([
      "GET https://api.github.com/user",
      "POST https://api.github.com/user/repos",
    ]);
  });

  it("refuses the platform org before any create request", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(JSON.stringify({ login: "alice" }), { status: 200 });
    }) as typeof fetch;

    await expect(
      createGithubRepository({
        accessToken: "ghu_test",
        name: "community-ping",
        owner: "ReBoticsAI",
      })
    ).rejects.toThrow(/platform GitHub account/i);
    expect(calls).toEqual([]);
  });

  it("refuses when the connected login is the platform account", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/user") && method === "GET") {
        return new Response(JSON.stringify({ login: "ReBoticsAI" }), {
          status: 200,
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }) as typeof fetch;

    await expect(
      createGithubRepository({
        accessToken: "ghu_test",
        name: "community-ping",
      })
    ).rejects.toThrow(/platform GitHub account/i);
  });
});
