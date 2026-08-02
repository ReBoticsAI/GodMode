import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertExternalUrlAllowed,
  assertRecordAllowed,
  assertToolAllowed,
  buildCapabilityGrants,
  collectDeclaredCapabilityNames,
  collectDeclaredNetworkHosts,
  hostMatchesAllowlist,
  parseCapabilityGrants,
  readCapabilityGrants,
  resolveCapabilityGrants,
  resolvePluginTrustTier,
  writeCapabilityGrants,
} from "../plugin-capabilities.js";
import type { CatalogEntry } from "../marketplace-catalog.js";

function entry(partial: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "demo-plugin",
    kind: "plugin",
    installType: "plugin",
    title: "Demo",
    description: "Demo",
    version: "1.0.0",
    author: "test",
    pluginRepo: "https://github.com/example/demo",
    ...partial,
  };
}

describe("plugin capability grants (#290 / #303)", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-cap-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("resolves Official/Community trust tiers", () => {
    expect(
      resolvePluginTrustTier({ entry: entry({ sourceName: "Official" }) })
    ).toBe("official");
    expect(
      resolvePluginTrustTier({ entry: entry({ sourceName: "Community" }) })
    ).toBe("community");
    expect(
      resolvePluginTrustTier({
        entry: entry({ pluginLocalPath: "/tmp/local-plugin" }),
      })
    ).toBe("local");
  });

  it("deny-by-default for Official when no hosts declared", () => {
    const grants = buildCapabilityGrants({
      trustTier: "official",
      declaredHosts: [],
    });
    expect(grants.network).toEqual({ mode: "deny", hosts: [] });
    expect(() =>
      assertExternalUrlAllowed(grants, "https://evil.example/x")
    ).toThrow(/deny-by-default/);
  });

  it("allowlists only granted hosts for Official/Community", () => {
    const grants = buildCapabilityGrants({
      trustTier: "community",
      declaredHosts: ["api.example.com", "*.cdn.example.com"],
    });
    expect(grants.network.mode).toBe("allowlist");
    expect(assertExternalUrlAllowed(grants, "https://api.example.com/v1").host).toBe(
      "api.example.com"
    );
    expect(
      assertExternalUrlAllowed(grants, "https://a.cdn.example.com/x").hostname
    ).toBe("a.cdn.example.com");
    expect(() =>
      assertExternalUrlAllowed(grants, "https://other.example/x")
    ).toThrow(/not in the allowlist/);
    expect(() =>
      assertExternalUrlAllowed(grants, "ftp://api.example.com/x")
    ).toThrow(/blocked scheme/);
  });

  it("leaves Local/operator unrestricted", () => {
    const grants = buildCapabilityGrants({ trustTier: "local" });
    expect(grants.network.mode).toBe("unrestricted");
    expect(grants.tools.mode).toBe("unrestricted");
    expect(grants.records.mode).toBe("unrestricted");
    expect(
      assertExternalUrlAllowed(grants, "https://anywhere.example/ok").hostname
    ).toBe("anywhere.example");
    expect(assertToolAllowed(grants, "any_tool")).toBe("any_tool");
    expect(assertRecordAllowed(grants, "AnyType")).toBe("AnyType");
  });

  it("matches hosts and wildcards", () => {
    expect(hostMatchesAllowlist("api.example.com", ["api.example.com"])).toBe(
      true
    );
    expect(hostMatchesAllowlist("evil.com", ["api.example.com"])).toBe(false);
    expect(hostMatchesAllowlist("x.cdn.example.com", ["*.cdn.example.com"])).toBe(
      true
    );
    expect(hostMatchesAllowlist("cdn.example.com", ["*.cdn.example.com"])).toBe(
      false
    );
  });

  it("merges catalog and manifest declared hosts", () => {
    expect(
      collectDeclaredNetworkHosts({
        catalogHosts: ["api.example.com", "API.example.com"],
        manifestHosts: ["*.cdn.example.com"],
      })
    ).toEqual(["api.example.com", "*.cdn.example.com"]);
  });

  it("deny-by-default for Official tools and records", () => {
    const grants = buildCapabilityGrants({
      trustTier: "official",
      declaredTools: [],
      declaredRecords: [],
    });
    expect(grants.tools).toEqual({ mode: "deny", names: [] });
    expect(grants.records).toEqual({ mode: "deny", names: [] });
    expect(() => assertToolAllowed(grants, "evil_tool")).toThrow(/deny-by-default/);
    expect(() => assertRecordAllowed(grants, "EvilType")).toThrow(/deny-by-default/);
  });

  it("allowlists only granted tools and records", () => {
    const grants = buildCapabilityGrants({
      trustTier: "community",
      declaredTools: ["search_docs", "search_docs"],
      declaredRecords: ["Invoice", "StructureNode"],
    });
    expect(grants.tools).toEqual({
      mode: "allowlist",
      names: ["search_docs"],
    });
    expect(assertToolAllowed(grants, "search_docs")).toBe("search_docs");
    expect(() => assertToolAllowed(grants, "other_tool")).toThrow(
      /not in the allowlist/
    );
    expect(assertRecordAllowed(grants, "Invoice")).toBe("Invoice");
    expect(() => assertRecordAllowed(grants, "Secret")).toThrow(
      /not in the allowlist/
    );
  });

  it("merges catalog and manifest declared tool/record names", () => {
    expect(
      collectDeclaredCapabilityNames({
        catalogNames: ["Invoice", "Invoice"],
        manifestNames: ["StructureNode"],
      })
    ).toEqual(["Invoice", "StructureNode"]);
  });

  it("persists and reloads grants from plugin root", () => {
    const root = tmp();
    const grants = buildCapabilityGrants({
      trustTier: "official",
      declaredHosts: ["hooks.example.com"],
      declaredTools: ["ping"],
      declaredRecords: ["Invoice"],
      sourceEntryId: "demo-plugin",
    });
    writeCapabilityGrants(root, grants);
    const loaded = readCapabilityGrants(root);
    expect(loaded).toMatchObject({
      version: 1,
      trustTier: "official",
      network: { mode: "allowlist", hosts: ["hooks.example.com"] },
      tools: { mode: "allowlist", names: ["ping"] },
      records: { mode: "allowlist", names: ["Invoice"] },
      sourceEntryId: "demo-plugin",
    });
    expect(parseCapabilityGrants({ version: 2 })).toBeNull();
  });

  it("fills missing tools/records on legacy grants files from trust tier", () => {
    const legacy = parseCapabilityGrants({
      version: 1,
      trustTier: "official",
      network: { mode: "deny", hosts: [] },
      grantedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(legacy?.tools.mode).toBe("deny");
    expect(legacy?.records.mode).toBe("deny");

    const localLegacy = parseCapabilityGrants({
      version: 1,
      trustTier: "local",
      network: { mode: "unrestricted", hosts: [] },
      grantedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(localLegacy?.tools.mode).toBe("unrestricted");
    expect(localLegacy?.records.mode).toBe("unrestricted");
  });

  it("fail-closes marketplace trees missing a grants file", () => {
    const market = tmp();
    const pluginRoot = path.join(market, "demo-plugin");
    fs.mkdirSync(pluginRoot);
    const grants = resolveCapabilityGrants({
      pluginRoot,
      marketplacePluginsRoot: market,
    });
    expect(grants.network.mode).toBe("deny");
    expect(grants.tools.mode).toBe("deny");
    expect(grants.records.mode).toBe("deny");
  });

  it("treats non-marketplace roots without grants as operator unrestricted", () => {
    const root = tmp();
    const grants = resolveCapabilityGrants({
      pluginRoot: root,
      marketplacePluginsRoot: path.join(tmp(), "market"),
    });
    expect(grants.trustTier).toBe("operator");
    expect(grants.network.mode).toBe("unrestricted");
    expect(grants.tools.mode).toBe("unrestricted");
    expect(grants.records.mode).toBe("unrestricted");
  });
});
