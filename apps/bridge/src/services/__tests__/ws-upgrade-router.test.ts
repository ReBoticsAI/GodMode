/**
 * HTTP upgrade routing for multiple `ws` servers (#210).
 */
import { describe, expect, it } from "vitest";
import { wsUpgradePathname } from "../../ws-upgrade-router.js";

describe("wsUpgradePathname", () => {
  it("strips query and returns pathname", () => {
    expect(wsUpgradePathname("/ws/terminal?tenantId=abc")).toBe("/ws/terminal");
    expect(wsUpgradePathname("/ws")).toBe("/ws");
  });

  it("returns null for empty", () => {
    expect(wsUpgradePathname(undefined)).toBeNull();
  });
});
