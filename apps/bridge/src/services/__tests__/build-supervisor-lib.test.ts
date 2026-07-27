/**
 * Host build-supervisor shared lib (#164).
 */
import { describe, expect, it } from "vitest";
import {
  isAllowedBuildCommand,
  normalizeBuildCommand,
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
});
