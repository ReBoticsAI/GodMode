/**
 * Minimal stdio MCP server for Bridge host tests (plain ESM, no tsx).
 * Usage: node path/to/tiny-mcp-server.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "tiny-echo", version: "1.0.0" });

server.tool(
  "echo",
  "Echo text back",
  { text: z.string() },
  { readOnlyHint: true },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo:${text}` }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
