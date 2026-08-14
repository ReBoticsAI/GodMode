/**
 * Read-only `.cursor/mcp.json` discovery + SDK pass-through helpers (#71).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import {
  MAX_SDK_MCP_SERVERS,
  collectCursorMcpDiscovery,
  cursorMcpServersFingerprint,
  enrichPlatformContextWithMcp,
  loadCursorMcpServersForSdk,
  resolveMcpDiscoveryExecution,
  resolveMcpFromWorkspace,
} from "../coding/cursor-mcp-config.js";
import {
  assemblePrompt,
  getDefaultPromptFlowConfig,
} from "../prompt-assembler.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-mcp-disc-"));
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

describe("collectCursorMcpDiscovery", () => {
  it("returns null when mcp.json is missing", () => {
    expect(collectCursorMcpDiscovery(tempRoot())).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(join(root, ".cursor", "mcp.json"), "{not-json", "utf8");
    expect(collectCursorMcpDiscovery(root)).toBeNull();
  });

  it("lists stdio and http servers without secrets", () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "ghp_secret_should_not_leak" },
        },
        docs: {
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer secret-token" },
        },
      },
    });

    const disc = collectCursorMcpDiscovery(root);
    expect(disc).not.toBeNull();
    expect(disc!.servers.map((s) => s.name).sort()).toEqual(["docs", "github"]);
    expect(disc!.servers.find((s) => s.name === "github")?.transport).toBe(
      "stdio"
    );
    expect(disc!.servers.find((s) => s.name === "docs")?.transport).toBe("http");
    expect(disc!.summary).toContain("github (stdio)");
    expect(disc!.summary).toContain("docs (http)");
    expect(disc!.summary).toContain("discovery only");
    expect(disc!.summary).not.toContain("ghp_secret");
    expect(disc!.summary).not.toContain("secret-token");
    expect(disc!.summary).not.toContain("Bearer");
    expect(JSON.stringify(disc)).not.toContain("ghp_secret");
    expect(JSON.stringify(disc)).not.toContain("secret-token");
  });

  it("labels sdk-inline execution in the summary", () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: { demo: { command: "node", args: ["s.js"] } },
    });
    const disc = collectCursorMcpDiscovery(root, { execution: "sdk-inline" });
    expect(disc?.summary).toContain("passed to Cursor SDK");
  });

  it("infers stdio from command when type is omitted", () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: {
        time: { command: "python", args: ["-m", "mcp_server_time"] },
      },
    });
    const disc = collectCursorMcpDiscovery(root);
    expect(disc?.servers).toEqual([
      { name: "time", transport: "stdio", detail: "cmd:python" },
    ]);
  });
});

describe("loadCursorMcpServersForSdk", () => {
  it("maps stdio and http entries for the SDK", () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "pkg"],
          env: { TOKEN: "secret" },
        },
        docs: { type: "http", url: "https://mcp.example.com/sse" },
      },
    });
    const servers = loadCursorMcpServersForSdk(root);
    expect(servers).toEqual({
      docs: { type: "http", url: "https://mcp.example.com/sse" },
      github: {
        type: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { TOKEN: "secret" },
      },
    });
  });

  it("caps server count", () => {
    const root = tempRoot();
    const mcpServers: Record<string, { command: string }> = {};
    for (let i = 0; i < MAX_SDK_MCP_SERVERS + 3; i++) {
      mcpServers[`s${String(i).padStart(2, "0")}`] = { command: "node" };
    }
    writeMcpJson(root, { mcpServers });
    expect(Object.keys(loadCursorMcpServersForSdk(root) ?? {})).toHaveLength(
      MAX_SDK_MCP_SERVERS
    );
  });

  it("omits disabled server names", () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: {
        keep: { command: "node" },
        skip: { command: "python" },
      },
    });
    expect(loadCursorMcpServersForSdk(root, { disabled: ["skip"] })).toEqual({
      keep: { type: "stdio", command: "node" },
    });
  });
});

describe("resolveMcpFromWorkspace", () => {
  it("defaults on for non-SaaS and off for SaaS", () => {
    expect(resolveMcpFromWorkspace({}, { isSaas: false })).toBe(true);
    expect(resolveMcpFromWorkspace({}, { isSaas: true })).toBe(false);
  });

  it("honors explicit boolean", () => {
    expect(
      resolveMcpFromWorkspace({ mcpFromWorkspace: true }, { isSaas: true })
    ).toBe(true);
    expect(
      resolveMcpFromWorkspace({ mcpFromWorkspace: false }, { isSaas: false })
    ).toBe(false);
  });
});

describe("resolveMcpDiscoveryExecution", () => {
  it("picks sdk labels for cursor_cloud", () => {
    expect(
      resolveMcpDiscoveryExecution({
        backend: "cursor_cloud",
        mcpFromWorkspace: true,
      })
    ).toBe("sdk-inline");
    expect(
      resolveMcpDiscoveryExecution({
        backend: "cursor_cloud",
        mcpFromWorkspace: true,
        bridgeHostForCursorCloud: true,
      })
    ).toBe("bridge-host");
    expect(
      resolveMcpDiscoveryExecution({
        backend: "cursor_cloud",
        hasProjectSettingSources: true,
      })
    ).toBe("sdk-project");
    expect(resolveMcpDiscoveryExecution({ backend: "local" })).toBe(
      "discovery-only"
    );
  });

  it("labels bridge-host for local backends when enabled", () => {
    expect(
      resolveMcpDiscoveryExecution({
        backend: "local",
        mcpFromWorkspace: true,
      })
    ).toBe("bridge-host");
    expect(
      resolveMcpDiscoveryExecution({
        backend: "provider",
        mcpFromWorkspace: true,
      })
    ).toBe("bridge-host");
  });
});

describe("cursorMcpServersFingerprint", () => {
  it("changes when mcp.json changes while enabled", () => {
    const root = tempRoot();
    writeMcpJson(root, { mcpServers: { a: { command: "node" } } });
    const first = cursorMcpServersFingerprint(root, true);
    writeMcpJson(root, {
      mcpServers: { a: { command: "node" }, b: { command: "npx" } },
    });
    const second = cursorMcpServersFingerprint(root, true);
    expect(first).not.toEqual(second);
    expect(cursorMcpServersFingerprint(root, false)).toBe("");
  });
});

describe("enrichPlatformContextWithMcp", () => {
  it("attaches mcpDiscovery when mcp.json exists", () => {
    const root = tempRoot();
    writeMcpJson(root, {
      mcpServers: { demo: { command: "node", args: ["server.js"] } },
    });
    const enriched = enrichPlatformContextWithMcp(
      { pathname: "/intelligence" },
      { workspace: root }
    );
    expect(enriched?.pathname).toBe("/intelligence");
    expect(enriched?.mcpDiscovery?.servers[0]?.name).toBe("demo");
  });

  it("leaves context unchanged when mcp.json is absent", () => {
    const root = tempRoot();
    const enriched = enrichPlatformContextWithMcp(
      { pathname: "/x" },
      { workspace: root }
    );
    expect(enriched).toEqual({ pathname: "/x" });
  });
});

describe("prompt-assembler MCP line", () => {
  it("renders MCP in the dedicated mcp section", () => {
    const db = new Database(":memory:") as unknown as AppDatabase;
    const flow = getDefaultPromptFlowConfig();
    for (const sec of flow.sections) {
      sec.enabled = sec.id === "platform" || sec.id === "base" || sec.id === "mcp";
    }
    const assembled = assemblePrompt(db, {
      basePrompt: "You are a test agent.",
      flowConfig: flow,
      agent: null,
      platformContext: {
        pathname: "/intelligence",
        mcpDiscovery: {
          servers: [{ name: "github", transport: "stdio", detail: "cmd:npx" }],
          summary:
            "github (stdio) cmd:npx | discovery only (not executed by Bridge)",
        },
      },
      agentId: "intelligence",
    });
    expect(assembled.systemPrompt).toContain("<godmode_mcp>");
    expect(assembled.systemPrompt).toContain(
      "github (stdio) cmd:npx | discovery only (not executed by Bridge)"
    );
    expect(assembled.systemPrompt).toContain(
      "Do not tell the USER to reload an external IDE"
    );
    expect(assembled.systemPrompt).toContain("Route: /intelligence");
  });
});
