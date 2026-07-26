import { describe, expect, it } from "vitest";
import { codingUiAllowed } from "../coding/coding-ui-access.js";

describe("codingUiAllowed", () => {
  it("allows non-SaaS", () => {
    expect(codingUiAllowed({ isSaas: false, saasAllowCodeAccess: false })).toBe(
      true
    );
  });

  it("denies SaaS when platform policy is off", () => {
    expect(codingUiAllowed({ isSaas: true, saasAllowCodeAccess: false })).toBe(
      false
    );
  });

  it("allows SaaS when platform policy is on", () => {
    expect(codingUiAllowed({ isSaas: true, saasAllowCodeAccess: true })).toBe(
      true
    );
  });
});
