/**
 * cursor_cloud MCP pass-through on create/send (#71).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCursorSdkAgentOptions,
  clearCursorCloudAgentCacheForTests,
  cursorCloudCacheFingerprint,
  resolveCursorSdkAgent,
} from "../agents/cursor-cloud-backend.js";
import {
  cursorMcpServersFingerprint,
  loadCursorMcpServersForSdk,
} from "../coding/cursor-mcp-config.js";

const temps: string[] = [];

afterEach(() => {
  clearCursorCloudAgentCacheForTests();
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-mcp-sdk-"));
  temps.push(dir);
  return dir;
}

describe("buildCursorSdkAgentOptions mcpServers", () => {
  it("includes top-level mcpServers when provided", () => {
    const cwd = tempRoot();
    mkdirSync(join(cwd, ".cursor"));
    const opts = buildCursorSdkAgentOptions({
      apiKey: "k",
      modelId: "auto",
      mode: "agent",
      cwd,
      mcpServers: {
        demo: { type: "stdio", command: "node", args: ["s.js"] },
      },
    });
    expect(opts.mcpServers).toEqual({
      demo: { type: "stdio", command: "node", args: ["s.js"] },
    });
    expect(opts.local.settingSources).toEqual(["project"]);
  });
});

describe("resolveCursorSdkAgent mcpServers", () => {
  it("passes mcpServers on create and recreates when fingerprint changes", async () => {
    const cwd = tempRoot();
    mkdirSync(join(cwd, ".cursor"), { recursive: true });
    writeFileSync(
      join(cwd, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: { demo: { command: "node", args: ["a.js"] } },
      }),
      "utf8"
    );
    const mcpServers = loadCursorMcpServersForSdk(cwd)!;
    const mcpKey = cursorMcpServersFingerprint(cwd, true);
    const fingerprint = cursorCloudCacheFingerprint(
      "auto",
      "sys",
      "",
      "project",
      "agent",
      mcpKey
    );

    const resume = vi.fn(async () => ({
      agentId: "godmode-c1",
      close: vi.fn(),
      send: vi.fn(),
    }));
    const create = vi.fn(async () => ({
      agentId: "godmode-c1-new",
      close: vi.fn(),
      send: vi.fn(),
    }));

    const first = await resolveCursorSdkAgent({
      chatKey: "godmode-c1",
      apiKey: "k",
      cwd,
      fingerprint,
      modelId: "auto",
      mode: "agent",
      mcpServers,
      sdk: { resume, create },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0]).toMatchObject({ mcpServers });
    expect(resume).not.toHaveBeenCalled();

    const second = await resolveCursorSdkAgent({
      chatKey: "godmode-c1",
      apiKey: "k",
      cwd,
      fingerprint,
      modelId: "auto",
      mode: "agent",
      mcpServers,
      sdk: { resume, create },
    });
    expect(second.agent).toBe(first.agent);
    expect(create).toHaveBeenCalledOnce();

    writeFileSync(
      join(cwd, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          demo: { command: "node", args: ["a.js"] },
          extra: { command: "npx", args: ["pkg"] },
        },
      }),
      "utf8"
    );
    const mcpServers2 = loadCursorMcpServersForSdk(cwd)!;
    const fingerprint2 = cursorCloudCacheFingerprint(
      "auto",
      "sys",
      "",
      "project",
      "agent",
      cursorMcpServersFingerprint(cwd, true)
    );
    create.mockClear();
    create.mockImplementation(async () => ({
      agentId: "godmode-c1-rotated",
      close: vi.fn(),
      send: vi.fn(),
    }));
    await resolveCursorSdkAgent({
      chatKey: "godmode-c1",
      apiKey: "k",
      cwd,
      fingerprint: fingerprint2,
      modelId: "auto",
      mode: "agent",
      mcpServers: mcpServers2,
      sdk: { resume, create },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(first.agent.close).toHaveBeenCalled();
    expect(create.mock.calls[0]![0]).toMatchObject({ mcpServers: mcpServers2 });
    expect(resume).not.toHaveBeenCalled();
  });
});
