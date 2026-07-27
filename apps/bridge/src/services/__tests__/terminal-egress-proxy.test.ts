/**
 * Layer 3 egress allowlist CONNECT proxy (#112 / #157): UDS + host matcher.
 */
import fs from "node:fs";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureEgressBridgeScript,
  isEgressHostAllowed,
  resolveEgressAllowlist,
  startTerminalEgressProxy,
  wrapAllowlistCommand,
  type TerminalEgressProxyHandle,
} from "../coding/terminal-egress-proxy.js";

const temps: string[] = [];
const proxies: TerminalEgressProxyHandle[] = [];

afterEach(async () => {
  while (proxies.length) {
    const p = proxies.pop()!;
    await p.close().catch(() => undefined);
  }
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe("isEgressHostAllowed", () => {
  it("matches exact and wildcard suffix rules", () => {
    const list = ["github.com", "*.npmjs.org"];
    expect(isEgressHostAllowed("github.com", list)).toBe(true);
    expect(isEgressHostAllowed("registry.npmjs.org", list)).toBe(true);
    expect(isEgressHostAllowed("evil.com", list)).toBe(false);
  });

  it("rejects IP literals and localhost unless explicitly listed", () => {
    expect(isEgressHostAllowed("127.0.0.1", ["github.com"])).toBe(false);
    expect(isEgressHostAllowed("localhost", ["github.com"])).toBe(false);
    expect(isEgressHostAllowed("127.0.0.1", ["127.0.0.1"])).toBe(true);
  });
});

describe("resolveEgressAllowlist", () => {
  it("uses built-in defaults when empty", () => {
    const list = resolveEgressAllowlist([]);
    expect(list).toContain("registry.npmjs.org");
    expect(list).toContain("github.com");
  });
});

describe.skipIf(process.platform === "win32")("startTerminalEgressProxy UDS", () => {
  // AF_UNIX listen is unreliable on Windows temp paths; hub/CI is Linux.
  it("denies CONNECT to non-allowlisted hosts over UDS", async () => {
    const root = tempDir("gm-egress-");
    const proxy = await startTerminalEgressProxy({
      codingRoot: root,
      allowlist: ["github.com"],
    });
    proxies.push(proxy);
    expect(fs.existsSync(proxy.socketPath)).toBe(true);

    const response = await new Promise<string>((resolve, reject) => {
      const sock = net.createConnection(proxy.socketPath, () => {
        sock.write(
          "CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example:443\r\n\r\n"
        );
      });
      let data = "";
      sock.on("data", (c) => {
        data += c.toString("utf8");
        if (data.includes("\r\n\r\n")) {
          sock.end();
          resolve(data);
        }
      });
      sock.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5_000);
    });

    expect(response).toMatch(/403/);
    expect(response).toMatch(/not allowlisted/i);
  });

  it("rejects non-CONNECT methods", async () => {
    const root = tempDir("gm-egress2-");
    const proxy = await startTerminalEgressProxy({
      codingRoot: root,
      allowlist: ["github.com"],
    });
    proxies.push(proxy);

    const response = await new Promise<string>((resolve, reject) => {
      const sock = net.createConnection(proxy.socketPath, () => {
        sock.write("GET http://github.com/ HTTP/1.1\r\nHost: github.com\r\n\r\n");
      });
      let data = "";
      sock.on("data", (c) => {
        data += c.toString("utf8");
        if (data.includes("\r\n\r\n")) {
          sock.end();
          resolve(data);
        }
      });
      sock.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5_000);
    });

    expect(response).toMatch(/400/);
  });
});

describe("wrapAllowlistCommand", () => {
  it("starts the TCP-to-UDS bridge before the user command", () => {
    const root = tempDir("gm-wrap-");
    ensureEgressBridgeScript(root);
    const wrapped = wrapAllowlistCommand({
      codingRoot: root,
      socketRel: ".godmode-egress/proxy.sock",
      command: "echo hi",
    });
    expect(wrapped).toContain("tcp-to-uds.mjs");
    expect(wrapped).toContain("echo hi");
    expect(wrapped).toContain("/usr/bin/node");
  });
});
