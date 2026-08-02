import { describe, expect, it } from "vitest";
import {
  assertPluginInstallPin,
  isFloatingPluginRef,
  resolvePluginPinPolicy,
} from "../marketplace-plugin-pin.js";
import type { CatalogEntry } from "../marketplace-catalog.js";

function entry(partial: Partial<CatalogEntry>): CatalogEntry {
  return {
    id: "demo-plugin",
    kind: "plugin",
    installType: "plugin",
    title: "Demo",
    description: "",
    version: "1.0.0",
    author: "test",
    pluginRepo: "https://github.com/example/demo.git",
    ...partial,
  };
}

describe("marketplace-plugin-pin", () => {
  it("treats main/master/empty as floating", () => {
    expect(isFloatingPluginRef(undefined)).toBe(true);
    expect(isFloatingPluginRef("main")).toBe(true);
    expect(isFloatingPluginRef("MASTER")).toBe(true);
    expect(isFloatingPluginRef("v1.2.3")).toBe(false);
    expect(isFloatingPluginRef("abc1234")).toBe(false);
  });

  it("requires pins for Official/Community and SaaS-shaped sources", () => {
    expect(
      resolvePluginPinPolicy({
        entry: entry({ sourceName: "Official" }),
      })
    ).toBe("required");
    expect(
      resolvePluginPinPolicy({
        entry: entry({ sourceName: "Community" }),
      })
    ).toBe("required");
    expect(
      resolvePluginPinPolicy({
        entry: entry({}),
        sourceCatalog:
          "https://app.godmode.software/api/marketplace/commerce/catalog/official/public",
      })
    ).toBe("required");
    expect(
      resolvePluginPinPolicy({
        entry: entry({ pluginLocalPath: "/tmp/local-plugin" }),
      })
    ).toBe("optional");
  });

  it("fail-closes Official installs without a pinned pluginRef", () => {
    expect(() =>
      assertPluginInstallPin(entry({ sourceName: "Official", pluginRef: "main" }), "required")
    ).toThrow(/pinned pluginRef/);
    expect(() =>
      assertPluginInstallPin(entry({ sourceName: "Official" }), "required")
    ).toThrow(/pinned pluginRef/);
  });

  it("accepts tag or commit pins", () => {
    expect(
      assertPluginInstallPin(
        entry({ pluginRef: "v1.0.0", pluginDigest: "deadbeefcafebabe" }),
        "required"
      )
    ).toEqual({ ref: "v1.0.0", digest: "deadbeefcafebabe" });
    expect(
      assertPluginInstallPin(entry({ pluginRef: "abcdef1" }), "required")
    ).toEqual({ ref: "abcdef1", digest: undefined });
  });
});
