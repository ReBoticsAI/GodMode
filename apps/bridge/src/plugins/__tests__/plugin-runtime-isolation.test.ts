import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pluginRuntimeIsolationForTrustTier } from "../plugin-runtime-isolation.js";
import type { PluginTrustTier } from "../../services/plugin-capabilities.js";

const TIERS: PluginTrustTier[] = ["official", "community", "local", "operator"];

describe("plugin runtime isolation (#314 / #559)", () => {
  it("keeps every trust tier in-process until the Community runner lands", () => {
    for (const tier of TIERS) {
      expect(pluginRuntimeIsolationForTrustTier(tier)).toBe("in-process");
    }
  });

  it("still loads plugins via in-process import() in loader.ts", () => {
    const loaderPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "loader.ts"
    );
    const src = fs.readFileSync(loaderPath, "utf8");
    expect(src).toContain("async function importBridgeRegister");
    expect(src).toMatch(/await import\(url\)/);
    expect(src).toContain("pluginRuntimeIsolationForTrustTier");
    expect(src).not.toMatch(/child_process|fork\(/);
  });
});
