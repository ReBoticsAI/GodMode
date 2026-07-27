/**
 * Layer 4 ephemeral build helpers (#164 / #112).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertBuildSupervisorUrl,
  assertEphemeralBuildReady,
  isAllowedBuildCommand,
  normalizeBuildCommand,
  runEphemeralBuild,
  sanitizeCwdRel,
} from "../coding/ephemeral-build.js";
import { config } from "../../config.js";

describe("ephemeral build allowlist", () => {
  it("accepts exact allowlisted commands", () => {
    expect(isAllowedBuildCommand("npm ci")).toBe(true);
    expect(normalizeBuildCommand("  npm   run  build  ")).toBe("npm run build");
  });

  it("rejects shell metacharacters and unknown commands", () => {
    expect(isAllowedBuildCommand("npm ci; rm -rf /")).toBe(false);
    expect(() => normalizeBuildCommand("bash -c evil")).toThrow(/not allowed/i);
  });

  it("rejects cwd escapes", () => {
    expect(sanitizeCwdRel("plugins/foo")).toBe("plugins/foo");
    expect(() => sanitizeCwdRel("../other")).toThrow(/escapes/i);
    expect(() => sanitizeCwdRel("C:\\Windows")).toThrow(/Invalid cwd/i);
  });
});

describe("build supervisor URL", () => {
  it("allows localhost hosts only over http", () => {
    expect(assertBuildSupervisorUrl("http://127.0.0.1:8792").hostname).toBe(
      "127.0.0.1"
    );
    expect(
      assertBuildSupervisorUrl("http://host.docker.internal:8792").hostname
    ).toBe("host.docker.internal");
    expect(() => assertBuildSupervisorUrl("https://127.0.0.1:8792")).toThrow(
      /local-host/i
    );
    expect(() => assertBuildSupervisorUrl("http://evil.example:8792")).toThrow(
      /local-host/i
    );
  });
});

describe("runEphemeralBuild fail-closed", () => {
  const prevMode = config.codingBuildMode;
  const prevUrl = config.codingBuildSupervisorUrl;
  const prevToken = config.codingBuildSupervisorToken;
  const prevNet = config.codingBuildNet;

  afterEach(() => {
    (config as { codingBuildMode: string }).codingBuildMode = prevMode;
    (config as { codingBuildSupervisorUrl: string }).codingBuildSupervisorUrl =
      prevUrl;
    (config as { codingBuildSupervisorToken: string }).codingBuildSupervisorToken =
      prevToken;
    (config as { codingBuildNet: string }).codingBuildNet = prevNet;
  });

  it("fails when mode is off", () => {
    (config as { codingBuildMode: string }).codingBuildMode = "off";
    expect(() => assertEphemeralBuildReady()).toThrow(/disabled/i);
  });

  it("fails when mode is ephemeral without token", () => {
    (config as { codingBuildMode: string }).codingBuildMode = "ephemeral";
    (config as { codingBuildSupervisorUrl: string }).codingBuildSupervisorUrl =
      "http://127.0.0.1:8792";
    (config as { codingBuildSupervisorToken: string }).codingBuildSupervisorToken =
      "";
    expect(() => assertEphemeralBuildReady()).toThrow(/fail closed|TOKEN/i);
  });

  it("posts to supervisor when configured", async () => {
    (config as { codingBuildMode: string }).codingBuildMode = "ephemeral";
    (config as { codingBuildSupervisorUrl: string }).codingBuildSupervisorUrl =
      "http://127.0.0.1:8792";
    (config as { codingBuildSupervisorToken: string }).codingBuildSupervisorToken =
      "secret-token";
    (config as { codingBuildNet: string }).codingBuildNet = "allowlist";

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          exitCode: 0,
          stdout: "ok\n",
          stderr: "",
          timedOut: false,
          durationMs: 12,
          command: "npm ci",
          cwdRel: ".",
          tenantId: "t1",
          image: "node:22-bookworm-slim",
          network: "allowlist",
          egressHosts: ["registry.npmjs.org"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import(
      "node:fs"
    );
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const root = mkdtempSync(join(tmpdir(), "gm-eph-"));
    try {
      mkdirSync(join(root, "pkg"), { recursive: true });
      writeFileSync(join(root, "pkg", "package.json"), "{}\n");
      const result = await runEphemeralBuild({
        tenantId: "t1",
        root,
        cwd: "pkg",
        command: "npm ci",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("ephemeral");
      expect(result.network).toBe("allowlist");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toContain("/v1/build");
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer secret-token",
      });
      const posted = JSON.parse(String((init as RequestInit).body));
      expect(posted.network).toBe("allowlist");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
