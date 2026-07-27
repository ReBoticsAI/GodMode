import { describe, expect, it } from "vitest";
import { resolveSaasAllowCodeAccess } from "../../config.js";
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

describe("resolveSaasAllowCodeAccess", () => {
  it("defaults on for SaaS when unset", () => {
    expect(resolveSaasAllowCodeAccess(undefined, true)).toBe(true);
    expect(resolveSaasAllowCodeAccess("", true)).toBe(true);
    expect(resolveSaasAllowCodeAccess("  ", true)).toBe(true);
  });

  it("defaults off for non-SaaS when unset", () => {
    expect(resolveSaasAllowCodeAccess(undefined, false)).toBe(false);
    expect(resolveSaasAllowCodeAccess("", false)).toBe(false);
  });

  it("honors explicit true/false on SaaS", () => {
    expect(resolveSaasAllowCodeAccess("true", true)).toBe(true);
    expect(resolveSaasAllowCodeAccess("TRUE", true)).toBe(true);
    expect(resolveSaasAllowCodeAccess("false", true)).toBe(false);
    expect(resolveSaasAllowCodeAccess("FALSE", true)).toBe(false);
  });

  it("honors explicit true on non-SaaS", () => {
    expect(resolveSaasAllowCodeAccess("true", false)).toBe(true);
    expect(resolveSaasAllowCodeAccess("false", false)).toBe(false);
  });
});
