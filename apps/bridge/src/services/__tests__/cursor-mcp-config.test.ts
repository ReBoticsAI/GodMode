/**
 * Read-only `.cursor/mcp.json` discovery for platform context (#71).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import {
  collectCursorMcpDiscovery,
  enrichPlatformContextWithMcp,
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
  it("renders MCP: summary in the platform section", () => {
    const db = new Database(":memory:") as unknown as AppDatabase;
    const flow = getDefaultPromptFlowConfig();
    for (const sec of flow.sections) {
      sec.enabled = sec.id === "platform" || sec.id === "base";
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
    expect(assembled.systemPrompt).toContain(
      "MCP: github (stdio) cmd:npx | discovery only (not executed by Bridge)"
    );
    expect(assembled.systemPrompt).toContain("Route: /intelligence");
  });
});
