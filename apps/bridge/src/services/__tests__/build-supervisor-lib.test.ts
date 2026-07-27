/**
 * Host build-supervisor shared lib (#164 / #167).
 */
import { describe, expect, it } from "vitest";
import {
  isAllowedBuildCommand,
  isEgressHostAllowed,
  normalizeBuildCommand,
  normalizeBuildNet,
  resolveBuildEgressHosts,
  sanitizeCwdRel,
  sanitizeTenantId,
  tenantWorkspaceHostPath,
} from "../../../../../deploy/build-supervisor/lib.mjs";

describe("build-supervisor lib", () => {
  it("allowlists npm commands only", () => {
    expect(isAllowedBuildCommand("npm test")).toBe(true);
    expect(() => normalizeBuildCommand("npm run evil")).toThrow(/not allowed/i);
  });

  it("rejects path escapes and builds tenant relative bind path", () => {
    expect(sanitizeCwdRel(".")).toBe(".");
    expect(() => sanitizeCwdRel("../../etc")).toThrow(/escapes/i);
    expect(sanitizeTenantId("abc-123")).toBe("abc-123");
    expect(() => sanitizeTenantId("../x")).toThrow(/Invalid tenantId/i);
    expect(tenantWorkspaceHostPath("/data", "t1")).toBe("tenant-workspaces/t1");
  });

  it("accepts none and allowlist network modes only", () => {
    expect(normalizeBuildNet(undefined)).toBe("none");
    expect(normalizeBuildNet("none")).toBe("none");
    expect(normalizeBuildNet("allowlist")).toBe("allowlist");
    expect(() => normalizeBuildNet("shared")).toThrow(/allowlist/i);
    expect(() => normalizeBuildNet("bridge")).toThrow(/Invalid build network/i);
  });

  it("matches egress hosts exactly and via *.suffix", () => {
    const hosts = ["registry.npmjs.org", "*.githubusercontent.com"];
    expect(isEgressHostAllowed("registry.npmjs.org", hosts)).toBe(true);
    expect(isEgressHostAllowed("objects.githubusercontent.com", hosts)).toBe(
      true
    );
    expect(isEgressHostAllowed("evil.example", hosts)).toBe(false);
    expect(isEgressHostAllowed("127.0.0.1", hosts)).toBe(false);
    expect(isEgressHostAllowed("localhost", hosts)).toBe(false);
  });

  it("resolves egress hosts from defaults when unset", () => {
    const hosts = resolveBuildEgressHosts([]);
    expect(hosts).toContain("registry.npmjs.org");
    expect(hosts).toContain("github.com");
  });
});
