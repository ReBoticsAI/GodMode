import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pluginRuntimeIsolationForTrustTier } from "../plugin-runtime-isolation.js";

describe("plugin runtime isolation (#314 / #559)", () => {
  it("runs Community in a child process and keeps other tiers in-process", () => {
    expect(pluginRuntimeIsolationForTrustTier("community")).toBe("child-process");
    expect(pluginRuntimeIsolationForTrustTier("official")).toBe("in-process");
    expect(pluginRuntimeIsolationForTrustTier("local")).toBe("in-process");
    expect(pluginRuntimeIsolationForTrustTier("operator")).toBe("in-process");
  });

  it("loads Community via the child supervisor and others via import()", () => {
    const loaderPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "loader.ts"
    );
    const src = fs.readFileSync(loaderPath, "utf8");
    expect(src).toContain("async function importBridgeRegister");
    expect(src).toMatch(/await import\(url\)/);
    expect(src).toContain("pluginRuntimeIsolationForTrustTier");
    expect(src).toContain("loadCommunityPluginInChild");
    expect(src).toMatch(/isolation === "child-process"/);
  });
});
