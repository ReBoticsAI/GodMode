import http from "node:http";
import { FederationConnectorClient, type ConnectorConfig } from "./local-connector.js";

const bridgeUrl = (process.env.BRIDGE_URL ?? "http://127.0.0.1:3847").replace(/\/$/, "");
const token = process.env.FEDERATION_TOKEN ?? "";
const port = Number(process.env.CONNECTOR_PORT ?? 3950);

const cfg: ConnectorConfig = {
  bridgeUrl,
  federationToken: token,
  manifest: {
    id: process.env.CONNECTOR_ID ?? "generic",
    title: process.env.CONNECTOR_TITLE ?? "GodMode Local Connector",
    version: "0.1.0",
    verbs: ["execute", "health"],
  },
};

const client = new FederationConnectorClient(cfg);

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    const h = await client.health();
    res.writeHead(h.ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(h));
    return;
  }
  if (req.url === "/execute" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || "{}") as { line?: string; chartbookKey?: string };
    const result = await client.execute(String(parsed.line ?? ""), parsed.chartbookKey);
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`[connector] ${cfg.manifest.title} on :${port} → ${bridgeUrl}`);
});
