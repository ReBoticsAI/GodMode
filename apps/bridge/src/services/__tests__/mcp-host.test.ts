/**
 * Bridge MCP host (#449): naming, gates, stdio connect, tenant isolation.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getToolSchemasForLlm } from "../ai-tools-registry.js";
import {
  ensureBridgeMcpHost,
  executeBridgeMcpTool,
  getBridgeMcpToolDefsForAgent,
  getBridgeMcpToolMode,
  getBridgeMcpToolSchemasForAgent,
  isBridgeMcpToolName,
  mcpExposedToolName,
  parseBridgeMcpToolName,
  parseVaultSecretRef,
  resetBridgeMcpHostForTests,
  resolveBridgeMcpHostEnabled,
} from "../coding/mcp-host.js";
import { requiresConfirmation } from "../ai-tool-executor.js";

const temps: string[] = [];
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".."
);
const fixtureServer = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "tiny-mcp-server.mjs"
);

function tinyStdioServer(): {
  type: "stdio";
  command: string;
  args: string[];
  cwd: string;
} {
  return {
    type: "stdio",
    command: process.execPath,
    args: [fixtureServer],
    cwd: repoRoot,
  };
}

afterEach(async () => {
  await resetBridgeMcpHostForTests();
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-mcp-host-"));
  temps.push(dir);
  return dir;
}

function writeMcpJson(root: string, body: unknown): void {
  mkdirSync(join(root, ".cursor"), { recursive: true });
  writeFileSync(
    join(root, ".cursor", "mcp.json"),
    JSON.stringify(body, null, 2),
    "utf8"
  );
}

describe("mcp tool naming", () => {
  it("builds and parses exposed names", () => {
    const name = mcpExposedToolName("my-server", "do_thing");
    expect(name).toBe("gm_mcp__my-server__do_thing");
    expect(isBridgeMcpToolName(name)).toBe(true);
    expect(parseBridgeMcpToolName(name)).toEqual({
      serverKey: "my-server",
      toolKey: "do_thing",
    });
    expect(isBridgeMcpToolName("read_file")).toBe(false);
    expect(isBridgeMcpToolName("mcp__tiny__echo")).toBe(false);
  });

  it("parses vault refs", () => {
    expect(parseVaultSecretRef("vault:demo_token")).toBe("demo_token");
    expect(parseVaultSecretRef("{{vault:demo_token}}")).toBe("demo_token");
    expect(parseVaultSecretRef("plain")).toBeNull();
  });
});

describe("resolveBridgeMcpHostEnabled", () => {
  it("hosts cursor_cloud only when MCP gated on and SDK sandbox is on", () => {
    expect(
      resolveBridgeMcpHostEnabled({
        backend: "cursor_cloud",
        mcpFromWorkspace: true,
        isSaas: true,
        sdkSandboxEnabled: true,
      })
    ).toBe(true);
    expect(
      resolveBridgeMcpHostEnabled({
        backend: "cursor_cloud",
        mcpFromWorkspace: true,
        isSaas: false,
        sdkSandboxEnabled: false,
      })
    ).toBe(false);
    expect(
      resolveBridgeMcpHostEnabled({
        backend: "cursor_cloud",
        mcpFromWorkspace: false,
        isSaas: true,
        sdkSandboxEnabled: true,
      })
    ).toBe(false);
    expect(
      resolveBridgeMcpHostEnabled({
        backend: "cursor",
        mcpFromWorkspace: true,
        isSaas: false,
        sdkSandboxEnabled: true,
      })
    ).toBe(false);
  });

  it("respects SaaS default for non-SDK backends", () => {
    expect(
      resolveBridgeMcpHostEnabled({
        backend: "local",
        isSaas: true,
      })
    ).toBe(false);
    expect(
      resolveBridgeMcpHostEnabled({
        backend: "provider",
        isSaas: false,
      })
    ).toBe(true);
    expect(
      resolveBridgeMcpHostEnabled({
        backend: "local",
        mcpFromWorkspace: true,
        isSaas: true,
      })
    ).toBe(true);
  });
});

describe("ensureBridgeMcpHost stdio", () => {
  it("connects, lists tools, and executes with tenant isolation", async () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: {
        tiny: tinyStdioServer(),
      },
    });

    const first = await ensureBridgeMcpHost({
      tenantId: "tenant-a",
      agentId: "agent-a",
      codingRoot: root,
      enabled: true,
    });
    expect(first.statuses).toEqual([
      expect.objectContaining({ name: "tiny", ok: true, toolCount: 1 }),
    ]);
    const schemas = getBridgeMcpToolSchemasForAgent("agent-a");
    expect(schemas.map((s) => s.function.name)).toContain("gm_mcp__tiny__echo");

    expect(getBridgeMcpToolMode("gm_mcp__tiny__echo")).toBe("auto");
    expect(requiresConfirmation("gm_mcp__tiny__echo")).toBe(false);
    expect(getBridgeMcpToolDefsForAgent("agent-a")[0]?.mode).toBe("auto");
    expect(getBridgeMcpToolMode("gm_mcp__missing__tool")).toBe("confirm");
    expect(requiresConfirmation("gm_mcp__missing__tool")).toBe(true);

    const llm = getToolSchemasForLlm(undefined, "agent-a");
    expect(llm.some((s) => s.function.name === "gm_mcp__tiny__echo")).toBe(true);

    const result = (await executeBridgeMcpTool(
      "gm_mcp__tiny__echo",
      { text: "hi" },
      { agentId: "agent-a", tenantId: "tenant-a" }
    )) as { content?: Array<{ type: string; text?: string }> };
    const text = result.content?.find((c) => c.type === "text")?.text;
    expect(text).toBe("echo:hi");

    await expect(
      executeBridgeMcpTool(
        "gm_mcp__tiny__echo",
        { text: "nope" },
        { agentId: "agent-a", tenantId: "tenant-b" }
      )
    ).rejects.toThrow(/tenant mismatch/i);
  }, 60_000);

  it("omits tools when disabled or host off", async () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: {
        tiny: tinyStdioServer(),
      },
    });

    const off = await ensureBridgeMcpHost({
      tenantId: "t1",
      agentId: "agent-off",
      codingRoot: root,
      enabled: false,
    });
    expect(off.schemas).toEqual([]);

    const skipped = await ensureBridgeMcpHost({
      tenantId: "t1",
      agentId: "agent-skip",
      codingRoot: root,
      enabled: true,
      disabled: ["tiny"],
    });
    expect(skipped.schemas).toEqual([]);
    expect(skipped.statuses).toEqual([]);
  }, 30_000);

  it("resolves vault: refs in env", async () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: {
        tiny: {
          ...tinyStdioServer(),
          env: { DEMO_TOKEN: "vault:demo_token" },
        },
      },
    });

    const miss = await ensureBridgeMcpHost({
      tenantId: "t1",
      agentId: "agent-vault-miss",
      codingRoot: root,
      enabled: true,
      resolveVaultSecret: () => null,
    });
    expect(miss.statuses).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.stringMatching(/Vault secret not found/i),
      }),
    ]);

    const ok = await ensureBridgeMcpHost({
      tenantId: "t1",
      agentId: "agent-vault-ok",
      codingRoot: root,
      enabled: true,
      resolveVaultSecret: (name) =>
        name === "demo_token" ? "secret-value" : null,
    });
    expect(ok.statuses[0]?.ok).toBe(true);
  }, 60_000);
});
