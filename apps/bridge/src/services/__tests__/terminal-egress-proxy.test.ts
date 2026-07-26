/**
 * Layer 3 egress allowlist CONNECT proxy (#112).
 */
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  isEgressHostAllowed,
  resolveEgressAllowlist,
  startTerminalEgressProxy,
  type TerminalEgressProxyHandle,
} from "../coding/terminal-egress-proxy.js";

const proxies: TerminalEgressProxyHandle[] = [];

afterEach(async () => {
  while (proxies.length) {
    const p = proxies.pop()!;
    await p.close().catch(() => undefined);
  }
});

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

describe("startTerminalEgressProxy", () => {
  it("denies CONNECT to non-allowlisted hosts", async () => {
    const proxy = await startTerminalEgressProxy({
      allowlist: ["github.com"],
    });
    proxies.push(proxy);

    const response = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(proxy.port, proxy.host, () => {
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
    const proxy = await startTerminalEgressProxy({
      allowlist: ["github.com"],
    });
    proxies.push(proxy);

    const response = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(proxy.port, proxy.host, () => {
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
